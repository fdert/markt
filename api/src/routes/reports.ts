// مركز التقارير ولوحة التحكم
import { Router } from 'express';
import { pool } from '../db/index.js';
import { ah } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { getSetting } from '../lib/settings.js';
import { r2 } from '../lib/money.js';

const r = Router();

function period(q: Record<string, string>) {
  const now = new Date();
  // حدود اليوم بتوقيت الرياض
  const riyadhMidnight = (d: Date) => { const x = new Date(d.getTime() + 3 * 3600000); x.setUTCHours(0, 0, 0, 0); return new Date(x.getTime() - 3 * 3600000); };
  let from: Date; let to = now;
  if (q.from) { from = new Date(q.from); to = q.to ? new Date(new Date(q.to).getTime() + 86400000 - 1) : now; }
  else if (q.range === 'week') from = new Date(riyadhMidnight(now).getTime() - 6 * 86400000);
  else if (q.range === 'month') { const d = new Date(now.getTime() + 3 * 3600000); from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 3 * 3600000); }
  else if (q.range === 'year') { const d = new Date(now.getTime() + 3 * 3600000); from = new Date(Date.UTC(d.getUTCFullYear(), 0, 1) - 3 * 3600000); }
  else from = riyadhMidnight(now);
  const len = to.getTime() - from.getTime();
  return { from, to, prevFrom: new Date(from.getTime() - len), prevTo: from, branchId: q.branchId ? Number(q.branchId) : null };
}

const salesWhere = `i.status not in ('DRAFT','CANCELLED') and i.created_at between $1 and $2 and ($3::int is null or i.branch_id = $3)`;

async function totals(from: Date, to: Date, branchId: number | null) {
  const { rows: [t] } = await pool.query(`select
    coalesce(sum(total) filter (where type='INVOICE'),0)::float as sales, coalesce(sum(total) filter (where type='CREDIT_NOTE'),0)::float as returns,
    count(*) filter (where type='INVOICE')::int as invoices, coalesce(sum(discount) filter (where type='INVOICE'),0)::float as discounts,
    coalesce(sum(tax_total) filter (where type='INVOICE'),0)::float - coalesce(sum(tax_total) filter (where type='CREDIT_NOTE'),0)::float as tax,
    coalesce(sum(subtotal) filter (where type='INVOICE'),0)::float - coalesce(sum(subtotal) filter (where type='CREDIT_NOTE'),0)::float as net_ex_tax,
    coalesce(sum(cost_total) filter (where type='INVOICE'),0)::float as cost
    from invoices i where ${salesWhere} and type in ('INVOICE','CREDIT_NOTE')`, [from, to, branchId]);
  return { ...t, net: r2(t.sales - t.returns), avg: t.invoices ? r2(t.sales / t.invoices) : 0, profit: r2(t.net_ex_tax - t.cost) };
}

r.get('/dashboard', can('dashboard.view', 'reports.view'), ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const args = [p.from, p.to, p.branchId];
  const [cur, prev] = await Promise.all([totals(p.from, p.to, p.branchId), totals(p.prevFrom, p.prevTo, p.branchId)]);
  const q = (sql: string, a: unknown[] = args) => pool.query(sql, a).then((x) => x.rows);
  const [expenses, newCustomers, trend, byCategory, top, payments, branches, latest, heat, activity, low, dormant, coupons, returning, health] = await Promise.all([
    q(`select coalesce(sum(total),0)::float as v from expenses where date between $1 and $2 and ($3::int is null or branch_id = $3)`),
    q(`select count(*)::int as v from customers where created_at between $1 and $2`, [p.from, p.to]),
    q(`select to_char(date_trunc(case when $2::timestamptz - $1::timestamptz <= interval '1 day' then 'hour' else 'day' end, i.created_at at time zone 'Asia/Riyadh'), 'YYYY-MM-DD"T"HH24:MI') as bucket,
        coalesce(sum(total) filter (where type='INVOICE'),0)::float as sales, coalesce(sum(subtotal - cost_total) filter (where type='INVOICE'),0)::float as profit,
        count(*) filter (where type='INVOICE')::int as orders, coalesce(sum(total) filter (where type='CREDIT_NOTE'),0)::float as returns
      from invoices i where ${salesWhere} group by 1 order by 1`),
    q(`select coalesce(c.name, 'بلا تصنيف') as name, sum(ii.total)::float as total from invoice_items ii join invoices i on i.id = ii.invoice_id left join products p on p.id = ii.product_id left join categories c on c.id = p.category_id where ${salesWhere} and i.type='INVOICE' group by 1 order by 2 desc limit 8`),
    q(`select ii.product_id, max(ii.name) as name, sum(ii.qty)::float as qty, sum(ii.total)::float as total from invoice_items ii join invoices i on i.id = ii.invoice_id where ${salesWhere} and i.type='INVOICE' and ii.product_id is not null group by 1 order by 4 desc limit 10`),
    q(`select p.method, sum(p.amount)::float as total, count(*)::int as count from payments p join invoices i on i.id = p.invoice_id where ${salesWhere} group by 1 order by 2 desc`),
    q(`select b.id, b.name, coalesce(sum(i.total) filter (where i.type='INVOICE'),0)::float as total from branches b left join invoices i on i.branch_id = b.id and i.status not in ('DRAFT','CANCELLED') and i.created_at between $1 and $2 where b.type='BRANCH' group by b.id order by 3 desc`, [p.from, p.to]),
    q(`select i.id, i.number, i.total::float, i.type, i.status, i.created_at, (select name from customers c where c.id = i.customer_id) as customer from invoices i where ${salesWhere} order by i.id desc limit 8`),
    q(`select extract(isodow from i.created_at at time zone 'Asia/Riyadh')::int as dow, extract(hour from i.created_at at time zone 'Asia/Riyadh')::int as hour, sum(total)::float as total, count(*)::int as count from invoices i where ${salesWhere} and i.type='INVOICE' group by 1,2`),
    q(`select a.summary, a.created_at, u.name as user_name from activity_logs a left join users u on u.id = a.user_id order by a.id desc limit 8`, []),
    q(`select p.id, p.name, p.price::float, coalesce(sum(s.qty),0)::float as stock, coalesce((select sum(ii.qty) from invoice_items ii where ii.product_id = p.id),0)::float as sold
      from products p left join stocks s on s.product_id = p.id where p.active and not p.unlimited and p.type in ('SIMPLE','PRO') and not p.is_composite group by p.id having coalesce(sum(s.qty),0) <= coalesce(max(p.low_stock_alert), 5) order by 4 asc limit 10`, []),
    q(`select p.id, p.name, p.price::float, coalesce((select sum(qty) from stocks s where s.product_id = p.id),0)::float as stock, (select max(i.created_at) from invoice_items ii join invoices i on i.id = ii.invoice_id where ii.product_id = p.id) as last_sold
      from products p where p.active and not exists (select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id where ii.product_id = p.id and i.created_at > now() - interval '90 days') order by p.id limit 10`, []),
    q(`select id, name, code, ends_at, used_count from coupons where active and ends_at between now() and now() + interval '7 days' order by ends_at limit 5`, []),
    q(`select count(distinct customer_id) filter (where customer_id is not null)::int as customers, count(distinct customer_id) filter (where customer_id is not null and exists (select 1 from invoices x where x.customer_id = i.customer_id and x.created_at < $1))::int as returning
      from invoices i where ${salesWhere} and i.type='INVOICE'`),
    q(`select (select count(*)::int from products where cost = 0 and avg_cost = 0 and not unlimited and type in ('SIMPLE','PRO')) as no_cost, (select count(*)::int from stocks where not counted) as uncounted, (select count(*)::int from invoices where zatca_status in ('PENDING','REJECTED')) as zatca_pending`, []),
  ]);
  const pos = await getSetting('pos');
  const { rows: [month] } = await pool.query(`select coalesce(sum(total) filter (where type='INVOICE'),0)::float - coalesce(sum(total) filter (where type='CREDIT_NOTE'),0)::float as v from invoices where status not in ('DRAFT','CANCELLED') and created_at >= date_trunc('month', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'`);
  const pct = (a: number, b: number) => (b ? r2(((a - b) / b) * 100) : a ? 100 : 0);
  res.json({
    current: cur, previous: prev, change: { sales: pct(cur.sales, prev.sales), invoices: pct(cur.invoices, prev.invoices) },
    expenses: expenses[0].v, newCustomers: newCustomers[0].v, trend, byCategory, top, payments, branches, latest, heat, activity, low, dormant, coupons,
    returning: returning[0], health: health[0], target: { value: pos.salesTarget, achieved: month.v },
  });
}));

r.use(can('reports.view'));

r.get('/sales-summary', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const group = ['hour', 'day', 'week', 'month'].includes(String(req.query.group)) ? String(req.query.group) : 'day';
  const [cur, prev] = await Promise.all([totals(p.from, p.to, p.branchId), totals(p.prevFrom, p.prevTo, p.branchId)]);
  const { rows } = await pool.query(`with pay as (
      select invoice_id, sum(amount) filter (where method='CASH') as cash, sum(amount) filter (where method='CARD') as card from payments group by 1
    )
    select to_char(date_trunc('${group}', i.created_at at time zone 'Asia/Riyadh'), 'YYYY-MM-DD HH24:00') as bucket,
      coalesce(sum(i.total) filter (where i.type='INVOICE'),0)::float as sales, coalesce(sum(i.total) filter (where i.type='CREDIT_NOTE'),0)::float as returns,
      coalesce(sum(i.tax_total) filter (where i.type='INVOICE'),0)::float as tax, count(*) filter (where i.type='INVOICE')::int as invoices,
      coalesce(sum(pay.cash),0)::float as cash, coalesce(sum(pay.card),0)::float as card
    from invoices i left join pay on pay.invoice_id = i.id where ${salesWhere} group by 1 order by 1`, [p.from, p.to, p.branchId]);
  res.json({ current: cur, previous: prev, rows });
}));

r.get('/top-products', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select ii.product_id, max(ii.name) as name, sum(ii.qty)::float as qty, sum(ii.total)::float as total, sum(ii.net_amount - ii.unit_cost * ii.qty)::float as profit,
      coalesce((select sum(qty) from stocks s where s.product_id = ii.product_id),0)::float as stock
    from invoice_items ii join invoices i on i.id = ii.invoice_id where ${salesWhere} and i.type='INVOICE' group by 1 order by 4 desc limit 100`, [p.from, p.to, p.branchId]);
  const total = rows.reduce((s, x) => s + x.total, 0);
  let cum = 0;
  res.json(rows.map((x) => { cum += x.total; return { ...x, share: total ? r2((x.total / total) * 100) : 0, cumulative: total ? r2((cum / total) * 100) : 0 }; }));
}));

r.get('/by-payment', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select p.method, sum(p.amount) filter (where p.amount > 0)::float as received, coalesce(-sum(p.amount) filter (where p.amount < 0),0)::float as refunded, count(*)::int as count
    from payments p join invoices i on i.id = p.invoice_id where ${salesWhere} group by 1 order by 2 desc`, [p.from, p.to, p.branchId]);
  const { rows: [credit] } = await pool.query(`select coalesce(sum(due),0)::float as v from invoices i where ${salesWhere} and type='INVOICE'`, [p.from, p.to, p.branchId]);
  res.json({ rows, credit: credit.v });
}));

r.get('/by-category', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select coalesce(c.name,'بلا تصنيف') as name, sum(ii.qty)::float as qty, sum(ii.total)::float as total, sum(ii.net_amount - ii.unit_cost*ii.qty)::float as profit
    from invoice_items ii join invoices i on i.id = ii.invoice_id left join products pr on pr.id = ii.product_id left join categories c on c.id = pr.category_id
    where ${salesWhere} and i.type='INVOICE' group by 1 order by 3 desc`, [p.from, p.to, p.branchId]);
  res.json(rows);
}));

r.get('/by-branch', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select b.name, coalesce(sum(i.total) filter (where i.type='INVOICE'),0)::float as sales, count(i.id) filter (where i.type='INVOICE')::int as invoices,
      coalesce(sum(i.total) filter (where i.type='CREDIT_NOTE'),0)::float as returns, coalesce(sum(i.discount) filter (where i.type='INVOICE'),0)::float as discounts
    from branches b left join invoices i on i.branch_id = b.id and i.status not in ('DRAFT','CANCELLED') and i.created_at between $1 and $2 group by b.id order by 2 desc`, [p.from, p.to]);
  res.json(rows.map((x) => ({ ...x, avg: x.invoices ? r2(x.sales / x.invoices) : 0 })));
}));

r.get('/by-cashier', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select u.name, coalesce(sum(i.total) filter (where i.type='INVOICE'),0)::float as sales, count(i.id) filter (where i.type='INVOICE')::int as invoices,
      coalesce(sum(i.total) filter (where i.type='CREDIT_NOTE'),0)::float as returns, coalesce(sum(i.discount) filter (where i.type='INVOICE'),0)::float as discounts
    from users u join invoices i on i.user_id = u.id where ${salesWhere} group by u.id order by 2 desc`, [p.from, p.to, p.branchId]);
  res.json(rows.map((x) => ({ ...x, avg: x.invoices ? r2(x.sales / x.invoices) : 0 })));
}));

r.get('/hourly', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select extract(isodow from created_at at time zone 'Asia/Riyadh')::int as dow, extract(hour from created_at at time zone 'Asia/Riyadh')::int as hour, sum(total)::float as total, count(*)::int as count
    from invoices i where ${salesWhere} and type='INVOICE' group by 1,2`, [p.from, p.to, p.branchId]);
  res.json(rows);
}));

r.get('/customers', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select c.id, c.name, c.phone, count(i.id)::int as invoices, sum(i.total)::float as total, max(i.created_at) as last_purchase, min(i.created_at) as first_purchase
    from customers c join invoices i on i.customer_id = c.id where ${salesWhere} and i.type='INVOICE' group by c.id order by 5 desc limit 100`, [p.from, p.to, p.branchId]);
  res.json(rows);
}));

r.get('/ar-aging', ah(async (_req, res) => {
  const { rows } = await pool.query(`select coalesce(c.name,'بلا عميل') as customer, c.phone,
      coalesce(sum(i.due) filter (where now() - i.created_at <= interval '30 days'),0)::float as d0_30,
      coalesce(sum(i.due) filter (where now() - i.created_at > interval '30 days' and now() - i.created_at <= interval '60 days'),0)::float as d31_60,
      coalesce(sum(i.due) filter (where now() - i.created_at > interval '60 days' and now() - i.created_at <= interval '90 days'),0)::float as d61_90,
      coalesce(sum(i.due) filter (where now() - i.created_at > interval '90 days'),0)::float as d90_plus, sum(i.due)::float as total
    from invoices i left join customers c on c.id = i.customer_id where i.type='INVOICE' and i.due > 0 and i.status <> 'DRAFT' group by c.id order by total desc`);
  res.json(rows);
}));

r.get('/returns', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select ii.product_id, max(ii.name) as name, sum(ii.qty)::float as qty, sum(ii.total)::float as total
    from invoice_items ii join invoices i on i.id = ii.invoice_id where ${salesWhere} and i.type='CREDIT_NOTE' group by 1 order by 4 desc limit 50`, [p.from, p.to, p.branchId]);
  res.json(rows);
}));

r.get('/profit', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const t = await totals(p.from, p.to, p.branchId);
  const { rows: [e] } = await pool.query(`select coalesce(sum(amount),0)::float as v from expenses where date between $1 and $2 and ($3::int is null or branch_id = $3)`, [p.from, p.to, p.branchId]);
  res.json({ ...t, expenses: e.v, netProfit: r2(t.profit - e.v) });
}));

r.get('/offers', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select coalesce(coupon_code, 'عروض المنتجات') as name, count(*)::int as invoices, sum(total)::float as sales, sum(discount)::float as discount
    from invoices i where ${salesWhere} and type='INVOICE' and (coupon_code is not null or offer_discount > 0) group by 1 order by 3 desc`, [p.from, p.to, p.branchId]);
  res.json(rows);
}));

r.get('/employee-sales', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select i.number, i.created_at, i.total::float, i.tax_total::float, u.name as cashier from invoices i join users u on u.id = i.user_id where ${salesWhere} and i.is_employee_sale order by i.id desc`, [p.from, p.to, p.branchId]);
  res.json(rows);
}));

r.get('/inventory', ah(async (req, res) => {
  const { rows } = await pool.query(`select p.id, p.name, p.barcode, coalesce(c.name,'بلا تصنيف') as category, coalesce(sum(s.qty),0)::float as qty, coalesce(nullif(p.avg_cost,0), p.cost)::float as cost, p.price::float,
      (coalesce(sum(s.qty),0) * coalesce(nullif(p.avg_cost,0), p.cost))::float as value, p.expiry_date
    from products p left join stocks s on s.product_id = p.id and ($1::int is null or s.branch_id = $1) left join categories c on c.id = p.category_id
    where not p.unlimited and p.type in ('SIMPLE','PRO') group by p.id, c.name order by value desc`, [req.query.branchId ? Number(req.query.branchId) : null]);
  res.json(rows);
}));

r.get('/cost-gap', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select ii.product_id, max(ii.name) as name, sum(ii.qty)::float as qty, sum(ii.total)::float as total from invoice_items ii join invoices i on i.id = ii.invoice_id
    where ${salesWhere} and i.type='INVOICE' and ii.unit_cost = 0 and ii.product_id is not null group by 1 order by 4 desc`, [p.from, p.to, p.branchId]);
  res.json(rows);
}));

r.get('/purchases', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select coalesce(s.name,'بلا مورد') as supplier, count(*)::int as count, sum(case when pu.is_return then -pu.total else pu.total end)::float as total, sum(pu.total - pu.paid)::float as due
    from purchases pu left join suppliers s on s.id = pu.supplier_id where pu.status='APPROVED' and pu.date between $1 and $2 group by 1 order by 3 desc`, [p.from, p.to]);
  res.json(rows);
}));

r.get('/expenses', ah(async (req, res) => {
  const p = period(req.query as Record<string, string>);
  const { rows } = await pool.query(`select c.name as category, count(*)::int as count, sum(e.total)::float as total from expenses e join expense_categories c on c.id = e.category_id where e.date between $1 and $2 group by 1 order by 3 desc`, [p.from, p.to]);
  res.json(rows);
}));

r.get('/activity', ah(async (req, res) => {
  const { rows } = await pool.query(`select a.*, u.name as user_name from activity_logs a left join users u on u.id = a.user_id order by a.id desc limit $1 offset $2`, [Number(req.query.limit ?? 50), Number(req.query.offset ?? 0)]);
  res.json(rows);
}));

export default r;
