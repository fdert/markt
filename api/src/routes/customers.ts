import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { qcol } from '../lib/col.js';
import { db, schema } from '../db/index.js';
import { ah, badRequest, notFound, page } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { logActivity } from '../lib/activity.js';

const r = Router();
const C = schema.customers;
const dueSum = sql<number>`coalesce((select sum(i.due) from invoices i where i.customer_id = ${qcol(C.id)} and i.type = 'INVOICE' and i.status <> 'DRAFT'),0)::float`;
const invCount = sql<number>`(select count(*)::int from invoices i where i.customer_id = ${qcol(C.id)} and i.type = 'INVOICE' and i.status <> 'DRAFT')`;
const lastBuy = sql<string>`(select max(created_at) from invoices i where i.customer_id = ${qcol(C.id)} and i.type = 'INVOICE')`;

r.get('/customers', can('customers.view', 'pos.use'), ah(async (req, res) => {
  const q = req.query as Record<string, string>; const { limit, offset } = page(q);
  const where: SQL[] = [];
  if (q.search) where.push(or(ilike(C.name, `%${q.search}%`), ilike(C.phone, `%${q.search}%`), ilike(C.vatNumber, `%${q.search}%`), ilike(C.email, `%${q.search}%`))!);
  if (q.type) where.push(eq(C.type, q.type));
  if (q.filter === 'due') where.push(sql`${dueSum} > 0`);
  if (q.filter === 'inactive') where.push(eq(C.active, false));
  const cond = where.length ? and(...where) : undefined;
  const order = q.sort === 'due' ? desc(dueSum) : q.sort === 'last' ? sql`${lastBuy} desc nulls last` : q.sort === 'invoices' ? desc(invCount) : q.sort === 'name' ? asc(C.name) : q.sort === 'oldest' ? asc(C.id) : desc(C.id);
  const rows = await db.select({ id: C.id, name: C.name, phone: C.phone, email: C.email, type: C.type, vatNumber: C.vatNumber, active: C.active, loyaltyPoints: C.loyaltyPoints, walletBalance: C.walletBalance, priceListId: C.priceListId, due: dueSum, invoices: invCount, lastPurchase: lastBuy, city: C.city })
    .from(C).where(cond).orderBy(order).limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(C).where(cond);
  const [stats] = await db.select({ total: sql<number>`count(*)::int`, newThisMonth: sql<number>`count(*) filter (where created_at >= date_trunc('month', now()))::int`, withDue: sql<number>`count(*) filter (where ${dueSum} > 0)::int`, totalDue: sql<number>`coalesce(sum(${dueSum}),0)::float` }).from(C);
  res.json({ rows, total, stats });
}));

r.get('/customers/:id', can('customers.view', 'pos.use'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select({ c: C, due: dueSum, invoices: invCount, lastPurchase: lastBuy }).from(C).where(eq(C.id, id));
  if (!c) throw notFound('العميل غير موجود.');
  const [agg] = await db.select({ total: sql<number>`coalesce(sum(total),0)::float`, paid: sql<number>`coalesce(sum(paid),0)::float` }).from(schema.invoices).where(and(eq(schema.invoices.customerId, id), eq(schema.invoices.type, 'INVOICE')));
  const invoices = await db.select({ id: schema.invoices.id, number: schema.invoices.number, total: schema.invoices.total, due: schema.invoices.due, status: schema.invoices.status, type: schema.invoices.type, createdAt: schema.invoices.createdAt })
    .from(schema.invoices).where(eq(schema.invoices.customerId, id)).orderBy(desc(schema.invoices.id)).limit(50);
  res.json({ ...c.c, due: c.due, invoicesCount: c.invoices, lastPurchase: c.lastPurchase, totals: agg, invoices });
}));

const body = z.object({
  name: z.string().min(2, 'الاسم مطلوب.'),
  phone: z.string().regex(/^(05\d{8}|\+\d{8,15})$/, 'جوال سعودي يبدأ بـ05، أو رقم دولي يبدأ بـ+ ورمز الدولة.').nullish().or(z.literal('')),
  email: z.string().email('البريد الإلكتروني غير صحيح.').nullish().or(z.literal('')),
  type: z.enum(['INDIVIDUAL', 'COMPANY', 'GOVERNMENT', 'NGO']).default('INDIVIDUAL'), gender: z.enum(['MALE', 'FEMALE']).nullish(), active: z.boolean().default(true),
  vatNumber: z.string().regex(/^3\d{13}3$/, 'الرقم الضريبي 15 رقماً يبدأ وينتهي بالرقم 3.').nullish().or(z.literal('')), crNumber: z.string().nullish(),
  country: z.string().nullish(), city: z.string().nullish(), district: z.string().nullish(), street: z.string().nullish(), buildingNo: z.string().nullish(),
  additionalNo: z.string().nullish(), postalCode: z.string().nullish(), shortAddress: z.string().nullish(), lat: z.number().nullish(), lng: z.number().nullish(), notes: z.string().nullish(), priceListId: z.number().nullish(),
});
const clean = (b: Partial<z.infer<typeof body>>) => ({ ...b, phone: b.phone || null, email: b.email || null, vatNumber: b.vatNumber || null });

r.post('/customers', can('customers.manage', 'pos.use'), ah(async (req, res) => {
  const b = clean(body.parse(req.body));
  if (b.phone) {
    const [ex] = await db.select({ id: C.id }).from(C).where(eq(C.phone, b.phone));
    if (ex) throw badRequest('رقم الجوال مسجل لعميل آخر.');
  }
  const [row] = await db.insert(C).values(b as typeof C.$inferInsert).returning();
  await logActivity({ userId: req.user!.id, action: 'customer.create', entity: 'customer', entityId: row.id, summary: `أضاف العميل ${row.name}` });
  res.status(201).json(row);
}));
r.put('/customers/:id', can('customers.manage', 'pos.use'), ah(async (req, res) => {
  const [row] = await db.update(C).set(clean(body.partial().parse(req.body))).where(eq(C.id, Number(req.params.id))).returning();
  if (!row) throw notFound('العميل غير موجود.');
  res.json(row);
}));
r.delete('/customers/:id', can('customers.manage'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const [inv] = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.customerId, id)).limit(1);
  if (inv) throw badRequest('الحذف متاح لعميل بلا فواتير.');
  await db.delete(C).where(eq(C.id, id));
  res.json({ message: 'تم الحذف.' });
}));

export default r;
