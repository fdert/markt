// يولّد فواتير نموذجية موقّعة لاختبارها بأداة التحقق الرسمية من الهيئة (ZATCA SDK)
// الاستخدام: npx tsx scripts/zatca-samples.ts <مجلد الإخراج> <مسار المفتاح> <مسار الشهادة>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildInvoiceXml, type ZatcaInvoiceInput } from '../src/services/zatca/xml.js';
import { finalizeInvoiceXml } from '../src/services/zatca/index.js';

const [out, keyPath, certPath] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const key = readFileSync(keyPath, 'utf8');
const cert = readFileSync(certPath, 'utf8').replace(/-----[^-]+-----|\s/g, '');

const seller = { name: 'شركة رصيد للتجارة', vatNumber: '399999999900003', crNumber: '1010010000', street: 'طريق الملك فهد', buildingNo: '1234', additionalNo: '5678', district: 'العليا', city: 'الرياض', postalCode: '12345' };
const buyer = { name: 'مؤسسة العميل', vatNumber: '399999999800003', street: 'شارع التحلية', buildingNo: '2222', additionalNo: '3333', district: 'السليمانية', city: 'الرياض', postalCode: '12244' };
const lines = [
  { id: 1, name: 'حليب طازج', qty: 2, unitPrice: 5.65, discount: 0, netAmount: 11.3, taxRate: 15, taxAmount: 1.7, total: 13 },
  { id: 2, name: 'خبز', qty: 1, unitPrice: 10, discount: 1, netAmount: 9, taxRate: 15, taxAmount: 1.35, total: 10.35 },
];
const sum = (k: 'netAmount' | 'taxAmount' | 'total') => Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;
let pih = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
const cases: Array<[string, Partial<ZatcaInvoiceInput>]> = [
  ['simplified-invoice', { kind: 'SIMPLIFIED', type: 'INVOICE', buyer: null }],
  ['simplified-credit', { kind: 'SIMPLIFIED', type: 'CREDIT_NOTE', buyer: null, originalNumber: 'INV-1', reason: 'إرجاع بضاعة' }],
  ['simplified-debit', { kind: 'SIMPLIFIED', type: 'DEBIT_NOTE', buyer: null, originalNumber: 'INV-1', reason: 'فرق سعر' }],
  ['standard-invoice', { kind: 'STANDARD', type: 'INVOICE', buyer }],
  ['standard-credit', { kind: 'STANDARD', type: 'CREDIT_NOTE', buyer, originalNumber: 'INV-4', reason: 'إرجاع بضاعة' }],
  ['standard-debit', { kind: 'STANDARD', type: 'DEBIT_NOTE', buyer, originalNumber: 'INV-4', reason: 'فرق سعر' }],
  ['edge-specialchars', { kind: 'SIMPLIFIED', type: 'INVOICE', buyer: null, seller: { ...seller, name: 'شركة "رصيد" & أبناؤه <للتجارة>' },
    lines: [{ id: 1, name: 'قهوة "عربية" & هيل <ممتازة>', qty: 3, unitPrice: 8.6957, discount: 0, netAmount: 26.09, taxRate: 15, taxAmount: 3.91, total: 30 },
      { id: 2, name: 'دواء معفى', qty: 1, unitPrice: 20, discount: 0, netAmount: 20, taxRate: 0, taxAmount: 0, total: 20 }],
    subtotal: 46.09, taxTotal: 3.91, total: 50 }],
  ['edge-buyer-crn', { kind: 'STANDARD', type: 'INVOICE', buyer: { name: 'مؤسسة بدون رقم ضريبي', crNumber: '1010999999', street: 'شارع العليا', buildingNo: '1111', additionalNo: '2222', district: 'العليا', city: 'الرياض', postalCode: '12211' } }],
];
const manifest: Array<{ file: string; pih: string; hash: string }> = [];
cases.forEach(([name, c], idx) => {
  const issuedAt = new Date(Date.now() - 3600_000);
  const input = { number: `INV-${idx + 1}`, uuid: crypto.randomUUID(), issuedAt, icv: idx + 1, previousHash: pih, seller, lines,
    subtotal: sum('netAmount'), taxTotal: sum('taxAmount'), total: sum('total'), paymentMeans: 'CASH', ...c } as ZatcaInvoiceInput;
  const r = finalizeInvoiceXml(buildInvoiceXml(input), { sellerName: input.seller.name, vatNumber: seller.vatNumber, issuedAt, total: input.total, taxTotal: input.taxTotal, simplified: input.kind === 'SIMPLIFIED', signing: { privateKeyPem: key, certificateB64: cert } });
  writeFileSync(join(out, name + '.xml'), r.xml);
  manifest.push({ file: name + '.xml', pih, hash: r.invoiceHash });
  pih = r.invoiceHash;
});
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
