import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { qcol } from '../lib/col.js';
import { db, schema } from '../db/index.js';
import { ah, badRequest } from '../lib/http.js';
import { can } from '../middleware/auth.js';

const r = Router();
const C = schema.coupons; const O = schema.offers;

const couponStatus = (c: typeof C.$inferSelect) => {
  const now = new Date();
  if (!c.active) return 'PAUSED';
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) return 'EXHAUSTED';
  if (c.endsAt < now) return 'EXPIRED';
  if (c.startsAt > now) return 'SCHEDULED';
  return 'ACTIVE';
};

r.get('/coupons', can('marketing.manage', 'pos.use'), ah(async (_req, res) => {
  const rows = await db.select().from(C).orderBy(desc(C.id));
  res.json(rows.map((c) => ({ ...c, status: couponStatus(c) })));
}));
r.get('/coupons/check/:code', ah(async (req, res) => {
  const [c] = await db.select({ id: C.id }).from(C).where(sql`upper(${qcol(C.code)}) = ${String(req.params.code).toUpperCase()}`);
  res.json({ available: !c || c.id === Number(req.query.exceptId) });
}));
r.get('/coupons/:id/usage', can('marketing.manage'), ah(async (req, res) => {
  const [c] = await db.select().from(C).where(eq(C.id, Number(req.params.id)));
  const usage = await db.select({ id: schema.invoices.id, number: schema.invoices.number, total: schema.invoices.total, discount: schema.invoices.discount, channel: schema.invoices.channel, createdAt: schema.invoices.createdAt, customer: sql<string>`(select name from customers c where c.id = ${qcol(schema.invoices.customerId)})` })
    .from(schema.invoices).where(eq(schema.invoices.couponCode, c.code)).orderBy(desc(schema.invoices.id)).limit(100);
  res.json({ ...c, status: couponStatus(c), usage });
}));
const couponBody = z.object({
  name: z.string().min(2, 'اسم الكوبون مطلوب.'), code: z.string().regex(/^[A-Za-z0-9-]{3,30}$/, 'حروف إنجليزية وأرقام وشرطة فقط.'),
  type: z.enum(['AMOUNT', 'PERCENT']), value: z.number().positive('قيمة الخصم مطلوبة.'), maxDiscount: z.number().positive().nullish(), freeShipping: z.boolean().default(false),
  channel: z.enum(['ALL', 'ONLINE', 'POS']).default('ALL'), minOrder: z.number().min(0).nullish(), usageLimit: z.number().int().positive().nullish(), perCustomer: z.number().int().positive().nullish(),
  customerId: z.number().nullish(), startsAt: z.string(), endsAt: z.string(), active: z.boolean().default(true),
}).refine((b) => b.type !== 'PERCENT' || b.value <= 100, { message: 'النسبة لا تتجاوز 100%.', path: ['value'] }).refine((b) => new Date(b.endsAt) > new Date(b.startsAt), { message: 'تاريخ الانتهاء بعد تاريخ البدء.', path: ['endsAt'] });
const toCoupon = (b: z.infer<typeof couponBody>) => ({ ...b, code: b.code.toUpperCase(), startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) });
r.post('/coupons', can('marketing.manage'), ah(async (req, res) => { const [row] = await db.insert(C).values(toCoupon(couponBody.parse(req.body))).returning(); res.status(201).json(row); }));
r.put('/coupons/:id', can('marketing.manage'), ah(async (req, res) => { const [row] = await db.update(C).set(toCoupon(couponBody.parse(req.body))).where(eq(C.id, Number(req.params.id))).returning(); res.json(row); }));
r.delete('/coupons/:id', can('marketing.manage'), ah(async (req, res) => {
  const [c] = await db.select().from(C).where(eq(C.id, Number(req.params.id)));
  if (c?.usedCount) throw badRequest('استُخدم هذا الكوبون، فلا يُحذف حفاظاً على سجل الفواتير. أوقفه بدلاً من ذلك.');
  await db.delete(C).where(eq(C.id, Number(req.params.id))); res.json({ message: 'تم الحذف.' });
}));

r.get('/offers', can('marketing.manage', 'pos.use'), ah(async (_req, res) => {
  const now = new Date();
  const rows = await db.select().from(O).orderBy(desc(O.id));
  res.json(rows.map((o) => ({ ...o, status: !o.active ? 'PAUSED' : o.startsAt > now ? 'SCHEDULED' : o.endsAt && o.endsAt < now ? 'EXPIRED' : 'ACTIVE' })));
}));
const offerBody = z.object({
  name: z.string().min(2, 'اسم العرض مطلوب.'), badge: z.string().nullish(), type: z.enum(['PERCENT', 'AMOUNT', 'BXGY', 'BUNDLE']), value: z.number().min(0).default(0),
  buyQty: z.number().int().positive().nullish(), getQty: z.number().int().positive().nullish(), scope: z.enum(['ALL', 'CATEGORIES', 'PRODUCTS']).default('ALL'),
  categoryIds: z.array(z.number()).default([]), productIds: z.array(z.number()).default([]), excludedIds: z.array(z.number()).default([]),
  channel: z.enum(['ALL', 'ONLINE', 'POS']).default('ALL'), startsAt: z.string().nullish(), endsAt: z.string().nullish(), active: z.boolean().default(true), stackCoupons: z.boolean().default(true),
});
const toOffer = (b: z.infer<typeof offerBody>) => {
  if ((b.type === 'PERCENT' || b.type === 'AMOUNT') && !b.value) throw badRequest('قيمة الخصم مطلوبة.');
  if ((b.type === 'BXGY' || b.type === 'BUNDLE') && (!b.buyQty || !b.getQty)) throw badRequest('حدد عدد القطع المشتراة والمجانية.');
  if (b.scope === 'CATEGORIES' && !b.categoryIds.length) throw badRequest('اختر تصنيفاً واحداً على الأقل.');
  if (b.scope === 'PRODUCTS' && !b.productIds.length) throw badRequest('اختر منتجاً واحداً على الأقل.');
  return { ...b, startsAt: b.startsAt ? new Date(b.startsAt) : new Date(), endsAt: b.endsAt ? new Date(b.endsAt) : null };
};
r.post('/offers', can('marketing.manage'), ah(async (req, res) => { const [row] = await db.insert(O).values(toOffer(offerBody.parse(req.body))).returning(); res.status(201).json(row); }));
r.put('/offers/:id', can('marketing.manage'), ah(async (req, res) => { const [row] = await db.update(O).set(toOffer(offerBody.parse(req.body))).where(eq(O.id, Number(req.params.id))).returning(); res.json(row); }));
r.delete('/offers/:id', can('marketing.manage'), ah(async (req, res) => { await db.delete(O).where(eq(O.id, Number(req.params.id))); res.json({ message: 'تم الحذف.' }); }));

export default r;
