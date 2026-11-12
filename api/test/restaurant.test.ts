// اختبارات المزايا المضافة بعد مسح نظام نقاط سعد
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();
let token = ''; let branchId = 0;
const auth = () => ({ Authorization: `Bearer ${token}` });
const product = async (code: string) => (await request(app).get('/api/products/lookup').query({ code, branchId }).set(auth())).body[0];
const setPos = (v: object) => request(app).put('/api/settings/pos').set(auth()).send(v);

beforeAll(async () => {
  token = (await request(app).post('/api/auth/login').send({ email: 'owner@raseed.sa', password: 'Raseed@123' })).body.token;
  branchId = (await request(app).get('/api/auth/me').set(auth())).body.branches.find((b: { isDefault: boolean }) => b.isDefault).id;
});

describe('Cashier extras', () => {
  it('rejects fractional quantities for non-weighted products by default', async () => {
    const milk = await product('6281007000011');
    const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, lines: [{ productId: milk.productId, qty: 1.5 }], payments: [{ method: 'CASH', amount: 20 }] });
    expect(r.status).toBe(400); expect(r.body.message).toContain('عدداً صحيحاً');
  });

  it('rounds the invoice to the nearest 0.5 while keeping VAT consistent', async () => {
    await setPos({ rounding: { enabled: true, step: 0.5, mode: 'UP' } });
    const cheese = await product('6281007000035'); // 12.95
    const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, orderType: 'DINE_IN', lines: [{ productId: cheese.productId, qty: 1 }], payments: [{ method: 'CASH', amount: 13 }] });
    expect(r.status).toBe(201);
    expect(r.body.total).toBe(13); expect(r.body.rounding).toBe(0.05);
    expect(r.body.subtotal + r.body.taxTotal).toBeCloseTo(13, 2);
    expect(r.body.orderType).toBe('DINE_IN'); expect(r.body.orderNo).toBeGreaterThan(0);
    await setPos({ rounding: { enabled: false, step: 0.5, mode: 'NEAREST' } });
  });

  it('applies a price list (wholesale −10% with a special price)', async () => {
    const milk = await product('6281007000011');
    const water = await product('6281007000042');
    const pl = (await request(app).post('/api/price-lists').set(auth()).send({ name: 'الجملة', adjustPercent: -10, items: [{ productId: milk.productId, price: 6 }] })).body;
    const r = await request(app).post('/api/pos/preview').set(auth()).send({ branchId, priceListId: pl.id, lines: [{ productId: milk.productId, qty: 2 }, { productId: water.productId, qty: 10 }] });
    expect(r.body.total).toBe(12 + 9); // 2×6 + 10×0.9
  });

  it('tops up a customer wallet and pays from it', async () => {
    const cust = (await request(app).get('/api/customers').query({ search: 'نورة' }).set(auth())).body.rows[0];
    const t = await request(app).post(`/api/customers/${cust.id}/wallet/topup`).set(auth()).send({ amount: 50, method: 'CASH' });
    expect(t.body.balance).toBe(50);
    const bread = await product('6281007000066');
    const r = await request(app).post('/api/invoices').set(auth()).send({ branchId, customerId: cust.id, lines: [{ productId: bread.productId, qty: 2 }], payments: [{ method: 'WALLET', amount: 10 }] });
    expect(r.status).toBe(201); expect(r.body.status).toBe('PAID');
    const w = (await request(app).get(`/api/customers/${cust.id}/wallet`).set(auth())).body;
    expect(w.walletBalance).toBe(40); expect(w.transactions).toHaveLength(2);
    const over = await request(app).post('/api/invoices').set(auth()).send({ branchId, customerId: cust.id, lines: [{ productId: bread.productId, qty: 10 }], payments: [{ method: 'WALLET', amount: 50 }] });
    expect(over.status).toBe(400);
  });

  it('accepts delivery-app payment methods only after activation and reports them', async () => {
    const yogurt = await product('6281007000028');
    const body = { branchId, orderType: 'DELIVERY', lines: [{ productId: yogurt.productId, qty: 2 }], payments: [{ method: 'HUNGERSTATION', amount: 9 }] };
    expect((await request(app).post('/api/invoices').set(auth()).send(body)).status).toBe(400);
    const pm = (await request(app).get('/api/payment-methods').set(auth())).body.find((m: { code: string }) => m.code === 'HUNGERSTATION');
    await request(app).put(`/api/payment-methods/${pm.id}`).set(auth()).send({ active: true });
    expect((await request(app).post('/api/invoices').set(auth()).send(body)).status).toBe(201);
    const daily = (await request(app).get('/api/reports/daily').set(auth())).body;
    expect(daily.methods.find((m: { method: string }) => m.method === 'HUNGERSTATION').total).toBe(9);
    expect(daily.types.find((t: { type: string }) => t.type === 'DELIVERY').count).toBe(1);
  });

  it('routes kitchen tickets to stations by category', async () => {
    const cats = (await request(app).get('/api/categories').set(auth())).body as Array<{ id: number; name: string }>;
    const coffeeCat = cats.find((c) => c.name === 'القهوة')!.id;
    await request(app).post('/api/kitchen/stations').set(auth()).send({ name: 'ركن القهوة', categoryIds: [coffeeCat], printer: '192.168.1.60:9100' });
    await request(app).post('/api/kitchen/stations').set(auth()).send({ name: 'المطبخ الرئيسي' });
    const coffee = (await request(app).get('/api/products').query({ search: 'قهوة عربية' }).set(auth())).body.rows[0];
    const bread = await product('6281007000066');
    const r = await request(app).post('/api/kitchen/send').set(auth()).send({ branchId, orderNo: 7, orderType: 'DINE_IN', lines: [{ productId: coffee.id, name: coffee.name, qty: 2 }, { productId: bread.productId, name: bread.name, qty: 1 }] });
    expect(r.body.orders).toHaveLength(2);
    const bar = r.body.orders.find((o: { station: { name: string } }) => o.station.name === 'ركن القهوة');
    expect(bar.items[0].qty).toBe(2); expect(bar.station.printer).toBe('192.168.1.60:9100');
    const list = (await request(app).get('/api/kitchen/orders').set(auth())).body;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect((await request(app).post(`/api/kitchen/orders/${bar.id}/status`).set(auth()).send({ status: 'READY' })).body.status).toBe('READY');
  });

  it('manages tables and marks a table occupied while its cart is held', async () => {
    await request(app).post('/api/tables/bulk').set(auth()).send({ branchId, from: 1, to: 4, area: 'الصالة' });
    const tables = (await request(app).get('/api/tables').query({ branchId }).set(auth())).body;
    expect(tables).toHaveLength(4);
    await request(app).post('/api/pos/held').set(auth()).send({ branchId, tableId: tables[0].id, orderType: 'DINE_IN', data: { lines: [{ qty: 2, price: 8 }] } });
    const after = (await request(app).get('/api/tables').query({ branchId }).set(auth())).body;
    expect(after[0].occupied).toBe(true); expect(after[0].amount).toBe(16);
  });
});

describe('Inventory extras', () => {
  it('records damaged stock with an accounting entry', async () => {
    const yogurt = await product('6281007000028');
    const r = await request(app).post('/api/inventory/damaged').set(auth()).send({ branchId, productId: yogurt.productId, qty: 3, reason: 'انتهاء الصلاحية' });
    expect(r.status).toBe(201); expect(r.body.value).toBe(9);
    expect((await request(app).get('/api/inventory/damaged').set(auth())).body[0].qty).toBe(-3);
  });

  it('runs a stocktake session: scan to count, approve, and adjust stock', async () => {
    const st = (await request(app).post('/api/stocktakes').set(auth()).send({ branchId, name: 'جرد نوفمبر', startDate: '2026-11-01', endDate: '2026-11-30' })).body;
    const det = (await request(app).get(`/api/stocktakes/${st.id}`).set(auth())).body;
    const cheese = det.items.find((i: { barcode: string }) => i.barcode === '6281007000035');
    await request(app).post(`/api/stocktakes/${st.id}/count`).set(auth()).send({ code: '6281007000035', qty: 30 });
    await request(app).post(`/api/stocktakes/${st.id}/count`).set(auth()).send({ code: '6281007000035', qty: 2, mode: 'ADD' });
    const ap = (await request(app).post(`/api/stocktakes/${st.id}/approve`).set(auth()).send({})).body;
    expect(ap.adjusted).toBe(1);
    const p = (await request(app).get(`/api/products/${cheese.productId}`).set(auth())).body;
    expect(p.stocks.find((s: { branchId: number }) => s.branchId === branchId).qty).toBe(32);
  });

  it('keeps the ledger balanced after all new operations', async () => {
    const h = (await request(app).get('/api/accounting/health').set(auth())).body;
    expect(Math.abs(h.ledger_diff)).toBeLessThan(0.01);
  });
});

describe('Public smart menu', () => {
  it('is hidden until enabled, then lists products without auth', async () => {
    expect((await request(app).get('/api/public/menu')).status).toBe(404);
    await request(app).put('/api/settings/menu').set(auth()).send({ enabled: true, title: 'منيو المقهى' });
    const r = await request(app).get('/api/public/menu');
    expect(r.status).toBe(200); expect(r.body.store.name).toBe('منيو المقهى');
    expect(r.body.products.length).toBeGreaterThan(3);
  });
});
