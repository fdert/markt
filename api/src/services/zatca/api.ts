// عميل بوابة فاتورة (Fatoora) لهيئة الزكاة والضريبة والجمارك
import { config } from '../../config.js';

const baseUrl = (env: string) =>
  env === 'production' ? config.zatca.productionUrl : env === 'simulation' ? config.zatca.simulationUrl : config.zatca.sandboxUrl;

async function call(env: string, path: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(baseUrl(env) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'en', 'Accept-Version': 'V2', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, body: json as Record<string, unknown> };
}

const basic = (token: string, secret: string) => 'Basic ' + Buffer.from(`${token}:${secret}`).toString('base64');

export const zatcaApi = {
  /** طلب شهادة الامتثال باستخدام رمز التحقق OTP */
  complianceCsid: (env: string, csrPem: string, otp: string) =>
    call(env, '/compliance', { csr: Buffer.from(csrPem).toString('base64') }, { OTP: otp }),
  /** فحص فاتورة تجريبية أثناء مرحلة الامتثال */
  complianceCheck: (env: string, token: string, secret: string, p: { invoiceHash: string; uuid: string; invoice: string }) =>
    call(env, '/compliance/invoices', p, { Authorization: basic(token, secret) }),
  /** طلب شهادة الإنتاج بعد اجتياز الامتثال */
  productionCsid: (env: string, token: string, secret: string, requestId: string) =>
    call(env, '/production/csids', { compliance_request_id: requestId }, { Authorization: basic(token, secret) }),
  /** إبلاغ الفاتورة المبسّطة (خلال 24 ساعة) */
  report: (env: string, token: string, secret: string, p: { invoiceHash: string; uuid: string; invoice: string }) =>
    call(env, '/invoices/reporting/single', p, { Authorization: basic(token, secret), 'Clearance-Status': '1' }),
  /** اعتماد الفاتورة الضريبية (B2B) قبل تسليمها */
  clear: (env: string, token: string, secret: string, p: { invoiceHash: string; uuid: string; invoice: string }) =>
    call(env, '/invoices/clearance/single', p, { Authorization: basic(token, secret), 'Clearance-Status': '1' }),
};
