// مزايا الكاشير المتقدمة: الطاولات، مجموعات الأسعار، المطبخ، طرق الدفع، المحفظة، الجرد، التالف، التقرير اليومي
import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, pool, schema } from '../db/index.js';
import { ah, badRequest, notFound } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { nextNumber } from '../lib/counter.js';
import { r2, r3 } from '../lib/money.js';
import { logActivity } from '../lib/activity.js';
import { moveStock, isStockTracked } from '../services/inventory.js';
import { postEntry, methodAccount } from '../services/accounting.js';
import { nextOrderNo } from '../services/sales.js';
import { refreshPaymentMethods } from '../services/bootstrap.js';

const r = Router();

// ===== الطاولات =====
r.get('/tables', can('pos.use', 'settings.manage'), ah(async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const tables = await db.select().from(schema.restaurantTables)
    .where(branchId ? eq(schema.restaurantTables.branchId, branchId) : undefined).orderBy(asc(schema.restaurantTables.sortOrder), asc(schema.restaurantTables.name));
  const held = await db.select({ id: schema.heldCarts.id, tableId: schema.heldCarts.tableId, orderNo: schema.heldCarts.orderNo, createdAt: schema.heldCarts.createdAt, data: schema.heldCarts.data }).from(schema.heldCarts)
    .where(sql`${schema.heldCarts.tableId} is not null`);
  res.json(tables.map((t) => {
    const h = held.find((x) => x.tableId === t.id);
    const lines = (h?.data as { lines?: Array<{ qty: number; price: number }> } | undefined)?.lines ?? [];
    return { ...t, occupied: !!h, heldId: h?.id ?? null, orderNo: h?.orderNo ?? null, since: h?.createdAt ?? null, amount: r2(lines.reduce((s, l) => s + l.qty * l.price, 0)) };
  }));
}));
const tableBody = z.object({ branchId: z.number(), name: z.string().min(1, 'اسم الطاولة مطلوب.'), area: z.string().nullish(), seats: z.number().int().positive().default(4), active: z.boolean().default(true), sortOrder: z.number().default(0) });
r.post('/tables', can('settings.manage'), ah(async (req, res) => { const [row] = await db.insert(schema.restaurantTables).values(tableBody.parse(req.body)).returning(); res.status(201).json(row); }));
r.post('/tables/bulk', can('settings.manage'), ah(async (req, res) => {
  const b = z.object({ branchId: z.number(), prefix: z.string().default('طاولة'), from: z.number().int().min(1), to: z.number().int().max(500), area: z.string().nullish(), seats: z.number().int().default(4) }).parse(req.body);
  if (b.to < b.from) throw badRequest('النطاق غير صحيح.');
  const rows = Array.from({ length: b.to - b.from + 1 }, (_, i) => ({ branchId: b.branchId, name: `${b.prefix} ${b.from + i}`, area: b.area, seats: b.seats, sortOrder: b.from + i }));
  await db.insert(schema.restaurantTables).values(rows);
  res.status(201).json({ created: rows.length });
}));
r.put('/tables/:id', can('settings.manage'), ah(async (req, res) => { const [row] = await db.update(schema.restaurantTables).set(tableBody.partial().parse(req.body)).where(eq(schema.restaurantTables.id, Number(req.params.id))).returning(); res.json(row); }));
r.delete('/tables/:id', can('settings.manage'), ah(async (req, res) => { await db.delete(schema.restaurantTables).where(eq(schema.restaurantTables.id, Number(req.params.id))); res.json({ message: 'تم الحذف.' }); }));

// ===== رقم الطلب =====
r.post('/pos/order-number', can('pos.use'), ah(async (req, res) => {
  const { branchId } = z.object({ branchId: z.number() }).parse(req.body);
  res.json({ orderNo: await nextOrderNo(db, branchId) });
}));

// ===== مجموعات الأسعار =====
r.get('/price-lists', ah(async (_req, res) => {
  const rows = await db.select({ id: schema.priceLists.id, name: schema.priceLists.name, adjustPercent: schema.priceLists.adjustPercent, active: schema.priceLists.active,
    itemsCount: sql<number>`(select count(*)::int from price_list_items i where i.price_list_id = ${schema.priceLists.id})` }).from(schema.priceLists).orderBy(asc(schema.priceLists.name));
  res.json(rows);
}));
r.get('/price-lists/:id', ah(async (req, res) => {
  const [pl] = await db.select().from(schema.priceLists).where(eq(schema.priceLists.id, Number(req.params.id)));
  if (!pl) throw notFound('مجموعة الأسعار غير موجودة.');
  const items = await db.select({ id: schema.priceListItems.id, productId: schema.priceListItems.productId, unitId: schema.priceListItems.unitId, price: schema.priceListItems.price, name: schema.products.name, basePrice: schema.products.price })
    .from(schema.priceListItems).innerJoin(schema.products, eq(schema.products.id, schema.priceListItems.productId)).where(eq(schema.priceListItems.priceListId, pl.id));
  res.json({ ...pl, items });
}));
const plBody = z.object({ name: z.string().min(2, 'اسم المجموعة مطلوب.'), adjustPercent: z.number().min(-100).max(500).default(0), active: z.boolean().default(true),
  items: z.array(z.object({ productId: z.number(), unitId: z.number().nullish(), price: z.number().min(0) })).default([]) });
async function savePriceList(id: number | null, b: z.infer<typeof plBody>) {
  return db.transaction(async (tx) => {
    const { items, ...data } = b;
    const [pl] = id ? await tx.update(schema.priceLists).set(data).where(eq(schema.priceLists.id, id)).returning() : await tx.insert(schema.priceLists).values(data).returning();
    await tx.delete(schema.priceListItems).where(eq(schema.priceListItems.priceListId, pl.id));
    if (items.length) await tx.insert(schema.priceListItems).values(items.map((i) => ({ ...i, unitId: i.unitId ?? null, priceListId: pl.id })));
    return pl;
  });
}
r.post('/price-lists', can('products.manage'), ah(async (req, res) => res.status(201).json(await savePriceList(null, plBody.parse(req.body)))));
r.put('/price-lists/:id', can('products.manage'), ah(async (req, res) => res.json(await savePriceList(Number(req.params.id), plBody.parse(req.body)))));
r.delete('/price-lists/:id', can('products.manage'), ah(async (req, res) => { await db.delete(schema.priceLists).where(eq(schema.priceLists.id, Number(req.params.id))); res.json({ message: 'تم الحذف.' }); }));

// ===== أقسام المطبخ وشاشة المطبخ =====
r.get('/kitchen/stations', ah(async (_req, res) => res.json(await db.select().from(schema.kitchenStations).orderBy(asc(schema.kitchenStations.id)))));
const stationBody = z.object({ name: z.string().min(2, 'اسم القسم مطلوب.'), categoryIds: z.array(z.number()).default([]), printer: z.string().nullish(), showOnScreen: z.boolean().default(true), active: z.boolean().default(true) });
r.post('/kitchen/stations', can('settings.manage'), ah(async (req, res) => { const [row] = await db.insert(schema.kitchenStations).values(stationBody.parse(req.body)).returning(); res.status(201).json(row); }));
r.put('/kitchen/stations/:id', can('settings.manage'), ah(async (req, res) => { const [row] = await db.update(schema.kitchenStations).set(stationBody.partial().parse(req.body)).where(eq(schema.kitchenStations.id, Number(req.params.id))).returning(); res.json(row); }));
r.delete('/kitchen/stations/:id', can('settings.manage'), ah(async (req, res) => { await db.delete(schema.kitchenStations).where(eq(schema.kitchenStations.id, Number(req.params.id))); res.json({ message: 'تم الحذف.' }); }));

/** إرسال بنود إلى المطبخ: تُوزَّع على الأقسام حسب تصنيف المنتج، ويعود ما يُطبع لكل قسم */
r.post('/kitchen/send', can('pos.use'), ah(async (req, res) => {
  const b = z.object({
    branchId: z.number(), orderNo: z.number().nullish(), orderType: z.string().nullish(), tableId: z.number().nullish(), customerName: z.string().nullish(), notes: z.string().nullish(),
    invoiceId: z.number().nullish(), heldCartId: z.number().nullish(),
    lines: z.array(z.object({ productId: z.number().nullish(), name: z.string(), qty: z.number(), note: z.string().nullish() })).min(1),
  }).parse(req.body);
  const stations = (await db.select().from(schema.kitchenStations).where(eq(schema.kitchenStations.active, true)));
  if (!stations.length) return res.json({ orders: [] });
  const ids = b.lines.map((l) => l.productId).filter(Boolean) as number[];
  const prods = ids.length ? await db.select({ id: schema.products.id, categoryId: schema.products.categoryId }).from(schema.products).where(inArray(schema.products.id, ids)) : [];
  const cats = await db.select({ id: schema.categories.id, parentId: schema.categories.parentId }).from(schema.categories);
  const rootOf = (id: number | null | undefined) => { let c = cats.find((x) => x.id === id); while (c?.parentId) c = cats.find((x) => x.id === c!.parentId); return c?.id; };
  const table = b.tableId ? (await db.select().from(schema.restaurantTables).where(eq(schema.restaurantTables.id, b.tableId)))[0] : null;
  const fallback = stations.find((s) => !s.categoryIds.length) ?? stations[0];
  const groups = new Map<number, typeof b.lines>();
  for (const l of b.lines) {
    const catId = prods.find((p) => p.id === l.productId)?.categoryId;
    const st = stations.find((s) => s.categoryIds.length && (s.categoryIds.includes(catId ?? -1) || s.categoryIds.includes(rootOf(catId) ?? -1))) ?? fallback;
    groups.set(st.id, [...(groups.get(st.id) ?? []), l]);
  }
  const orders = [];
  for (const [stationId, items] of groups) {
    const [o] = await db.insert(schema.kitchenOrders).values({ branchId: b.branchId, stationId, invoiceId: b.invoiceId ?? null, heldCartId: b.heldCartId ?? null, orderNo: b.orderNo ?? null, orderType: b.orderType ?? null,
      tableName: table?.name ?? null, customerName: b.customerName ?? null, notes: b.notes ?? null, items: items.map((i) => ({ name: i.name, qty: i.qty, note: i.note ?? null })) }).returning();
    orders.push({ ...o, station: stations.find((s) => s.id === stationId) });
  }
  res.json({ orders });
}));

r.get('/kitchen/orders', ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const statuses = (q.status ?? 'NEW,PREPARING,READY').split(',');
  const rows = await db.select().from(schema.kitchenOrders).where(and(inArray(schema.kitchenOrders.status, statuses), q.branchId ? eq(schema.kitchenOrders.branchId, Number(q.branchId)) : undefined,
    q.stationId ? eq(schema.kitchenOrders.stationId, Number(q.stationId)) : undefined, sql`${schema.kitchenOrders.createdAt} > now() - interval '24 hours'`)).orderBy(asc(schema.kitchenOrders.id));
  res.json(rows);
}));
r.post('/kitchen/orders/:id/status', ah(async (req, res) => {
  const { status } = z.object({ status: z.enum(['NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']) }).parse(req.body);
  const [row] = await db.update(schema.kitchenOrders).set({ status, updatedAt: new Date() }).where(eq(schema.kitchenOrders.id, Number(req.params.id))).returning();
  res.json(row);
}));

// ===== طرق الدفع =====
r.get('/payment-methods', ah(async (_req, res) => res.json(await db.select().from(schema.paymentMethods).orderBy(asc(schema.paymentMethods.sortOrder), asc(schema.paymentMethods.id)))));
const pmBody = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,30}$/, 'الرمز حروف إنجليزية كبيرة وأرقام فقط.'), name: z.string().min(2, 'اسم طريقة الدفع مطلوب.'),
  kind: z.enum(['CASH', 'CARD', 'TRANSFER', 'BNPL', 'DELIVERY_APP', 'ONLINE', 'OTHER']).default('OTHER'), accountKey: z.enum(['CASH', 'BANK', 'APP_RECEIVABLE']).default('APP_RECEIVABLE'),
  active: z.boolean().default(true), sortOrder: z.number().default(50), commissionPercent: z.number().min(0).max(100).default(0) });
r.post('/payment-methods', can('settings.manage'), ah(async (req, res) => { const [row] = await db.insert(schema.paymentMethods).values(pmBody.parse(req.body)).returning(); await refreshPaymentMethods(); res.status(201).json(row); }));
r.put('/payment-methods/:id', can('settings.manage'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const [ex] = await db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.id, id));
  if (!ex) throw notFound('طريقة الدفع غير موجودة.');
  const b = pmBody.partial().parse(req.body);
  if (ex.builtIn) { delete b.code; delete b.accountKey; delete b.kind; if (ex.code === 'CASH') b.active = true; }
  const [row] = await db.update(schema.paymentMethods).set(b).where(eq(schema.paymentMethods.id, id)).returning();
  await refreshPaymentMethods();
  res.json(row);
}));

// ===== محفظة العميل =====
r.get('/customers/:id/wallet', can('customers.view', 'pos.use'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select({ walletBalance: schema.customers.walletBalance, name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.id, id));
  if (!c) throw notFound('العميل غير موجود.');
  const tx = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.customerId, id)).orderBy(desc(schema.walletTransactions.id)).limit(100);
  res.json({ ...c, transactions: tx });
}));
r.post('/customers/:id/wallet/topup', can('customers.manage', 'pos.use'), ah(async (req, res) => {
  const b = z.object({ amount: z.number().positive('أدخل مبلغاً صحيحاً.'), method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']).default('CASH'), note: z.string().nullish(), branchId: z.number().optional() }).parse(req.body);
  const id = Number(req.params.id);
  const out = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.customers).where(eq(schema.customers.id, id));
    if (!c) throw notFound('العميل غير موجود.');
    const balanceAfter = r2(c.walletBalance + b.amount);
    await tx.update(schema.customers).set({ walletBalance: balanceAfter }).where(eq(schema.customers.id, id));
    await tx.insert(schema.walletTransactions).values({ customerId: id, amount: b.amount, balanceAfter, type: 'TOPUP', method: b.method, note: b.note ?? 'شحن المحفظة', userId: req.user!.id });
    const [shift] = await tx.select().from(schema.shifts).where(and(eq(schema.shifts.userId, req.user!.id), eq(schema.shifts.status, 'OPEN')));
    if (shift && b.method === 'CASH') await tx.insert(schema.shiftEntries).values({ shiftId: shift.id, type: 'CASH_IN', amount: b.amount, note: `شحن محفظة ${c.name}` });
    await postEntry(tx, { description: `شحن محفظة العميل ${c.name}`, refType: 'wallet', refId: id, branchId: b.branchId, userId: req.user!.id, lines: [{ key: methodAccount(b.method), debit: b.amount }, { key: 'CUSTOMER_WALLET', credit: b.amount }] });
    await logActivity({ userId: req.user!.id, action: 'wallet.topup', entity: 'customer', entityId: id, summary: `شحن محفظة ${c.name} بمبلغ ${b.amount.toFixed(2)}` }, tx);
    return { balance: balanceAfter };
  });
  res.json(out);
}));

// ===== جلسات الجرد =====
r.get('/stocktakes', can('inventory.adjust', 'products.view'), ah(async (_req, res) => {
  const rows = await db.select({ id: schema.stocktakes.id, number: schema.stocktakes.number, name: schema.stocktakes.name, branchId: schema.stocktakes.branchId, startDate: schema.stocktakes.startDate, endDate: schema.stocktakes.endDate,
    status: schema.stocktakes.status, createdAt: schema.stocktakes.createdAt, approvedAt: schema.stocktakes.approvedAt, branch: sql<string>`(select name from branches b where b.id = ${schema.stocktakes.branchId})`,
    items: sql<number>`(select count(*)::int from stocktake_items i where i.stocktake_id = ${schema.stocktakes.id})`, counted: sql<number>`(select count(*)::int from stocktake_items i where i.stocktake_id = ${schema.stocktakes.id} and i.counted_qty is not null)` })
    .from(schema.stocktakes).orderBy(desc(schema.stocktakes.id));
  res.json(rows);
}));
r.post('/stocktakes', can('inventory.adjust'), ah(async (req, res) => {
  const b = z.object({ branchId: z.number(), name: z.string().min(2, 'اسم الجرد مطلوب.'), startDate: z.string(), endDate: z.string(), categoryId: z.number().nullish(), notes: z.string().nullish() }).parse(req.body);
  const st = await db.transaction(async (tx) => {
    const [st] = await tx.insert(schema.stocktakes).values({ number: await nextNumber(tx, 'stocktake', 'ST-'), branchId: b.branchId, name: b.name, startDate: new Date(b.startDate), endDate: new Date(b.endDate), notes: b.notes, userId: req.user!.id }).returning();
    const { rows } = await pool.query(`select p.id, coalesce(s.qty,0)::float as qty, coalesce(nullif(p.avg_cost,0), p.cost)::float as cost from products p left join stocks s on s.product_id = p.id and s.branch_id = $1
      where p.active and not p.unlimited and not p.is_composite and p.type in ('SIMPLE','PRO','RENTAL') and ($2::int is null or p.category_id = $2) order by p.name`, [b.branchId, b.categoryId ?? null]);
    if (rows.length) await tx.insert(schema.stocktakeItems).values(rows.map((x) => ({ stocktakeId: st.id, productId: x.id, systemQty: x.qty, unitCost: x.cost })));
    return st;
  });
  res.status(201).json(st);
}));
r.get('/stocktakes/:id', can('inventory.adjust', 'products.view'), ah(async (req, res) => {
  const [st] = await db.select().from(schema.stocktakes).where(eq(schema.stocktakes.id, Number(req.params.id)));
  if (!st) throw notFound('الجرد غير موجود.');
  const items = await db.select({ id: schema.stocktakeItems.id, productId: schema.stocktakeItems.productId, systemQty: schema.stocktakeItems.systemQty, countedQty: schema.stocktakeItems.countedQty, unitCost: schema.stocktakeItems.unitCost, name: schema.products.name, barcode: schema.products.barcode })
    .from(schema.stocktakeItems).innerJoin(schema.products, eq(schema.products.id, schema.stocktakeItems.productId)).where(eq(schema.stocktakeItems.stocktakeId, st.id)).orderBy(asc(schema.products.name));
  res.json({ ...st, items });
}));
/** تسجيل العد: يقبل المسح بالباركود (code) أو رقم المنتج، ويجمع الكمية أو يستبدلها */
r.post('/stocktakes/:id/count', can('inventory.adjust'), ah(async (req, res) => {
  const b = z.object({ productId: z.number().optional(), code: z.string().optional(), qty: z.number().min(0), mode: z.enum(['SET', 'ADD']).default('SET') }).parse(req.body);
  const id = Number(req.params.id);
  const [st] = await db.select().from(schema.stocktakes).where(eq(schema.stocktakes.id, id));
  if (!st || st.status !== 'OPEN') throw badRequest('الجرد غير مفتوح.');
  let productId = b.productId;
  if (!productId && b.code) {
    const [p] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.barcode, b.code));
    productId = p?.id;
  }
  if (!productId) throw badRequest('لا يوجد منتج بهذا الباركود.');
  const [it] = await db.select().from(schema.stocktakeItems).where(and(eq(schema.stocktakeItems.stocktakeId, id), eq(schema.stocktakeItems.productId, productId)));
  if (!it) throw badRequest('المنتج غير مشمول في هذا الجرد.');
  const countedQty = r3(b.mode === 'ADD' ? (it.countedQty ?? 0) + b.qty : b.qty);
  await db.update(schema.stocktakeItems).set({ countedQty }).where(eq(schema.stocktakeItems.id, it.id));
  res.json({ productId, countedQty });
}));
r.post('/stocktakes/:id/approve', can('inventory.adjust'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const out = await db.transaction(async (tx) => {
    const [st] = await tx.select().from(schema.stocktakes).where(eq(schema.stocktakes.id, id));
    if (!st || st.status !== 'OPEN') throw badRequest('الجرد معتمد أو ملغى.');
    const items = await tx.select().from(schema.stocktakeItems).where(eq(schema.stocktakeItems.stocktakeId, id));
    let value = 0; let adjusted = 0;
    for (const it of items) {
      if (it.countedQty == null) continue;
      const delta = r3(it.countedQty - it.systemQty);
      if (delta === 0) { await moveStock(tx, { productId: it.productId, branchId: st.branchId, qty: 0, type: 'ADJUST', refType: 'stocktake', refId: id, note: `جرد ${st.number}: مطابق`, userId: req.user!.id, setCounted: true }); continue; }
      await moveStock(tx, { productId: it.productId, branchId: st.branchId, qty: delta, type: 'ADJUST', refType: 'stocktake', refId: id, note: `جرد ${st.number}`, userId: req.user!.id, setCounted: true, unitCost: it.unitCost });
      value += delta * it.unitCost; adjusted++;
    }
    value = r2(value);
    if (value !== 0) await postEntry(tx, { description: `فروقات الجرد ${st.number}`, refType: 'stocktake', refId: id, branchId: st.branchId, userId: req.user!.id, lines: [{ key: 'INVENTORY', debit: value }, { key: 'INVENTORY_DIFF', credit: value }] });
    await tx.update(schema.stocktakes).set({ status: 'APPROVED', approvedAt: new Date() }).where(eq(schema.stocktakes.id, id));
    await logActivity({ userId: req.user!.id, action: 'stocktake.approve', entity: 'stocktake', entityId: id, summary: `اعتمد الجرد ${st.number}: ${adjusted} صنف بفروقات بقيمة ${value.toFixed(2)}` }, tx);
    return { adjusted, value };
  });
  res.json(out);
}));
r.post('/stocktakes/:id/cancel', can('inventory.adjust'), ah(async (req, res) => {
  await db.update(schema.stocktakes).set({ status: 'CANCELLED' }).where(and(eq(schema.stocktakes.id, Number(req.params.id)), eq(schema.stocktakes.status, 'OPEN')));
  res.json({ message: 'تم إلغاء الجرد.' });
}));

// ===== المخزون التالف =====
r.get('/inventory/damaged', can('inventory.adjust', 'products.view'), ah(async (_req, res) => {
  const rows = await db.select({ id: schema.stockMovements.id, qty: schema.stockMovements.qty, note: schema.stockMovements.note, unitCost: schema.stockMovements.unitCost, createdAt: schema.stockMovements.createdAt,
    product: schema.products.name, branch: sql<string>`(select name from branches b where b.id = ${schema.stockMovements.branchId})`, user: sql<string>`(select name from users u where u.id = ${schema.stockMovements.userId})` })
    .from(schema.stockMovements).innerJoin(schema.products, eq(schema.products.id, schema.stockMovements.productId))
    .where(inArray(schema.stockMovements.type, ['DAMAGE', 'ISSUE'])).orderBy(desc(schema.stockMovements.id)).limit(300);
  res.json(rows);
}));
r.post('/inventory/damaged', can('inventory.adjust'), ah(async (req, res) => {
  const b = z.object({ branchId: z.number(), productId: z.number(), qty: z.number().positive('أدخل كمية صحيحة.'), reason: z.string().min(2, 'اكتب سبب التلف.') }).parse(req.body);
  const out = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, b.productId));
    if (!p) throw notFound('المنتج غير موجود.');
    if (!isStockTracked(p)) throw badRequest('هذا المنتج لا يُتابَع مخزونه.');
    const unitCost = p.avgCost || p.cost;
    const balance = await moveStock(tx, { productId: p.id, branchId: b.branchId, qty: -b.qty, type: 'DAMAGE', note: b.reason, userId: req.user!.id, unitCost, refType: 'damage' });
    const value = r2(b.qty * unitCost);
    if (value > 0) await postEntry(tx, { description: `تالف: ${p.name} (${b.reason})`, refType: 'damage', refId: p.id, branchId: b.branchId, userId: req.user!.id, lines: [{ key: 'INVENTORY_DIFF', debit: value }, { key: 'INVENTORY', credit: value }] });
    await logActivity({ userId: req.user!.id, action: 'stock.damage', entity: 'product', entityId: p.id, summary: `سجّل تالف ${b.qty} من ${p.name} بقيمة ${value.toFixed(2)}` }, tx);
    return { balance, value };
  });
  res.status(201).json(out);
}));

// ===== التقرير اليومي (X/Z) =====
r.get('/reports/daily', can('reports.view', 'shifts.manage', 'pos.use'), ah(async (req, res) => {
  const day = String(req.query.date ?? new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10));
  const from = new Date(`${day}T00:00:00+03:00`); const to = new Date(from.getTime() + 86400000 - 1);
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const args = [from, to, branchId];
  const w = `i.status not in ('DRAFT','CANCELLED') and i.created_at between $1 and $2 and ($3::int is null or i.branch_id = $3)`;
  const { rows: [t] } = await pool.query(`select coalesce(sum(total) filter (where type='INVOICE'),0)::float as sales, coalesce(sum(total) filter (where type='CREDIT_NOTE'),0)::float as returns,
      count(*) filter (where type='INVOICE')::int as invoices, count(*) filter (where type='CREDIT_NOTE')::int as returns_count,
      coalesce(sum(discount) filter (where type='INVOICE'),0)::float as discounts, coalesce(sum(rounding) filter (where type='INVOICE'),0)::float as rounding,
      coalesce(sum(tax_total) filter (where type='INVOICE'),0)::float - coalesce(sum(tax_total) filter (where type='CREDIT_NOTE'),0)::float as tax,
      coalesce(sum(due) filter (where type='INVOICE'),0)::float as credit from invoices i where ${w}`, args);
  const { rows: methods } = await pool.query(`select p.method, coalesce(pm.name, p.method) as name, sum(p.amount)::float as total, count(*)::int as count
    from payments p join invoices i on i.id = p.invoice_id left join payment_methods pm on pm.code = p.method where ${w} group by 1,2 order by 3 desc`, args);
  const { rows: types } = await pool.query(`select coalesce(order_type,'TAKEAWAY') as type, count(*)::int as count, sum(total)::float as total from invoices i where ${w} and type='INVOICE' group by 1`, args);
  const { rows: users } = await pool.query(`select u.name, count(*)::int as count, sum(i.total)::float as total from invoices i join users u on u.id = i.user_id where ${w} and i.type='INVOICE' group by 1 order by 3 desc`, args);
  const { rows: [wallet] } = await pool.query(`select coalesce(sum(amount) filter (where type='TOPUP'),0)::float as topups from wallet_transactions where created_at between $1 and $2`, [from, to]);
  const { rows: [exp] } = await pool.query(`select coalesce(sum(total),0)::float as v from expenses where date between $1 and $2 and ($3::int is null or branch_id = $3)`, args);
  res.json({ date: day, ...t, net: r2(t.sales - t.returns), methods, types, users, walletTopups: wallet.topups, expenses: exp.v });
}));

export default r;
