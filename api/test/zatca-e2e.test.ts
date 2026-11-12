// اختبار شامل لمسار الربط مع الهيئة (المرحلة الثانية) عبر خادم محاكٍ لبوابة فاتورة:
// الربط بالرمز OTP ← فحص الامتثال (6 مستندات) ← شهادة الإنتاج ← بيع وإبلاغ واعتماد ← مرتجع.
// إذا وُجد المتغير ZATCA_CLI (مسار أداة التحقق الرسمية) تُفحص كل فاتورة صادرة بها أيضاً.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVerify, X509Certificate } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db, schema } from '../src/db/index.js';
import { canonicalHashOfFinal } from '../src/services/zatca/xml.js';
import { decodeQr } from '../src/services/zatca/qr.js';
import { retryPendingInvoices } from '../src/services/zatca/index.js';
import { SANDBOX_CERT_B64 } from './fixtures/zatca-sandbox.js';

const app = createApp();
let token = ''; let branchId = 0; let stub: Server;
const auth = () => ({ Authorization: `Bearer ${token}` });
const calls: Array<{ path: string; body: { invoiceHash?: string; uuid?: string; invoice?: string }; headers: Record<string, unknown> }> = [];
const INITIAL_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
const token64 = Buffer.from(SANDBOX_CERT_B64).toString('base64'); // binarySecurityToken كما تعيده الهيئة
let failNextReport = false;

beforeAll(async () => {
  // خادم يحاكي بوابة فاتورة
  const s = express(); s.use(express.json({ limit: '5mb' }));
  s.use((req, _res, next) => { calls.push({ path: req.path, body: req.body, headers: req.headers }); next(); });
  s.post('/compliance', (req, res) => req.headers.otp === '123345'
    ? res.json({ requestID: 1234567890123, dispositionMessage: 'ISSUED', binarySecurityToken: token64, secret: 'compliance-secret' })
    : res.status(400).json({ errorCode: 'Invalid-OTP' }));
  s.post('/compliance/invoices', (req, res) => res.json({ validationResults: { status: 'PASS', warningMessages: [], errorMessages: [] }, reportingStatus: 'REPORTED', clearanceStatus: null }));
  s.post('/production/csids', (_req, res) => res.json({ requestID: 99, binarySecurityToken: token64, secret: 'production-secret' }));
  s.post('/invoices/reporting/single', (_req, res) => {
    if (failNextReport) { failNextReport = false; return res.status(503).json({ message: 'Service unavailable' }); }
    res.json({ validationResults: { status: 'PASS', warningMessages: [] }, reportingStatus: 'REPORTED' });
  });
  s.post('/invoices/clearance/single', (req, res) => {
    // الهيئة تعيد الفاتورة مختومة؛ نحاكي ذلك بإعادة المستند نفسه
    res.json({ validationResults: { status: 'PASS' }, clearanceStatus: 'CLEARED', clearedInvoice: req.body.invoice });
  });
  await new Promise<void>((ok) => { stub = s.listen(0, ok); });
  const port = (stub.address() as { port: number }).port;
  config.zatca.sandboxUrl = `http://127.0.0.1:${port}`;

  token = (await request(app).post('/api/auth/login').send({ email: 'owner@raseed.sa', password: 'Raseed@123' })).body.token;
  const me = await request(app).get('/api/auth/me').set(auth());
  branchId = me.body.branches.find((b: { isDefault: boolean }) => b.isDefault).id;
  await db.update(schema.branches).set({ icvCounter: 0, lastInvoiceHash: INITIAL_PIH, crNumber: '1010010000', street: 'طريق الملك فهد', buildingNo: '1234', additionalNo: '5678', district: 'العليا', city: 'الرياض', postalCode: '12345' }).where(eq(schema.branches.id, branchId));
});
afterAll(async () => {
  stub?.close();
  // إعادة الفرع إلى المرحلة الأولى حتى لا تتأثر بقية الاختبارات
  await db.update(schema.invoices).set({ zatcaStatus: 'REPORTED' }).where(eq(schema.invoices.zatcaStatus, 'PENDING'));
  await db.update(schema.branches).set({ zatcaEnabled: false, zatcaPrivateKey: null, complianceCsid: null, complianceSecret: null, productionCsid: null, productionSecret: null }).where(eq(schema.branches.id, branchId));
});

describe('ZATCA onboarding (Phase 2)', () => {
  it('rejects a wrong OTP with an Arabic message', async () => {
    const r = await request(app).post(`/api/branches/${branchId}/zatca/onboard`).set(auth()).send({ otp: '000000', env: 'sandbox' });
    expect(r.status).toBe(400); expect(r.body.message).toContain('رفضت الهيئة');
  });
  it('generates key + CSR and stores the compliance CSID', async () => {
    const r = await request(app).post(`/api/branches/${branchId}/zatca/onboard`).set(auth()).send({ otp: '123345', env: 'sandbox', invoiceType: '1100' });
    expect(r.status).toBe(200);
    const sent = calls.find((c) => c.path === '/compliance')!;
    const csr = Buffer.from((sent.body as { csr: string }).csr, 'base64').toString();
    expect(csr).toContain('BEGIN CERTIFICATE REQUEST');
    const txt = execFileSync('openssl', ['req', '-noout', '-text'], { input: csr }).toString();
    expect(txt).toContain('TSTZATCA-Code-Signing'); expect(txt).toContain('310123456700003'); expect(txt).toContain('1100');
    expect(txt).toContain('secp256k1');
  });
  it('passes the compliance check with 6 signed documents', async () => {
    const before = calls.length;
    const r = await request(app).post(`/api/branches/${branchId}/zatca/compliance`).set(auth());
    expect(r.status).toBe(200); expect(r.body.passed).toBe(true);
    expect(r.body.results.map((x: { case: string }) => x.case)).toEqual([
      'STANDARD/INVOICE', 'STANDARD/CREDIT_NOTE', 'STANDARD/DEBIT_NOTE', 'SIMPLIFIED/INVOICE', 'SIMPLIFIED/CREDIT_NOTE', 'SIMPLIFIED/DEBIT_NOTE',
    ]);
    const docs = calls.slice(before).filter((c) => c.path === '/compliance/invoices');
    expect(docs).toHaveLength(6);
    for (const d of docs) {
      expect(d.headers.authorization).toBe('Basic ' + Buffer.from(`${token64}:compliance-secret`).toString('base64'));
      expect(d.headers['accept-version']).toBe('V2');
      const xml = Buffer.from(d.body.invoice!, 'base64').toString();
      expect(canonicalHashOfFinal(xml)).toBe(d.body.invoiceHash);
      await officialValidate(xml, /<cbc:ID>PIH<\/cbc:ID>[\s\S]*?>([A-Za-z0-9+/=]{20,})</.exec(xml)![1]);
    }
  });
  it('obtains the production CSID and enables Phase 2', async () => {
    const r = await request(app).post(`/api/branches/${branchId}/zatca/production`).set(auth());
    expect(r.status).toBe(200);
    const [b] = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId));
    expect(b.zatcaEnabled).toBe(true); expect(b.productionSecret).toBe('production-secret');
  });
});

describe('ZATCA invoicing (Phase 2)', () => {
  const lookup = async (code: string) => (await request(app).get('/api/products/lookup').query({ code, branchId }).set(auth())).body[0];
  const ids: number[] = [];
  const wait = () => new Promise((r) => setTimeout(r, 300));

  it('signs, chains (ICV/PIH) and reports simplified invoices', async () => {
    const milk = await lookup('6281007000011'); const tomato = await lookup('2010001012503');
    const sales = [
      { lines: [{ productId: milk.productId, qty: 2 }, { productId: tomato.productId, qty: tomato.qty }], payments: [{ method: 'CASH', amount: 50 }] },
      { lines: [{ productId: milk.productId, qty: 3 }], discount: { type: 'PERCENT', value: 10 }, payments: [{ method: 'CARD', amount: 20.25 }] },
      { lines: [{ productId: milk.productId, qty: 1 }, { productId: tomato.productId, qty: 0.75 }], discount: { type: 'AMOUNT', value: 1.3 }, payments: [{ method: 'CASH', amount: 20 }] },
    ];
    for (const s of sales) {
      const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, ...s });
      expect(r.status).toBe(201); ids.push(r.body.id);
    }
    await wait();
    const rows = await Promise.all(ids.map(async (id) => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0]));
    for (let k = 0; k < rows.length; k++) {
      const inv = rows[k];
      expect(inv.zatcaStatus).toBe('REPORTED');
      expect(canonicalHashOfFinal(inv.xml!)).toBe(inv.invoiceHash);
      if (k > 0) { expect(inv.previousHash).toBe(rows[k - 1].invoiceHash); expect(inv.icv).toBe(rows[k - 1].icv! + 1); }
      // التوقيع يتحقق بمفتاح الشهادة
      const sig = /<ds:SignatureValue>([^<]+)</.exec(inv.xml!)![1];
      const v = createVerify('sha256'); v.update(Buffer.from(inv.invoiceHash!, 'base64'));
      expect(v.verify(new X509Certificate(`-----BEGIN CERTIFICATE-----\n${SANDBOX_CERT_B64}\n-----END CERTIFICATE-----`).publicKey, Buffer.from(sig, 'base64'))).toBe(true);
      // رمز QR يحمل الوسوم 1-9
      const qr = decodeQr(inv.qrCode!);
      expect(Object.keys(qr).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(qr[6]).toBe(inv.invoiceHash);
      await officialValidate(inv.xml!, inv.previousHash!);
    }
    expect(calls.filter((c) => c.path === '/invoices/reporting/single').length).toBeGreaterThanOrEqual(3);
  });

  it('clears a standard (B2B) invoice and stores the cleared XML', async () => {
    const cust = (await request(app).get('/api/customers').query({ search: 'الأفق' }).set(auth())).body.rows[0];
    const cheese = await lookup('6281007000035');
    const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, kind: 'STANDARD', customerId: cust.id, lines: [{ productId: cheese.productId, qty: 2 }], payments: [{ method: 'CREDIT', amount: 0 }] });
    expect(r.status).toBe(201);
    await wait();
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.body.id));
    expect(inv.zatcaStatus).toBe('CLEARED');
    expect(inv.xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
    expect(inv.xml).toContain('<cbc:CompanyID>' + cust.vatNumber);
    await officialValidate(inv.xml!, inv.previousHash!);
    ids.push(inv.id);
  });

  it('issues a signed credit note for a return, referencing the original', async () => {
    const sale = (await request(app).get(`/api/invoices/${ids[0]}`).set(auth())).body;
    const r = await request(app).post(`/api/invoices/${sale.id}/return`).set(auth()).send({ items: [{ itemId: sale.items[0].id, qty: 1 }], refundMethod: 'CASH', reason: 'منتج تالف' });
    expect(r.status).toBe(201);
    await wait();
    const [cn] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.body.id));
    expect(cn.xml).toContain('>381</cbc:InvoiceTypeCode>');
    expect(cn.xml).toContain(`<cbc:ID>${sale.number}</cbc:ID>`);
    expect(cn.zatcaStatus).toBe('REPORTED');
    await officialValidate(cn.xml!, cn.previousHash!);
  });

  it('produces valid XML with cash rounding (up and down)', async () => {
    const tomato = await lookup('2010001012503');
    const cur = (await request(app).get('/api/settings').set(auth())).body.pos;
    expect(cur.rounding).toBeDefined();
    try { for (const mode of ['UP', 'DOWN']) {
      await request(app).put('/api/settings/pos').set(auth()).send({ ...cur, rounding: { enabled: true, step: 1, mode } });
      const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, lines: [{ productId: tomato.productId, qty: 1.37 }], payments: [{ method: 'CASH', amount: 20 }] });
      expect(r.status).toBe(201);
      expect(r.body.rounding).not.toBe(0);
      await wait();
      const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.body.id));
      expect(Number.isInteger(inv.total)).toBe(true);
      await officialValidate(inv.xml!, inv.previousHash!);
    } } finally {
      await request(app).put('/api/settings/pos').set(auth()).send(cur);
    }
  });

  it('keeps an invoice pending on gateway errors and retries it automatically', async () => {
    failNextReport = true;
    const milk = await lookup('6281007000011');
    const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, lines: [{ productId: milk.productId, qty: 1 }], payments: [{ method: 'CASH', amount: 7.5 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await wait();
    let [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.body.id));
    expect(inv.zatcaStatus).toBe('PENDING');
    const res = await retryPendingInvoices();
    expect(res.done).toBeGreaterThanOrEqual(1);
    [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.body.id));
    expect(inv.zatcaStatus).toBe('REPORTED');
  });
});

/** فحص المستند بأداة الهيئة الرسمية إن كانت متاحة (ZATCA_CLI) */
async function officialValidate(xml: string, pih: string) {
  const cli = process.env.ZATCA_CLI; if (!cli) return;
  const dir = mkdtempSync(join(tmpdir(), 'zv-'));
  writeFileSync(join(dir, 'inv.xml'), xml);
  writeFileSync(join(dir, 'cert.pem'), `-----BEGIN CERTIFICATE-----\n${SANDBOX_CERT_B64}\n-----END CERTIFICATE-----\n`);
  const out = JSON.parse(execFileSync(cli, ['validate', '-c', join(dir, 'cert.pem'), '-p', pih, join(dir, 'inv.xml')]).toString());
  const details = out.data.details;
  if (!details.isValid) console.error(out.data.errorsAndWarnings);
  expect(details.isValid, JSON.stringify(out.data.errorsAndWarnings)).toBe(true);
}
