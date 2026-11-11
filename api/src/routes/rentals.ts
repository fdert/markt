// عقود الإيجار: تأجير الأصناف بسعر زمني مع تأمين مسترد
import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { qcol } from '../lib/col.js';
import { db, schema } from '../db/index.js';
import { ah, badRequest, notFound } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { nextNumber } from '../lib/counter.js';
import { moveStock } from '../services/inventory.js';
import { postEntry, methodAccount } from '../services/accounting.js';
import { createInvoice } from '../services/sales.js';
import { computeCart } from '../services/pricing.js';
import { r2 } from '../lib/money.js';

const r = Router();
r.use(can('rentals.manage'));
const R = schema.rentals;

r.get('/', ah(async (req, res) => {
  const rows = await db.select({ id: R.id, number: R.number, startAt: R.startAt, dueAt: R.dueAt, returnedAt: R.returnedAt, deposit: R.deposit, amount: R.amount, status: R.status, qty: R.qty, invoiceId: R.invoiceId,
    customer: sql<string>`(select name from customers c where c.id = ${qcol(R.customerId)})`, product: sql<string>`(select name from products p where p.id = ${qcol(R.productId)})`,
    overdue: sql<boolean>`${qcol(R.status)} = 'ACTIVE' and ${qcol(R.dueAt)} < now()` }).from(R).where(req.query.status ? eq(R.status, String(req.query.status)) : undefined).orderBy(desc(R.id));
  const [stats] = await db.select({ active: sql<number>`count(*) filter (where status='ACTIVE')::int`, overdue: sql<number>`count(*) filter (where status='ACTIVE' and due_at < now())::int`,
    deposits: sql<number>`coalesce(sum(deposit) filter (where status='ACTIVE'),0)::float`, returnedMonth: sql<number>`count(*) filter (where returned_at >= date_trunc('month', now()))::int` }).from(R);
  res.json({ rows, stats });
}));

r.post('/', ah(async (req, res) => {
  const b = z.object({ customerId: z.number({ required_error: 'اختر العميل.' }), branchId: z.number(), productId: z.number(), qty: z.number().positive().default(1), periods: z.number().positive('حدد مدة الإيجار.'), startAt: z.string().optional(), paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']).default('CASH'), notes: z.string().nullish() }).parse(req.body);
  const [p] = await db.select().from(schema.products).where(eq(schema.products.id, b.productId));
  if (!p || p.type !== 'RENTAL') throw badRequest('اختر منتج إيجار.');
  const unitMs: Record<string, number> = { HOUR: 3600000, DAY: 86400000, WEEK: 604800000, MONTH: 2592000000, YEAR: 31536000000 };
  const start = b.startAt ? new Date(b.startAt) : new Date();
  const due = new Date(start.getTime() + (unitMs[p.rentalUnit ?? 'DAY'] ?? 86400000) * b.periods);
  const rate = p.rentalRate ?? p.price;
  const lines = [{ productId: p.id, qty: b.qty * b.periods, price: rate }];
  const preview = await computeCart(db, { branchId: b.branchId, customerId: b.customerId, lines });
  const inv = await createInvoice({ branchId: b.branchId, customerId: b.customerId, lines, payments: [{ method: b.paymentMethod, amount: preview.total }], channel: 'POS', notes: `عقد إيجار حتى ${due.toISOString().slice(0, 10)}` } as never, req.user!);
  const deposit = r2((p.depositAmount ?? 0) * b.qty);
  const row = await db.transaction(async (tx) => {
    const [row] = await tx.insert(R).values({ number: await nextNumber(tx, 'rental', 'RNT-'), customerId: b.customerId, branchId: b.branchId, productId: p.id, qty: b.qty, invoiceId: inv.invoice.id, startAt: start, dueAt: due, deposit, amount: inv.invoice.total, notes: b.notes }).returning();
    await moveStock(tx, { productId: p.id, branchId: b.branchId, qty: -b.qty, type: 'RENTAL_OUT', refType: 'rental', refId: row.id, userId: req.user!.id });
    if (deposit > 0) await postEntry(tx, { description: `تأمين عقد إيجار ${row.number}`, refType: 'rental', refId: row.id, branchId: b.branchId, userId: req.user!.id, lines: [{ key: methodAccount(b.paymentMethod), debit: deposit }, { key: 'DEPOSITS', credit: deposit }] });
    return row;
  });
  res.status(201).json(row);
}));

r.post('/:id/return', ah(async (req, res) => {
  const { deduction = 0, method = 'CASH' } = z.object({ deduction: z.number().min(0).optional(), method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']).optional() }).parse(req.body);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(R).where(eq(R.id, Number(req.params.id)));
    if (!row) throw notFound('العقد غير موجود.');
    if (row.status !== 'ACTIVE') throw badRequest('العقد مغلق مسبقاً.');
    await moveStock(tx, { productId: row.productId, branchId: row.branchId, qty: row.qty, type: 'RENTAL_IN', refType: 'rental', refId: row.id, userId: req.user!.id });
    const refund = r2(Math.max(0, row.deposit - deduction));
    if (row.deposit > 0) await postEntry(tx, { description: `إرجاع تأمين العقد ${row.number}`, refType: 'rental', refId: row.id, branchId: row.branchId, userId: req.user!.id, lines: [{ key: 'DEPOSITS', debit: row.deposit }, { key: methodAccount(method), credit: refund }, { key: 'RENTAL_REV', credit: r2(row.deposit - refund) }] });
    await tx.update(R).set({ status: 'RETURNED', returnedAt: new Date() }).where(eq(R.id, row.id));
  });
  res.json({ message: 'تم الإرجاع.' });
}));

export default r;
