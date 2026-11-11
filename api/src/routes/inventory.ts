// تحويلات المخزون بين الفروع، واقتراحات الشراء، وتقييم المخزون
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { qcol } from '../lib/col.js';
import { db, pool, schema } from '../db/index.js';
import { ah, badRequest, notFound, page } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { nextNumber } from '../lib/counter.js';
import { moveStock } from '../services/inventory.js';
import { logActivity } from '../lib/activity.js';

const r = Router();
const T = schema.transfers;

r.get('/transfers', ah(async (req, res) => {
  const q = req.query as Record<string, string>; const { limit, offset } = page(q);
  const cond = and(q.status ? eq(T.status, q.status) : undefined, q.branchId ? sql`(${qcol(T.fromBranchId)} = ${Number(q.branchId)} or ${qcol(T.toBranchId)} = ${Number(q.branchId)})` : undefined);
  const rows = await db.select({
    id: T.id, number: T.number, status: T.status, notes: T.notes, createdAt: T.createdAt, receivedAt: T.receivedAt, fromBranchId: T.fromBranchId, toBranchId: T.toBranchId,
    fromName: sql<string>`(select name from branches b where b.id = ${qcol(T.fromBranchId)})`, toName: sql<string>`(select name from branches b where b.id = ${qcol(T.toBranchId)})`,
    itemsCount: sql<number>`(select count(*)::int from transfer_items ti where ti.transfer_id = ${qcol(T.id)})`,
  }).from(T).where(cond).orderBy(desc(T.id)).limit(limit).offset(offset);
  const [stats] = await db.select({
    total: sql<number>`count(*)::int`, pending: sql<number>`count(*) filter (where status in ('DRAFT','IN_TRANSIT'))::int`,
    received: sql<number>`count(*) filter (where status = 'RECEIVED')::int`, cancelled: sql<number>`count(*) filter (where status = 'CANCELLED')::int`,
  }).from(T);
  res.json({ rows, stats });
}));

r.get('/transfers/:id', ah(async (req, res) => {
  const [t] = await db.select().from(T).where(eq(T.id, Number(req.params.id)));
  if (!t) throw notFound('التحويل غير موجود.');
  const items = await db.select({ id: schema.transferItems.id, productId: schema.transferItems.productId, qty: schema.transferItems.qty, name: schema.products.name, barcode: schema.products.barcode })
    .from(schema.transferItems).innerJoin(schema.products, eq(schema.products.id, schema.transferItems.productId)).where(eq(schema.transferItems.transferId, t.id));
  res.json({ ...t, items });
}));

r.post('/transfers', can('inventory.transfer'), ah(async (req, res) => {
  const b = z.object({ fromBranchId: z.number(), toBranchId: z.number(), notes: z.string().nullish(), send: z.boolean().default(false), items: z.array(z.object({ productId: z.number(), qty: z.number().positive() })).min(1, 'أضف صنفاً واحداً على الأقل.') }).parse(req.body);
  if (b.fromBranchId === b.toBranchId) throw badRequest('فرع المصدر والوجهة متطابقان.');
  const t = await db.transaction(async (tx) => {
    const [t] = await tx.insert(T).values({ number: await nextNumber(tx, 'transfer', 'TR-'), fromBranchId: b.fromBranchId, toBranchId: b.toBranchId, notes: b.notes, userId: req.user!.id, status: b.send ? 'IN_TRANSIT' : 'DRAFT' }).returning();
    await tx.insert(schema.transferItems).values(b.items.map((i) => ({ ...i, transferId: t.id })));
    if (b.send) for (const i of b.items) await moveStock(tx, { productId: i.productId, branchId: b.fromBranchId, qty: -i.qty, type: 'TRANSFER_OUT', refType: 'transfer', refId: t.id, userId: req.user!.id });
    return t;
  });
  res.status(201).json(t);
}));

r.post('/transfers/:id/:action', can('inventory.transfer'), ah(async (req, res) => {
  const id = Number(req.params.id); const action = String(req.params.action);
  if (!['send', 'receive', 'cancel'].includes(action)) throw badRequest('إجراء غير معروف.');
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(T).where(eq(T.id, id));
    if (!t) throw notFound('التحويل غير موجود.');
    const items = await tx.select().from(schema.transferItems).where(eq(schema.transferItems.transferId, id));
    const ref = { refType: 'transfer', refId: id, userId: req.user!.id };
    if (action === 'send') {
      if (t.status !== 'DRAFT') throw badRequest('أُرسل هذا التحويل مسبقاً.');
      for (const i of items) await moveStock(tx, { productId: i.productId, branchId: t.fromBranchId, qty: -i.qty, type: 'TRANSFER_OUT', ...ref });
      await tx.update(T).set({ status: 'IN_TRANSIT' }).where(eq(T.id, id));
    } else if (action === 'receive') {
      if (t.status === 'RECEIVED' || t.status === 'CANCELLED') throw badRequest('لا يمكن استلام هذا التحويل.');
      if (t.status === 'DRAFT') for (const i of items) await moveStock(tx, { productId: i.productId, branchId: t.fromBranchId, qty: -i.qty, type: 'TRANSFER_OUT', ...ref });
      for (const i of items) await moveStock(tx, { productId: i.productId, branchId: t.toBranchId, qty: i.qty, type: 'TRANSFER_IN', ...ref, setCounted: true });
      await tx.update(T).set({ status: 'RECEIVED', receivedAt: new Date() }).where(eq(T.id, id));
    } else {
      if (t.status === 'RECEIVED' || t.status === 'CANCELLED') throw badRequest('لا يمكن إلغاء هذا التحويل.');
      if (t.status === 'IN_TRANSIT') for (const i of items) await moveStock(tx, { productId: i.productId, branchId: t.fromBranchId, qty: i.qty, type: 'TRANSFER_IN', note: 'إلغاء تحويل', ...ref });
      await tx.update(T).set({ status: 'CANCELLED' }).where(eq(T.id, id));
    }
    await logActivity({ userId: req.user!.id, action: `transfer.${action}`, entity: 'transfer', entityId: id, summary: `${action === 'send' ? 'أرسل' : action === 'receive' ? 'استلم' : 'ألغى'} التحويل ${t.number}` }, tx);
  });
  res.json({ message: 'تم التحديث.' });
}));

/** اقتراحات الشراء: المستوى المستهدف = حد الطلب + بيع 30 يوماً المتوقع من متوسط آخر 60 يوماً */
r.get('/reorder-suggestions', ah(async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const { rows } = await pool.query(`
    with sales as (
      select ii.product_id, i.branch_id, sum(ii.qty * ii.unit_factor) as sold60
      from invoice_items ii join invoices i on i.id = ii.invoice_id
      where i.type = 'INVOICE' and i.status <> 'DRAFT' and i.created_at > now() - interval '60 days' group by 1, 2
    ), last_cost as (
      select distinct on (pi.product_id) pi.product_id, pi.unit_cost, p.supplier_id, s.name as supplier
      from purchase_items pi join purchases p on p.id = pi.purchase_id left join suppliers s on s.id = p.supplier_id
      where p.status = 'APPROVED' and not p.is_return order by pi.product_id, p.date desc
    ), settings_low as (select coalesce((value->>'defaultLowStock')::numeric, 0) as lvl from settings where key = 'pos')
    select p.id, p.name, p.barcode, b.id as branch_id, b.name as branch, coalesce(st.qty, 0)::float as available,
      coalesce(st.alert_level, p.low_stock_alert, (select lvl from settings_low), 0)::float as reorder_level,
      coalesce(sa.sold60, 0)::float as sold60, lc.unit_cost::float as last_cost, lc.supplier_id, lc.supplier
    from products p cross join branches b
    left join stocks st on st.product_id = p.id and st.branch_id = b.id
    left join sales sa on sa.product_id = p.id and sa.branch_id = b.id
    left join last_cost lc on lc.product_id = p.id
    where p.active and not p.unlimited and not p.is_composite and p.type in ('SIMPLE','PRO') and b.active
      and ($1::int is null or b.id = $1)
      and (coalesce(st.qty,0) <= coalesce(st.alert_level, p.low_stock_alert, (select lvl from settings_low), 0) and (coalesce(st.alert_level, p.low_stock_alert, (select lvl from settings_low), 0) > 0 or coalesce(sa.sold60,0) > 0))
    order by available asc limit 500`, [branchId]);
  const out = rows.map((x) => {
    const forecast = x.sold60 > 0 ? (x.sold60 / 60) * 30 : x.reorder_level;
    const target = x.reorder_level + forecast;
    const suggested = Math.max(0, Math.ceil(target - x.available));
    return { ...x, target: Math.ceil(target), suggested, estValue: x.last_cost ? Math.round(suggested * x.last_cost * 100) / 100 : null, status: x.available <= 0 ? 'OUT' : 'LOW' };
  });
  res.json(out);
}));

r.get('/valuation', ah(async (_req, res) => {
  const { rows } = await pool.query(`select b.id, b.name, coalesce(sum(s.qty * coalesce(nullif(p.avg_cost,0), p.cost)),0)::float as cost_value,
    coalesce(sum(s.qty * p.price),0)::float as retail_value, count(s.id)::int as items
    from branches b left join stocks s on s.branch_id = b.id left join products p on p.id = s.product_id group by b.id order by b.id`);
  res.json(rows);
}));

export default r;
