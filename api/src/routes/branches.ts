import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ah, badRequest, notFound } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { getSetting } from '../lib/settings.js';
import { logActivity } from '../lib/activity.js';
import { generateCsr, generatePrivateKey, signInvoice } from '../services/zatca/sign.js';
import { zatcaApi } from '../services/zatca/api.js';
import { buildInvoiceXml, invoiceHashOf, qrReference, SIGNATURE_REF } from '../services/zatca/xml.js';
import { buildQr } from '../services/zatca/qr.js';

const r = Router();
const safe = (b: typeof schema.branches.$inferSelect) => {
  const { zatcaPrivateKey, complianceSecret, productionSecret, zatcaCsr, complianceCsid, productionCsid, ...rest } = b;
  return { ...rest, zatcaLinked: !!productionCsid, zatcaCompliance: !!complianceCsid };
};

r.get('/', ah(async (_req, res) => {
  const rows = await db.select().from(schema.branches).orderBy(asc(schema.branches.id));
  res.json(rows.map(safe));
}));

const body = z.object({
  name: z.string().min(2, 'اسم الفرع مطلوب.'), nameEn: z.string().nullish(), type: z.enum(['BRANCH', 'WAREHOUSE']).default('BRANCH'),
  phone: z.string().nullish(), city: z.string().nullish(), district: z.string().nullish(), street: z.string().nullish(),
  buildingNo: z.string().regex(/^\d{4}$/, 'رقم المبنى 4 أرقام.').nullish().or(z.literal('')), additionalNo: z.string().nullish(),
  postalCode: z.string().regex(/^\d{5}$/, 'الرمز البريدي 5 أرقام.').nullish().or(z.literal('')), crNumber: z.string().nullish(), active: z.boolean().default(true),
  isDefault: z.boolean().optional(),
});

r.post('/', can('settings.manage'), ah(async (req, res) => {
  const b = body.parse(req.body);
  const [row] = await db.insert(schema.branches).values(b).returning();
  await logActivity({ userId: req.user!.id, action: 'branch.create', entity: 'branch', entityId: row.id, summary: `أضاف الفرع ${row.name}` });
  res.status(201).json(safe(row));
}));

r.put('/:id', can('settings.manage'), ah(async (req, res) => {
  const b = body.partial().parse(req.body);
  if (b.isDefault) await db.update(schema.branches).set({ isDefault: false });
  const [row] = await db.update(schema.branches).set(b).where(eq(schema.branches.id, Number(req.params.id))).returning();
  if (!row) throw notFound('الفرع غير موجود.');
  res.json(safe(row));
}));

// ===== ربط الفرع بالفاتورة الإلكترونية (المرحلة الثانية) =====
async function loadBranch(id: number) {
  const [b] = await db.select().from(schema.branches).where(eq(schema.branches.id, id));
  if (!b) throw notFound('الفرع غير موجود.');
  return b;
}

r.post('/:id/zatca/onboard', can('settings.manage'), ah(async (req, res) => {
  const { otp, env } = z.object({ otp: z.string().regex(/^\d{6}$/, 'رمز التحقق 6 أرقام.'), env: z.enum(['sandbox', 'simulation', 'production']).default('sandbox') }).parse(req.body);
  const branch = await loadBranch(Number(req.params.id));
  const tax = await getSetting('tax'); const store = await getSetting('store');
  if (!/^3\d{13}3$/.test(tax.vatNumber)) throw badRequest('أدخل الرقم الضريبي للمتجر أولاً من إعدادات الضريبة.');
  const privateKey = generatePrivateKey();
  const egsSerial = `1-Raseed|2-POS|3-${randomUUID()}`;
  const csr = generateCsr(privateKey, {
    commonName: `EGS-${branch.id}-${store.name}`.slice(0, 60), serialNumber: egsSerial, organizationIdentifier: tax.vatNumber,
    organizationUnitName: branch.name, organizationName: store.name, countryName: 'SA', invoiceType: '1100',
    location: branch.city || store.city || 'Riyadh', industry: 'Retail', env,
  });
  const resp = await zatcaApi.complianceCsid(env, csr, otp);
  if (!resp.ok) throw badRequest('رفضت الهيئة طلب الربط. تحقق من رمز التحقق وأعد المحاولة.', resp.body);
  const body = resp.body as { binarySecurityToken: string; secret: string; requestID: number };
  await db.update(schema.branches).set({
    zatcaEnv: env, egsSerial, zatcaPrivateKey: privateKey, zatcaCsr: csr, complianceCsid: body.binarySecurityToken,
    complianceSecret: body.secret, productionCsid: null, productionSecret: null, zatcaEnabled: false,
  }).where(eq(schema.branches.id, branch.id));
  await db.insert(schema.settings).values({ key: `zatca_req_${branch.id}`, value: { requestId: body.requestID } })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: { requestId: body.requestID } } });
  res.json({ message: 'تم استلام شهادة الامتثال. أكمل فحص الامتثال.', requestId: body.requestID });
}));

/** فحص الامتثال: إرسال فواتير نموذجية موقعة (مبسطة + إشعار دائن + ضريبية) */
r.post('/:id/zatca/compliance', can('settings.manage'), ah(async (req, res) => {
  const branch = await loadBranch(Number(req.params.id));
  if (!branch.complianceCsid || !branch.zatcaPrivateKey) throw badRequest('اربط الفرع أولاً برمز التحقق.');
  const tax = await getSetting('tax'); const store = await getSetting('store');
  const certB64 = Buffer.from(branch.complianceCsid, 'base64').toString('utf8');
  const seller = { name: store.name, vatNumber: tax.vatNumber, crNumber: branch.crNumber || '1010010000', city: branch.city || 'Riyadh', street: branch.street || 'King Fahd', buildingNo: branch.buildingNo || '1234', postalCode: branch.postalCode || '12345', district: branch.district || 'Olaya', additionalNo: '1234' };
  const buyer = { name: 'شركة تجريبية', vatNumber: '399999999900003', city: 'Riyadh', street: 'Test', buildingNo: '1234', postalCode: '12345', district: 'Test', additionalNo: '1234' };
  const results: unknown[] = [];
  let pih = branch.lastInvoiceHash;
  const cases: Array<{ kind: 'SIMPLIFIED' | 'STANDARD'; type: 'INVOICE' | 'CREDIT_NOTE' }> = [
    { kind: 'SIMPLIFIED', type: 'INVOICE' }, { kind: 'SIMPLIFIED', type: 'CREDIT_NOTE' }, { kind: 'STANDARD', type: 'INVOICE' }, { kind: 'STANDARD', type: 'CREDIT_NOTE' },
  ];
  let icv = 1;
  for (const c of cases) {
    const uuid = randomUUID(); const now = new Date();
    const xml = buildInvoiceXml({ number: `TST-${icv}`, uuid, issuedAt: now, kind: c.kind, type: c.type, icv, previousHash: pih, seller, buyer: c.kind === 'STANDARD' ? buyer : null,
      lines: [{ id: 1, name: 'منتج تجريبي', qty: 1, unitPrice: 100, discount: 0, netAmount: 100, taxRate: 15, taxAmount: 15, total: 115 }],
      subtotal: 100, taxTotal: 15, total: 115, paymentMeans: 'CASH', originalNumber: 'TST-1', reason: 'Return', supplyDate: now });
    const hash = invoiceHashOf(xml);
    const signed = signInvoice(xml, hash, branch.zatcaPrivateKey, certB64, now);
    const qr = buildQr({ sellerName: store.name, vatNumber: tax.vatNumber, timestamp: now.toISOString().slice(0, 19) + 'Z', total: '115.00', vatTotal: '15.00', invoiceHash: hash, signature: signed.signatureValue, publicKey: signed.publicKey, certificateSignature: c.kind === 'SIMPLIFIED' ? signed.certSignature : undefined });
    const finalXml = signed.signedXml.replace('<!--QR_REFERENCE-->', qrReference(qr)).replace('<!--SIGNATURE_REFERENCE-->', SIGNATURE_REF);
    const r2 = await zatcaApi.complianceCheck(branch.zatcaEnv, branch.complianceCsid, branch.complianceSecret!, { invoiceHash: hash, uuid, invoice: Buffer.from(finalXml).toString('base64') });
    results.push({ case: `${c.kind}/${c.type}`, status: r2.status, body: r2.body });
    pih = hash; icv++;
  }
  res.json({ results });
}));

r.post('/:id/zatca/production', can('settings.manage'), ah(async (req, res) => {
  const branch = await loadBranch(Number(req.params.id));
  const [reqRow] = await db.select().from(schema.settings).where(eq(schema.settings.key, `zatca_req_${branch.id}`));
  if (!branch.complianceCsid || !reqRow) throw badRequest('أكمل خطوة الامتثال أولاً.');
  const resp = await zatcaApi.productionCsid(branch.zatcaEnv, branch.complianceCsid, branch.complianceSecret!, String((reqRow.value as { requestId: number }).requestId));
  if (!resp.ok) throw badRequest('تعذّر إصدار شهادة الإنتاج.', resp.body);
  const body = resp.body as { binarySecurityToken: string; secret: string };
  await db.update(schema.branches).set({ productionCsid: body.binarySecurityToken, productionSecret: body.secret, zatcaEnabled: true, zatcaPaused: false, icvCounter: 0 }).where(eq(schema.branches.id, branch.id));
  await logActivity({ userId: req.user!.id, action: 'zatca.link', entity: 'branch', entityId: branch.id, summary: `ربط الفرع ${branch.name} بالفاتورة الإلكترونية` });
  res.json({ message: 'تم ربط الفرع بالمرحلة الثانية.' });
}));

r.post('/:id/zatca/pause', can('settings.manage'), ah(async (req, res) => {
  const { paused } = z.object({ paused: z.boolean() }).parse(req.body);
  await db.update(schema.branches).set({ zatcaPaused: paused }).where(eq(schema.branches.id, Number(req.params.id)));
  res.json({ message: paused ? 'تم إيقاف التوقيع مؤقتاً.' : 'تم استئناف التوقيع.' });
}));

r.post('/:id/zatca/unlink', can('settings.manage'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const pending = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.zatcaStatus, 'PENDING'));
  if (pending.length) throw badRequest('لا يمكن فصل الفرع ما دامت هناك فواتير بانتظار التبليغ.');
  await db.update(schema.branches).set({ zatcaEnabled: false, zatcaPrivateKey: null, zatcaCsr: null, complianceCsid: null, complianceSecret: null, productionCsid: null, productionSecret: null, icvCounter: 0 }).where(eq(schema.branches.id, id));
  res.json({ message: 'تم فصل الفرع.' });
}));

export default r;
