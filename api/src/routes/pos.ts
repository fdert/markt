// نقطة البيع: شبكة المنتجات، الورديات (الصندوق)، الفواتير المعلّقة، الصرف الداخلي
import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { qcol } from '../lib/col.js';
import { db, pool, schema } from '../db/index.js';
import { ah, badRequest, notFound } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { computeCart } from '../services/pricing.js';
import { moveForSale } from '../services/inventory.js';
import { postEntry } from '../services/accounting.js';
import { nextNumber } from '../lib/counter.js';
import { logActivity } from '../lib/activity.js';
import { r2 } from '../lib/money.js';
import { activeOffers } from '../services/pricing.js';

const r = Router();
const P = schema.products;
r.use(can('pos.use', 'invoices.view'));

r.get('/products', ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const branchId = Number(q.branchId);
  const cond = and(eq(P.active, true), eq(P.posEnabled, true), q.categoryId ? eq(P.categoryId, Number(q.categoryId)) : undefined,
    q.search ? or(ilike(P.name, `%${q.search}%`), ilike(P.nameEn, `%${q.search}%`), eq(P.barcode, q.search), eq(P.sku, q.search)) : undefined);
  const rows = await db.select({
    id: P.id, name: P.name, price: P.price, image: P.image, barcode: P.barcode, isWeighted: P.isWeighted, pricePerWeight: P.pricePerWeight,
    unlimited: P.unlimited, type: P.type, isComposite: P.isComposite, categoryId: P.categoryId, expiryDate: P.expiryDate, unitName: P.unitName,
    stock: sql<number>`coalesce((select qty from stocks s where s.product_id = ${qcol(P.id)} and s.branch_id = ${branchId}), 0)::float`,
    unitsCount: sql<number>`(select count(*)::int from product_units u where u.product_id = ${qcol(P.id)} and u.active)`,
  }).from(P).where(cond).orderBy(asc(P.name)).limit(Number(q.limit ?? 60)).offset(Number(q.offset ?? 0));
  res.json(rows);
}));

r.get('/products/:id/units', ah(async (req, res) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(P).where(eq(P.id, id));
  if (!p) throw notFound('المنتج غير موجود.');
  const units = await db.select().from(schema.productUnits).where(and(eq(schema.productUnits.productId, id), eq(schema.productUnits.active, true)));
  res.json({ product: { id: p.id, name: p.name, price: p.price, unitName: p.unitName, barcode: p.barcode }, units });
}));

r.get('/offers', ah(async (_req, res) => res.json(await activeOffers(db, 'POS'))));

/** معاينة السلة: يحسب الإجماليات والضريبة والعروض قبل الدفع */
r.post('/preview', ah(async (req, res) => {
  const cart = await computeCart(db, req.body, { maxDiscountPercent: req.user!.role === 'OWNER' ? 100 : req.user!.maxDiscount ?? 100 });
  res.json(cart);
}));

// ===== الورديات =====
async function shiftSummary(shiftId: number) {
  const { rows: [s] } = await pool.query(`
    select sh.*, u.name as user_name, b.name as branch_name,
      coalesce((select sum(p.amount) from payments p where p.shift_id = sh.id and p.method = 'CASH'),0)::float as cash_sales,
      coalesce((select sum(p.amount) from payments p where p.shift_id = sh.id and p.method = 'CARD'),0)::float as card_sales,
      coalesce((select sum(p.amount) from payments p where p.shift_id = sh.id and p.method = 'BANK_TRANSFER'),0)::float as transfer_sales,
      coalesce((select sum(e.amount) from shift_entries e where e.shift_id = sh.id and e.type = 'CASH_IN'),0)::float as cash_in,
      coalesce((select sum(e.amount) from shift_entries e where e.shift_id = sh.id and e.type in ('CASH_OUT','EXPENSE')),0)::float as cash_out,
      coalesce((select sum(i.total) from invoices i where i.shift_id = sh.id and i.type = 'INVOICE' and i.status <> 'DRAFT'),0)::float as sales_total,
      coalesce((select sum(i.total) from invoices i where i.shift_id = sh.id and i.type = 'CREDIT_NOTE'),0)::float as returns_total,
      (select count(*)::int from invoices i where i.shift_id = sh.id and i.type = 'INVOICE' and i.status <> 'DRAFT') as invoices_count,
      coalesce((select sum(i.due) from invoices i where i.shift_id = sh.id and i.type = 'INVOICE'),0)::float as credit_sales
    from shifts sh join users u on u.id = sh.user_id join branches b on b.id = sh.branch_id where sh.id = $1`, [shiftId]);
  if (!s) return null;
  const expected = r2(Number(s.opening_cash) + s.cash_sales + s.cash_in - s.cash_out);
  const entries = await db.select().from(schema.shiftEntries).where(eq(schema.shiftEntries.shiftId, shiftId)).orderBy(desc(schema.shiftEntries.id));
  return { ...s, expected_cash: s.status === 'OPEN' ? expected : Number(s.expected_cash), entries };
}

r.get('/shift/current', ah(async (req, res) => {
  const branchId = Number(req.query.branchId);
  const [s] = await db.select().from(schema.shifts).where(and(eq(schema.shifts.userId, req.user!.id), eq(schema.shifts.branchId, branchId), eq(schema.shifts.status, 'OPEN')));
  res.json(s ? await shiftSummary(s.id) : null);
}));

r.post('/shift/open', ah(async (req, res) => {
  const b = z.object({ branchId: z.number(), openingCash: z.number().min(0).default(0) }).parse(req.body);
  const [ex] = await db.select().from(schema.shifts).where(and(eq(schema.shifts.userId, req.user!.id), eq(schema.shifts.status, 'OPEN')));
  if (ex) throw badRequest('لديك وردية مفتوحة. أغلقها أولاً.');
  const [s] = await db.insert(schema.shifts).values({ ...b, userId: req.user!.id }).returning();
  await logActivity({ userId: req.user!.id, action: 'shift.open', entity: 'shift', entityId: s.id, summary: `فتح وردية برصيد ${b.openingCash.toFixed(2)}` });
  res.status(201).json(await shiftSummary(s.id));
}));

r.post('/shift/:id/entry', ah(async (req, res) => {
  const b = z.object({ type: z.enum(['CASH_IN', 'CASH_OUT', 'EXPENSE']), amount: z.number().positive('أدخل مبلغاً صحيحاً.'), note: z.string().min(2, 'اكتب ملاحظة توضّح الحركة.') }).parse(req.body);
  const id = Number(req.params.id);
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(schema.shifts).where(eq(schema.shifts.id, id));
    if (!s || s.status !== 'OPEN') throw badRequest('الوردية غير مفتوحة.');
    await tx.insert(schema.shiftEntries).values({ shiftId: id, ...b });
    if (b.type === 'EXPENSE') {
      let [cat] = await tx.select().from(schema.expenseCategories).where(eq(schema.expenseCategories.name, 'نثريات'));
      if (!cat) [cat] = await tx.insert(schema.expenseCategories).values({ name: 'نثريات' }).returning();
      const [e] = await tx.insert(schema.expenses).values({ number: await nextNumber(tx, 'expense', 'EXP-'), categoryId: cat.id, branchId: s.branchId, amount: b.amount, total: b.amount, paymentMethod: 'CASH', notes: `من الوردية: ${b.note}`, userId: req.user!.id }).returning();
      await postEntry(tx, { description: `مصروف من الوردية: ${b.note}`, refType: 'expense', refId: e.id, branchId: s.branchId, userId: req.user!.id, lines: [{ key: 'GENERAL_EXP', debit: b.amount }, { key: 'CASH', credit: b.amount }] });
    } else {
      const sign = b.type === 'CASH_IN' ? 1 : -1;
      await postEntry(tx, { description: `${b.type === 'CASH_IN' ? 'إضافة نقد' : 'سحب نقد'}: ${b.note}`, refType: 'shift', refId: id, branchId: s.branchId, userId: req.user!.id, lines: [{ key: 'CASH', debit: sign * b.amount }, { key: 'CAPITAL', credit: sign * b.amount }] });
    }
  });
  res.json(await shiftSummary(id));
}));

r.post('/shift/:id/close', ah(async (req, res) => {
  const b = z.object({ countedCash: z.number().min(0).nullish(), diffReason: z.string().nullish() }).parse(req.body);
  const id = Number(req.params.id);
  const sum = await shiftSummary(id);
  if (!sum || sum.status !== 'OPEN') throw badRequest('الوردية مغلقة مسبقاً.');
  if (sum.user_id !== req.user!.id && !req.user!.permissions.includes('shifts.manage')) throw badRequest('لا تملك صلاحية إغلاق وردية موظف آخر.');
  const expected = sum.expected_cash as number;
  const diff = b.countedCash != null ? r2(b.countedCash - expected) : null;
  await db.transaction(async (tx) => {
    await tx.update(schema.shifts).set({ status: 'CLOSED', closedAt: new Date(), expectedCash: expected, countedCash: b.countedCash ?? null, difference: diff, diffReason: b.diffReason }).where(eq(schema.shifts.id, id));
    if (diff) await postEntry(tx, { description: `فرق صندوق الوردية #${id}`, refType: 'shift', refId: id, branchId: sum.branch_id, userId: req.user!.id, lines: [{ key: 'CASH', debit: diff }, { key: 'CASH_DIFF', credit: diff }] });
    await logActivity({ userId: req.user!.id, action: 'shift.close', entity: 'shift', entityId: id, summary: `أغلق الوردية #${id}${diff ? ` بفرق ${diff.toFixed(2)}` : ''}` }, tx);
  });
  res.json(await shiftSummary(id));
}));

r.get('/shift/:id', ah(async (req, res) => {
  const s = await shiftSummary(Number(req.params.id));
  if (!s) throw notFound('الوردية غير موجودة.');
  res.json(s);
}));

// صندوق المبيعات: كل الورديات للمراجعة
r.get('/shifts', can('shifts.manage'), ah(async (req, res) => {
  const status = req.query.status as string | undefined;
  const rows = await db.select({ id: schema.shifts.id }).from(schema.shifts).where(status ? eq(schema.shifts.status, status) : undefined).orderBy(desc(schema.shifts.id)).limit(100);
  const list = await Promise.all(rows.map((x) => shiftSummary(x.id)));
  res.json(list);
}));
r.post('/shift/:id/review', can('shifts.manage'), ah(async (req, res) => {
  await db.update(schema.shifts).set({ status: 'REVIEWED' }).where(and(eq(schema.shifts.id, Number(req.params.id)), eq(schema.shifts.status, 'CLOSED')));
  res.json({ message: 'تمت المراجعة.' });
}));
r.post('/shift/:id/reopen', can('shifts.manage'), ah(async (req, res) => {
  await db.update(schema.shifts).set({ status: 'OPEN', closedAt: null }).where(eq(schema.shifts.id, Number(req.params.id)));
  res.json({ message: 'تمت إعادة فتح الوردية.' });
}));

// ===== الفواتير المعلّقة =====
r.get('/held', ah(async (req, res) => {
  res.json(await db.select().from(schema.heldCarts).where(and(eq(schema.heldCarts.userId, req.user!.id), req.query.branchId ? eq(schema.heldCarts.branchId, Number(req.query.branchId)) : undefined)).orderBy(desc(schema.heldCarts.id)));
}));
r.post('/held', ah(async (req, res) => {
  const b = z.object({ branchId: z.number(), label: z.string().nullish(), data: z.any() }).parse(req.body) as { branchId: number; label?: string | null; data: unknown };
  const [row] = await db.insert(schema.heldCarts).values({ ...b, userId: req.user!.id }).returning();
  res.status(201).json(row);
}));
r.delete('/held/:id', ah(async (req, res) => {
  await db.delete(schema.heldCarts).where(and(eq(schema.heldCarts.id, Number(req.params.id)), eq(schema.heldCarts.userId, req.user!.id)));
  res.json({ message: 'تم الحذف.' });
}));

/** الصرف الداخلي: وجبة موظف أو عينة أو تالف — بلا بيع ولا فاتورة */
r.post('/issue', can('pos.issue', 'inventory.adjust'), ah(async (req, res) => {
  const b = z.object({ branchId: z.number(), reason: z.enum(['EMPLOYEE_MEAL', 'SAMPLE', 'DAMAGED', 'GIFT']), recipient: z.string().nullish(), notes: z.string().nullish(),
    lines: z.array(z.object({ productId: z.number(), qty: z.number().positive(), unitId: z.number().nullish() })).min(1) }).parse(req.body);
  const labels = { EMPLOYEE_MEAL: 'وجبة موظف', SAMPLE: 'عينة', DAMAGED: 'تالف', GIFT: 'هدية' };
  const out = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, 'issue', 'ISS-');
    let cost = 0;
    for (const l of b.lines) {
      const [p] = await tx.select().from(P).where(eq(P.id, l.productId));
      let factor = 1;
      if (l.unitId) { const [u] = await tx.select().from(schema.productUnits).where(eq(schema.productUnits.id, l.unitId)); factor = u?.factor ?? 1; }
      const unitCost = await moveForSale(tx, p, l.qty * factor, b.branchId, 'ISSUE', { refType: 'issue', refId: 0, userId: req.user!.id });
      cost += unitCost * l.qty * factor;
    }
    cost = r2(cost);
    if (cost > 0) await postEntry(tx, { description: `صرف داخلي ${number} (${labels[b.reason]})${b.recipient ? ` للمستلم ${b.recipient}` : ''}`, refType: 'issue', branchId: b.branchId, userId: req.user!.id, lines: [{ key: b.reason === 'DAMAGED' ? 'INVENTORY_DIFF' : 'GENERAL_EXP', debit: cost }, { key: 'INVENTORY', credit: cost }] });
    await logActivity({ userId: req.user!.id, action: 'pos.issue', entity: 'issue', summary: `صرف داخلي ${number} بتكلفة ${cost.toFixed(2)} (${labels[b.reason]})` }, tx);
    return { number, cost };
  });
  res.json(out);
}));

export default r;
