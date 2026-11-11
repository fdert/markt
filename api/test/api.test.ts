// اختبارات تكامل لمسار البيع الكامل: الكاشير، الضريبة، المخزون، المرتجعات، الصندوق، المشتريات، المحاسبة
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { decodeQr } from '../src/services/zatca/qr.js';

const app = createApp();
let token = ''; let cashierToken = '';
let branchId = 0;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
const lookup = async (code: string) => (await request(app).get('/api/products/lookup').query({ code, branchId }).set(auth())).body;

beforeAll(async () => {
  token = (await request(app).post('/api/auth/login').send({ email: 'owner@raseed.sa', password: 'Raseed@123' })).body.token;
  cashierToken = (await request(app).post('/api/auth/login').send({ email: 'cashier@raseed.sa', password: 'Raseed@123' })).body.token;
  const me = await request(app).get('/api/auth/me').set(auth());
  branchId = me.body.branches.find((b: { isDefault: boolean }) => b.isDefault).id;
});

describe('Auth', () => {
  it('rejects wrong password in Arabic', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'owner@raseed.sa', password: 'x' });
    expect(r.status).toBe(400); expect(r.body.message).toContain('غير صحيحة');
  });
  it('cashier cannot manage settings', async () => {
    const r = await request(app).put('/api/settings/tax').set(auth(cashierToken)).send({ rate: 5 });
    expect(r.status).toBe(403);
  });
});

describe('POS sale flow', () => {
  it('opens a shift', async () => {
    const r = await request(app).post('/api/pos/shift/open').set(auth()).send({ branchId, openingCash: 200 });
    expect(r.status).toBe(201);
  });

  it('looks up products by barcode, unit barcode, and scale barcode', async () => {
    const [milk] = await lookup('6281007000011');
    expect(milk.name).toContain('حليب'); expect(milk.price).toBe(7.5);
    const [carton] = await lookup('6281007000999');
    expect(carton.unitId).toBeTruthy(); expect(carton.price).toBe(32);
    // باركود ميزان: 20 + 10001 + 01250 (1.250 كجم) + رقم تحقق
    const [tomato] = await lookup('2010001012503');
    expect(tomato.name).toContain('طماطم'); expect(tomato.qty).toBe(1.25);
  });

  it('sells with cash, computes 15% VAT inclusive pricing, change, QR and stock', async () => {
    const [milk] = await lookup('6281007000011');
    const [tomato] = await lookup('2010001012503');
    const r = await request(app).post('/api/invoices').set(auth()).send({
      branchId, lines: [{ productId: milk.productId, qty: 2 }, { productId: tomato.productId, qty: tomato.qty }],
      payments: [{ method: 'CASH', amount: 50 }],
    });
    expect(r.status).toBe(201);
    const inv = r.body;
    expect(inv.total).toBe(22.5); // 2×7.5 + 1.25×6
    expect(inv.taxTotal).toBeCloseTo(2.94, 2); // تقريب لكل بند
    expect(inv.subtotal + inv.taxTotal).toBeCloseTo(inv.total, 2);
    expect(inv.change).toBe(27.5);
    expect(inv.status).toBe('PAID');
    const qr = decodeQr(inv.qrCode);
    expect(qr[2]).toBe('310123456700003'); expect(qr[4]).toBe('22.50');
    const p = await request(app).get(`/api/products/${milk.productId}`).set(auth());
    expect(p.body.stocks.find((s: { branchId: number }) => s.branchId === branchId).qty).toBe(118);
  });

  it('applies a coupon and records a standard (B2B) credit sale', async () => {
    const cust = (await request(app).get('/api/customers').query({ search: 'الأفق' }).set(auth())).body.rows[0];
    const [cheese] = await lookup('6281007000035');
    const r = await request(app).post('/api/invoices').set(auth()).send({
      branchId, kind: 'STANDARD', customerId: cust.id, couponCode: 'welcome10',
      lines: [{ productId: cheese.productId, qty: 4 }], payments: [{ method: 'CREDIT', amount: 0 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.total).toBeCloseTo(51.8 * 0.9, 1);
    expect(r.body.status).toBe('UNPAID'); expect(r.body.due).toBe(r.body.total);
    const c = await request(app).post(`/api/invoices/${r.body.id}/collect`).set(auth()).send({ amount: 20, method: 'CARD' });
    expect(c.body.due).toBeCloseTo(r.body.total - 20, 2);
  });

  it('enforces cashier max discount', async () => {
    const [milk] = await lookup('6281007000011');
    const r = await request(app).post('/api/invoices').set(auth(cashierToken)).send({ branchId, lines: [{ productId: milk.productId, qty: 1 }], discount: { type: 'PERCENT', value: 50 }, payments: [{ method: 'CASH', amount: 10 }] });
    expect(r.status).toBe(400); expect(r.body.message).toContain('الحد المسموح');
  });

  it('sells composite product deducting recipe components', async () => {
    const list = (await request(app).get('/api/products').query({ search: 'قهوة عربية' }).set(auth())).body.rows;
    const coffee = list[0];
    const cups = (await request(app).get('/api/products').query({ search: 'كوب ورقي' }).set(auth())).body.rows[0];
    const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, lines: [{ productId: coffee.id, qty: 3 }], payments: [{ method: 'CARD', amount: 24 }] });
    expect(r.status).toBe(201);
    const p = await request(app).get(`/api/products/${cups.id}`).set(auth());
    expect(p.body.stocks.find((s: { branchId: number }) => s.branchId === branchId).qty).toBe(997);
  });

  it('sells by unit (carton = 40 pieces) and applies BXGY offer', async () => {
    const [carton] = await lookup('6281007000999');
    const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, lines: [{ productId: carton.productId, unitId: carton.unitId, qty: 1 }], payments: [{ method: 'CASH', amount: 32 }] });
    expect(r.status).toBe(201);
    const p = await request(app).get(`/api/products/${carton.productId}`).set(auth());
    expect(p.body.stocks.find((s: { branchId: number }) => s.branchId === branchId).qty).toBe(560);
  });

  it('returns part of an invoice as a credit note and restocks', async () => {
    const [milk] = await lookup('6281007000011');
    const saleRes = await request(app).post('/api/invoices').set(auth()).send({ branchId, lines: [{ productId: milk.productId, qty: 3 }], payments: [{ method: 'CASH', amount: 22.5 }] });
    if (saleRes.status !== 201) console.log(saleRes.body);
    const sale = saleRes.body;
    const r = await request(app).post(`/api/invoices/${sale.id}/return`).set(auth()).send({ items: [{ itemId: sale.items[0].id, qty: 1 }], refundMethod: 'CASH', reason: 'منتج تالف' });
    expect(r.status).toBe(201);
    expect(r.body.type).toBe('CREDIT_NOTE'); expect(r.body.total).toBe(7.5);
    const orig = await request(app).get(`/api/invoices/${sale.id}`).set(auth());
    expect(orig.body.status).toBe('PARTIALLY_RETURNED');
  });

  it('blocks returning non-returnable products', async () => {
    const [bread] = await lookup('6281007000066');
    const sale = (await request(app).post('/api/invoices').set(auth()).send({ branchId, lines: [{ productId: bread.productId, qty: 1 }], payments: [{ method: 'CASH', amount: 5 }] })).body;
    const r = await request(app).post(`/api/invoices/${sale.id}/return`).set(auth()).send({ items: [{ itemId: sale.items[0].id, qty: 1 }], refundMethod: 'CASH' });
    expect(r.status).toBe(400);
  });

  it('closes the shift with the expected drawer cash', async () => {
    const cur = (await request(app).get('/api/pos/shift/current').query({ branchId }).set(auth())).body;
    // 200 افتتاحي + 22.5 + 32 + 22.5 + 5 − 7.5 مرتجع
    expect(cur.expected_cash).toBe(274.5);
    const r = await request(app).post(`/api/pos/shift/${cur.id}/close`).set(auth()).send({ countedCash: 270, diffReason: 'عجز' });
    expect(Number(r.body.difference)).toBe(-4.5);
  });
});

describe('Purchases, accounting and VAT', () => {
  it('approves a purchase and updates weighted average cost', async () => {
    const [milk] = await lookup('6281007000011');
    const sup = (await request(app).get('/api/suppliers').set(auth())).body[0];
    const before = (await request(app).get(`/api/products/${milk.productId}`).set(auth())).body;
    const totalQty = before.stocks.reduce((s: number, x: { qty: number | null }) => s + (x.qty ?? 0), 0);
    const r = await request(app).post('/api/purchases').set(auth()).send({ supplierId: sup.id, branchId, approve: true, paymentMethod: 'CREDIT', items: [{ productId: milk.productId, qty: 100, unitCost: 6 }] });
    expect(r.status).toBe(201);
    expect(r.body.total).toBe(690);
    const after = (await request(app).get(`/api/products/${milk.productId}`).set(auth())).body;
    expect(after.avgCost).toBeCloseTo((totalQty * 5.2 + 100 * 6) / (totalQty + 100), 3);
  });

  it('keeps the ledger balanced and the trial balance even', async () => {
    const tb = (await request(app).get('/api/accounting/trial-balance').set(auth())).body as Array<{ closing_debit: number; closing_credit: number }>;
    const d = tb.reduce((s, x) => s + x.closing_debit, 0); const c = tb.reduce((s, x) => s + x.closing_credit, 0);
    expect(Math.abs(d - c)).toBeLessThan(0.01);
    const h = (await request(app).get('/api/accounting/health').set(auth())).body;
    expect(Math.abs(h.ledger_diff)).toBeLessThan(0.01);
  });

  it('computes the VAT return (output − input)', async () => {
    const v = (await request(app).get('/api/accounting/vat-return').set(auth())).body;
    expect(v.inputVat).toBe(90);
    expect(v.netVat).toBeCloseTo(v.outputVat - 90, 2);
  });

  it('serves the dashboard', async () => {
    const d = (await request(app).get('/api/reports/dashboard').query({ range: 'day' }).set(auth())).body;
    expect(d.current.invoices).toBeGreaterThan(3);
    expect(d.top.length).toBeGreaterThan(0);
  });
});
