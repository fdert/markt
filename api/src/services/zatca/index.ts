// تنسيق إصدار الفاتورة الإلكترونية: رمز QR، سلسلة البصمات (PIH/ICV)، التوقيع، والإبلاغ
import { eq } from 'drizzle-orm';
import { db, schema, type Tx } from '../../db/index.js';
import { getSetting } from '../../lib/settings.js';
import { buildQr } from './qr.js';
import { buildInvoiceXml, invoiceHashOf, qrReference, SIGNATURE_REF, QR_PLACEHOLDER, SIGNATURE_PLACEHOLDER, type ZatcaLine } from './xml.js';
import { signInvoice } from './sign.js';
import { zatcaApi } from './api.js';

type Invoice = typeof schema.invoices.$inferSelect;
type Branch = typeof schema.branches.$inferSelect;
type Customer = typeof schema.customers.$inferSelect;

export async function stampInvoice(tx: Tx, inv: Invoice, items: ZatcaLine[], branch: Branch, customer: Customer | null, paymentMeans: string, originalNumber?: string | null) {
  const tax = await getSetting('tax', tx);
  const store = await getSetting('store', tx);
  if (!tax.enabled) return { qrCode: null, zatcaStatus: 'NOT_REQUIRED' } as const;

  const sellerName = store.name;
  const icv = branch.icvCounter + 1;
  const previousHash = branch.lastInvoiceHash;
  const issuedAt = inv.createdAt;

  const xml = buildInvoiceXml({
    number: inv.number, uuid: inv.uuid, issuedAt, kind: inv.kind as 'SIMPLIFIED', type: inv.type === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE',
    icv, previousHash,
    seller: { name: sellerName, vatNumber: tax.vatNumber, crNumber: branch.crNumber || store.crNumber, street: branch.street || store.street, buildingNo: branch.buildingNo || store.buildingNo, additionalNo: branch.additionalNo || store.additionalNo, district: branch.district || store.district, city: branch.city || store.city, postalCode: branch.postalCode || store.postalCode },
    buyer: customer ? { ...customer } : null,
    lines: items, subtotal: inv.subtotal, taxTotal: inv.taxTotal, total: inv.total, paymentMeans,
    originalNumber, reason: inv.returnReason, supplyDate: inv.supplyDate,
  });
  const invoiceHash = invoiceHashOf(xml);
  const timestamp = issuedAt.toISOString().slice(0, 19) + 'Z';

  const certToken = branch.productionCsid ?? branch.complianceCsid;
  const phase2 = branch.zatcaEnabled && !branch.zatcaPaused && !!certToken && !!branch.zatcaPrivateKey;
  let qrCode: string; let finalXml: string; let zatcaStatus: string;

  if (phase2) {
    const certB64 = Buffer.from(certToken!, 'base64').toString('utf8');
    const signed = signInvoice(xml, invoiceHash, branch.zatcaPrivateKey!, certB64, issuedAt);
    qrCode = buildQr({
      sellerName, vatNumber: tax.vatNumber, timestamp, total: inv.total.toFixed(2), vatTotal: inv.taxTotal.toFixed(2),
      invoiceHash, signature: signed.signatureValue, publicKey: signed.publicKey,
      certificateSignature: inv.kind === 'SIMPLIFIED' ? signed.certSignature : undefined,
    });
    finalXml = signed.signedXml.replace(QR_PLACEHOLDER, qrReference(qrCode)).replace(SIGNATURE_PLACEHOLDER, SIGNATURE_REF);
    zatcaStatus = 'PENDING';
  } else {
    qrCode = buildQr({ sellerName, vatNumber: tax.vatNumber, timestamp, total: inv.total.toFixed(2), vatTotal: inv.taxTotal.toFixed(2) });
    finalXml = xml.replace('<!--UBL_EXTENSIONS-->', '').replace(QR_PLACEHOLDER, qrReference(qrCode)).replace(SIGNATURE_PLACEHOLDER, '');
    zatcaStatus = 'NOT_REQUIRED';
  }

  await tx.update(schema.branches).set({ icvCounter: icv, lastInvoiceHash: invoiceHash }).where(eq(schema.branches.id, branch.id));
  await tx.update(schema.invoices).set({ icv, previousHash, invoiceHash, qrCode, xml: finalXml, zatcaStatus }).where(eq(schema.invoices.id, inv.id));
  return { qrCode, zatcaStatus };
}

/** إرسال الفاتورة للهيئة بعد الحفظ (الإبلاغ أو الاعتماد) مع تسجيل الرد */
export async function submitToZatca(invoiceId: number) {
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!inv || inv.zatcaStatus !== 'PENDING' || !inv.xml || !inv.invoiceHash) return null;
  const [branch] = await db.select().from(schema.branches).where(eq(schema.branches.id, inv.branchId));
  const token = branch.productionCsid ?? branch.complianceCsid;
  const secret = branch.productionCsid ? branch.productionSecret : branch.complianceSecret;
  if (!token || !secret) return null;
  const payload = { invoiceHash: inv.invoiceHash, uuid: inv.uuid, invoice: Buffer.from(inv.xml).toString('base64') };
  try {
    const fn = !branch.productionCsid ? zatcaApi.complianceCheck : inv.kind === 'STANDARD' ? zatcaApi.clear : zatcaApi.report;
    const r = await fn(branch.zatcaEnv, token, secret, payload);
    const body = r.body as { reportingStatus?: string; clearanceStatus?: string; validationResults?: { status?: string } };
    const status = !r.ok && r.status !== 202 ? 'REJECTED'
      : body.validationResults?.status === 'WARNING' ? 'WARNING'
        : inv.kind === 'STANDARD' ? 'CLEARED' : 'REPORTED';
    await db.update(schema.invoices).set({ zatcaStatus: status, zatcaResponse: r.body as never }).where(eq(schema.invoices.id, inv.id));
    return { status, response: r.body };
  } catch (e) {
    await db.update(schema.invoices).set({ zatcaResponse: { error: String(e) } as never }).where(eq(schema.invoices.id, inv.id));
    return { status: 'PENDING', error: String(e) };
  }
}
