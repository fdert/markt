// فحص حيّ للربط مع بوابة فاتورة (بيئة المطوّرين افتراضياً) دون قاعدة بيانات:
// إنشاء مفتاح وCSR ← طلب شهادة الامتثال ← إرسال 6 مستندات موقّعة ← طلب شهادة الإنتاج.
// الاستخدام: npx tsx scripts/zatca-live-check.ts [otp=123345] [env=sandbox] [vat=399999999900003]
import { generateCsr, generatePrivateKey } from '../src/services/zatca/sign.js';
import { zatcaApi } from '../src/services/zatca/api.js';
import { signingFor } from '../src/services/zatca/index.js';
import { complianceCases, complianceDocument } from '../src/routes/branches.js';

const [otp = '123345', env = 'sandbox', vat = '399999999900003'] = process.argv.slice(2);
const log = (ok: boolean, msg: string, extra?: unknown) => console.log(`${ok ? '✔' : '✘'} ${msg}`, extra !== undefined ? JSON.stringify(extra) : '');

const key = generatePrivateKey();
const csr = generateCsr(key, { commonName: 'TST-886431145-' + vat, serialNumber: `1-Raseed|2-POS|3-${crypto.randomUUID()}`, organizationIdentifier: vat, organizationUnitName: 'الفرع الرئيسي', organizationName: 'شركة رصيد التجريبية', countryName: 'SA', invoiceType: '1100', location: 'الرياض', industry: 'Retail', env: env as 'sandbox' });
const c = await zatcaApi.complianceCsid(env, csr, otp);
log(c.ok, `طلب شهادة الامتثال (${c.status})`, c.ok ? { requestID: c.body.requestID } : c.body);
if (!c.ok) process.exit(1);
const { binarySecurityToken: token, secret, requestID } = c.body as { binarySecurityToken: string; secret: string; requestID: number };
const signing = signingFor(key, token);
const seller = { name: 'شركة رصيد التجريبية', vatNumber: vat, crNumber: '1010010000', street: 'طريق الملك فهد', buildingNo: '1234', additionalNo: '5678', district: 'العليا', city: 'الرياض', postalCode: '12345' };
let pih = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='; let icv = 1; let allOk = true;
for (const k of complianceCases('1100')) {
  const d = complianceDocument(k, { icv, pih, seller, signing });
  const r = await zatcaApi.complianceCheck(env, token, secret, { invoiceHash: d.invoiceHash, uuid: d.uuid, invoice: Buffer.from(d.xml).toString('base64') });
  const b = r.body as { validationResults?: { status: string; errorMessages: unknown[]; warningMessages: unknown[] }; reportingStatus?: string; clearanceStatus?: string };
  const ok = r.ok && b.validationResults?.status !== 'ERROR';
  allOk &&= ok;
  log(ok, `${k.kind}/${k.type}: ${r.status} ${b.validationResults?.status ?? ''} ${b.reportingStatus ?? b.clearanceStatus ?? ''}`, ok && !b.validationResults?.warningMessages?.length ? undefined : b.validationResults ?? b);
  pih = d.invoiceHash; icv++;
}
const p = await zatcaApi.productionCsid(env, token, secret, String(requestID));
log(p.ok, `طلب شهادة الإنتاج (${p.status})`, p.ok ? undefined : p.body);
console.log(allOk && p.ok ? '\nالنتيجة: نجح الربط الكامل مع الهيئة.' : '\nالنتيجة: يوجد فشل؛ راجع التفاصيل أعلاه.');
process.exit(allOk && p.ok ? 0 : 1);
