// تنسيق إصدار الفاتورة الإلكترونية: رمز QR، سلسلة البصمات (PIH/ICV)، التوقيع، والإبلاغ
import { eq } from 'drizzle-orm';
import { db, schema, type Tx } from '../../db/index.js';
import { getSetting } from '../../lib/settings.js';
import { buildQr } from './qr.js';
import { buildInvoiceXml, invoiceHashOf, qrReference, SIGNATURE_REF, QR_PLACEHOLDER, UBL_EXT_PLACEHOLDER, SIGNATURE_PLACEHOLDER, type ZatcaLine } from './xml.js';
import { ksaDateTime, resolveSigningKey, signInvoice } from './sign.js';
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
  const certToken = branch.productionCsid ?? branch.complianceCsid;
  const phase2 = branch.zatcaEnabled && !branch.zatcaPaused && !!certToken && !!branch.zatcaPrivateKey;
  const r = finalizeInvoiceXml(xml, {
    sellerName, vatNumber: tax.vatNumber, issuedAt, total: inv.total, taxTotal: inv.taxTotal, simplified: inv.kind === 'SIMPLIFIED',
    signing: phase2 ? signingFor(branch.zatcaPrivateKey!, certToken!) : null,
  });
  const { invoiceHash, qrCode } = r; const finalXml = r.xml;
  const zatcaStatus = phase2 ? 'PENDING' : 'NOT_REQUIRED';

  await tx.update(schema.branches).set({ icvCounter: icv, lastInvoiceHash: invoiceHash }).where(eq(schema.branches.id, branch.id));
  await tx.update(schema.invoices).set({ icv, previousHash, invoiceHash, qrCode, xml: finalXml, zatcaStatus }).where(eq(schema.invoices.id, inv.id));
  return { qrCode, zatcaStatus };
}

/**
 * إرسال الفاتورة للهيئة بعد الحفظ (الإبلاغ للمبسّطة، والاعتماد للضريبية) مع تسجيل الرد.
 * - 200/202: مقبولة (202 = مقبولة مع تحذيرات).
 * - 303 في الاعتماد: الاعتماد متوقف مؤقتاً لدى الهيئة، فتُبلَّغ الفاتورة بدلاً منه.
 * - 400: مرفوضة ولا تُعاد. - 401/429/5xx أو خطأ شبكة: تبقى معلّقة وتُعاد لاحقاً تلقائياً.
 * في الاعتماد تعيد الهيئة نسخة مختومة من الفاتورة (clearedInvoice) فتُحفظ بدلاً من الأصل مع رمز QR الجديد.
 */
export async function submitToZatca(invoiceId: number) {
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!inv || inv.zatcaStatus !== 'PENDING' || !inv.xml || !inv.invoiceHash) return null;
  const [branch] = await db.select().from(schema.branches).where(eq(schema.branches.id, inv.branchId));
  const token = branch.productionCsid ?? branch.complianceCsid;
  const secret = branch.productionCsid ? branch.productionSecret : branch.complianceSecret;
  if (!token || !secret) return null;
  const payload = { invoiceHash: inv.invoiceHash, uuid: inv.uuid, invoice: Buffer.from(inv.xml).toString('base64') };
  try {
    let r;
    if (!branch.productionCsid) r = await zatcaApi.complianceCheck(branch.zatcaEnv, token, secret, payload);
    else if (inv.kind === 'STANDARD') {
      r = await zatcaApi.clear(branch.zatcaEnv, token, secret, payload);
      if (r.status === 303) r = await zatcaApi.report(branch.zatcaEnv, token, secret, payload, '0');
    } else r = await zatcaApi.report(branch.zatcaEnv, token, secret, payload);
    const outcome = classifyResponse(r.status, r.body, inv.kind);
    const patch: Partial<typeof schema.invoices.$inferInsert> = { zatcaStatus: outcome, zatcaResponse: r.body as never };
    const cleared = (r.body as { clearedInvoice?: string }).clearedInvoice;
    if (cleared) {
      const xml = Buffer.from(cleared, 'base64').toString('utf8');
      patch.xml = xml;
      const qr = /<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</.exec(xml)?.[1];
      if (qr) patch.qrCode = qr;
    }
    await db.update(schema.invoices).set(patch).where(eq(schema.invoices.id, inv.id));
    return { status: outcome, response: r.body };
  } catch (e) {
    await db.update(schema.invoices).set({ zatcaResponse: { error: String(e) } as never }).where(eq(schema.invoices.id, inv.id));
    return { status: 'PENDING', error: String(e) };
  }
}

/** تصنيف رد الهيئة إلى حالة الفاتورة */
export function classifyResponse(status: number, body: Record<string, unknown>, kind: string): string {
  if (status === 401 || status === 429 || status >= 500) return 'PENDING';
  if (status === 409) return kind === 'STANDARD' ? 'CLEARED' : 'REPORTED'; // سبق إرسالها
  if (status === 400 || (status >= 300 && status !== 303)) return 'REJECTED';
  const b = body as { reportingStatus?: string; clearanceStatus?: string; validationResults?: { status?: string } };
  if (b.reportingStatus === 'NOT_REPORTED' || b.clearanceStatus === 'NOT_CLEARED' || b.validationResults?.status === 'ERROR') return 'REJECTED';
  if (status === 202 || b.validationResults?.status === 'WARNING') return 'WARNING';
  if (b.clearanceStatus) return 'CLEARED';
  if (b.reportingStatus) return 'REPORTED';
  return kind === 'STANDARD' ? 'CLEARED' : 'REPORTED';
}

/** إعادة إرسال الفواتير المعلّقة تلقائياً (الإبلاغ مطلوب خلال 24 ساعة من الإصدار) */
export async function retryPendingInvoices(limit = 50) {
  const rows = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.zatcaStatus, 'PENDING')).limit(limit);
  let done = 0;
  for (const r of rows) { const x = await submitToZatca(r.id); if (x && x.status !== 'PENDING') done++; }
  return { checked: rows.length, done };
}

export function startZatcaWorker(intervalMs = 5 * 60_000) {
  const t = setInterval(() => { retryPendingInvoices().catch(() => undefined); }, intervalMs);
  t.unref();
  return t;
}

export interface FinalizeOptions {
  sellerName: string; vatNumber: string; issuedAt: Date; total: number; taxTotal: number; simplified: boolean;
  signing: { privateKeyPem: string; certificateB64: string } | null;
}

/** دالة نقية: تحسب البصمة وتوقّع (المرحلة الثانية) وتضيف رمز QR. تُستخدم في الإصدار والاختبارات. */
export function finalizeInvoiceXml(xml: string, o: FinalizeOptions) {
  const invoiceHash = invoiceHashOf(xml, !!o.signing);
  const timestamp = ksaDateTime(o.issuedAt).stamp; // يطابق IssueDate + IssueTime
  if (o.signing) {
    const signed = signInvoice(xml, invoiceHash, o.signing.privateKeyPem, o.signing.certificateB64, o.issuedAt);
    const qrCode = buildQr({
      sellerName: o.sellerName, vatNumber: o.vatNumber, timestamp, total: o.total.toFixed(2), vatTotal: o.taxTotal.toFixed(2),
      invoiceHash, signature: signed.signatureValue, publicKey: signed.publicKey,
      certificateSignature: o.simplified ? signed.certSignature : undefined,
    });
    return { invoiceHash, qrCode, xml: signed.signedXml.replace(QR_PLACEHOLDER, qrReference(qrCode)).replace(SIGNATURE_PLACEHOLDER, SIGNATURE_REF) };
  }
  const qrCode = buildQr({ sellerName: o.sellerName, vatNumber: o.vatNumber, timestamp, total: o.total.toFixed(2), vatTotal: o.taxTotal.toFixed(2) });
  return { invoiceHash, qrCode, xml: xml.replace(UBL_EXT_PLACEHOLDER, '').replace(QR_PLACEHOLDER, qrReference(qrCode)).replace(SIGNATURE_PLACEHOLDER, '') };
}

/** مفتاح وشهادة التوقيع من رمز الأمان الثنائي (binarySecurityToken) الذي تعيده الهيئة */
export function signingFor(privateKeyPem: string, binarySecurityToken: string) {
  const certificateB64 = Buffer.from(binarySecurityToken, 'base64').toString('utf8');
  return { privateKeyPem: resolveSigningKey(privateKeyPem, certificateB64), certificateB64 };
}
