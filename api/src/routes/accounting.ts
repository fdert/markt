// المحاسبة: دليل الحسابات، القيود، ميزان المراجعة، قائمة الدخل، الميزانية، إقرار ضريبة القيمة المضافة، الفترات
import { Router } from 'express';
import { z } from 'zod';
import { asc, desc, eq } from 'drizzle-orm';
import { db, pool, schema } from '../db/index.js';
import { ah, badRequest, page } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { postEntry } from '../services/accounting.js';
import { r2 } from '../lib/money.js';

const r = Router();
r.use(can('accounting.view'));

const range = (q: Record<string, string>) => ({ from: q.from ? new Date(q.from) : new Date('2000-01-01'), to: q.to ? new Date(new Date(q.to).getTime() + 86400000 - 1) : new Date('2999-12-31') });

r.get('/accounts', ah(async (req, res) => {
  const { from, to } = range(req.query as Record<string, string>);
  const { rows } = await pool.query(`select a.id, a.code, a.name, a.type, a.parent_id, a.system_key, a.is_group,
    coalesce(sum(l.debit),0)::float as debit, coalesce(sum(l.credit),0)::float as credit
    from accounts a left join journal_lines l on l.account_id = a.id left join journal_entries e on e.id = l.entry_id and e.date between $1 and $2
    where l.id is null or e.id is not null group by a.id order by a.code`, [from, to]);
  res.json(rows.map((a) => ({ ...a, balance: ['ASSET', 'EXPENSE'].includes(a.type) ? r2(a.debit - a.credit) : r2(a.credit - a.debit) })));
}));

r.post('/accounts', can('accounting.manage'), ah(async (req, res) => {
  const b = z.object({ code: z.string().regex(/^\d{3,8}$/, 'رقم الحساب من 3 إلى 8 أرقام.'), name: z.string().min(2), type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']), parentId: z.number().nullish(), isGroup: z.boolean().default(false) }).parse(req.body);
  const [row] = await db.insert(schema.accounts).values(b).returning();
  res.status(201).json(row);
}));

r.get('/entries', ah(async (req, res) => {
  const q = req.query as Record<string, string>; const { limit, offset } = page(q); const { from, to } = range(q);
  const { rows } = await pool.query(`select e.*, u.name as user_name,
      json_agg(json_build_object('account', a.code || ' - ' || a.name, 'debit', l.debit::float, 'credit', l.credit::float, 'memo', l.memo) order by l.id) as lines
    from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id left join users u on u.id = e.user_id
    where e.date between $1 and $2 and ($3::int is null or l.account_id = $3) group by e.id, u.name order by e.id desc limit $4 offset $5`,
    [from, to, q.accountId ? Number(q.accountId) : null, limit, offset]);
  res.json(rows);
}));

r.post('/entries', can('accounting.manage'), ah(async (req, res) => {
  const b = z.object({ description: z.string().min(3, 'اكتب بيان القيد.'), date: z.string().optional(), lines: z.array(z.object({ accountId: z.number(), debit: z.number().min(0).default(0), credit: z.number().min(0).default(0), memo: z.string().optional() })).min(2, 'القيد يحتاج سطرين على الأقل.') }).parse(req.body);
  const dr = r2(b.lines.reduce((s, l) => s + l.debit, 0)); const cr = r2(b.lines.reduce((s, l) => s + l.credit, 0));
  if (dr !== cr || dr === 0) throw badRequest('مجموع المدين يجب أن يساوي مجموع الدائن.');
  const e = await db.transaction((tx) => postEntry(tx, { description: b.description, date: b.date ? new Date(b.date) : undefined, refType: 'manual', userId: req.user!.id, lines: b.lines }));
  res.status(201).json(e);
}));

r.get('/trial-balance', ah(async (req, res) => {
  const { from, to } = range(req.query as Record<string, string>);
  const { rows } = await pool.query(`select a.code, a.name, a.type,
      coalesce(sum(l.debit) filter (where e.date < $1),0)::float as open_debit, coalesce(sum(l.credit) filter (where e.date < $1),0)::float as open_credit,
      coalesce(sum(l.debit) filter (where e.date between $1 and $2),0)::float as debit, coalesce(sum(l.credit) filter (where e.date between $1 and $2),0)::float as credit
    from accounts a join journal_lines l on l.account_id = a.id join journal_entries e on e.id = l.entry_id where e.date <= $2
    group by a.id order by a.code`, [from, to]);
  res.json(rows.map((x) => { const net = x.open_debit - x.open_credit + x.debit - x.credit; return { ...x, closing_debit: net > 0 ? r2(net) : 0, closing_credit: net < 0 ? r2(-net) : 0 }; }));
}));

async function balancesByKeyType(from: Date, to: Date) {
  const { rows } = await pool.query(`select a.id, a.code, a.name, a.type, a.system_key, coalesce(sum(l.debit),0)::float as debit, coalesce(sum(l.credit),0)::float as credit
    from accounts a join journal_lines l on l.account_id = a.id join journal_entries e on e.id = l.entry_id where e.date between $1 and $2 group by a.id order by a.code`, [from, to]);
  return rows;
}

r.get('/income-statement', ah(async (req, res) => {
  const { from, to } = range(req.query as Record<string, string>);
  const rows = await balancesByKeyType(from, to);
  const revenue = rows.filter((a) => a.type === 'REVENUE').map((a) => ({ ...a, amount: r2(a.credit - a.debit) }));
  const expenses = rows.filter((a) => a.type === 'EXPENSE').map((a) => ({ ...a, amount: r2(a.debit - a.credit) }));
  const totalRevenue = r2(revenue.reduce((s, a) => s + a.amount, 0));
  const cogs = expenses.find((a) => a.system_key === 'COGS')?.amount ?? 0;
  const totalExpenses = r2(expenses.reduce((s, a) => s + a.amount, 0));
  res.json({ revenue, expenses, totalRevenue, cogs, grossProfit: r2(totalRevenue - cogs), totalExpenses, netProfit: r2(totalRevenue - totalExpenses) });
}));

r.get('/balance-sheet', ah(async (req, res) => {
  const to = (req.query.to ? new Date(new Date(req.query.to as string).getTime() + 86400000 - 1) : new Date());
  const rows = await balancesByKeyType(new Date('2000-01-01'), to);
  const side = (t: string, debitNature: boolean) => rows.filter((a) => a.type === t).map((a) => ({ ...a, amount: r2(debitNature ? a.debit - a.credit : a.credit - a.debit) })).filter((a) => a.amount !== 0);
  const assets = side('ASSET', true); const liabilities = side('LIABILITY', false); const equity = side('EQUITY', false);
  const profit = r2(rows.filter((a) => a.type === 'REVENUE').reduce((s, a) => s + a.credit - a.debit, 0) - rows.filter((a) => a.type === 'EXPENSE').reduce((s, a) => s + a.debit - a.credit, 0));
  const t = (arr: { amount: number }[]) => r2(arr.reduce((s, a) => s + a.amount, 0));
  res.json({ assets, liabilities, equity, currentProfit: profit, totalAssets: t(assets), totalLiabilities: t(liabilities), totalEquity: r2(t(equity) + profit) });
}));

/** إقرار ضريبة القيمة المضافة: المبيعات الخاضعة والمشتريات والمصروفات لفترة */
r.get('/vat-return', ah(async (req, res) => {
  const { from, to } = range(req.query as Record<string, string>);
  const { rows: [s] } = await pool.query(`select
      coalesce(sum(ii.net_amount) filter (where i.type='INVOICE' and ii.tax_rate > 0),0)::float as std_sales,
      coalesce(sum(ii.tax_amount) filter (where i.type='INVOICE'),0)::float as std_sales_vat,
      coalesce(sum(ii.net_amount) filter (where i.type='INVOICE' and ii.tax_rate = 0),0)::float as zero_sales,
      coalesce(sum(ii.net_amount) filter (where i.type='CREDIT_NOTE' and ii.tax_rate > 0),0)::float as returns_net,
      coalesce(sum(ii.tax_amount) filter (where i.type='CREDIT_NOTE'),0)::float as returns_vat
    from invoice_items ii join invoices i on i.id = ii.invoice_id where i.status not in ('DRAFT','CANCELLED') and i.type in ('INVOICE','CREDIT_NOTE') and i.created_at between $1 and $2`, [from, to]);
  const { rows: [p] } = await pool.query(`select coalesce(sum(case when is_return then -subtotal else subtotal end) filter (where tax_total <> 0),0)::float as std_purchases,
      coalesce(sum(case when is_return then -tax_total else tax_total end),0)::float as purchases_vat from purchases where status='APPROVED' and date between $1 and $2`, [from, to]);
  const { rows: [e] } = await pool.query(`select coalesce(sum(amount) filter (where tax_amount > 0),0)::float as std_expenses, coalesce(sum(tax_amount),0)::float as expenses_vat from expenses where date between $1 and $2`, [from, to]);
  const outputVat = r2(s.std_sales_vat - s.returns_vat); const inputVat = r2(p.purchases_vat + e.expenses_vat);
  res.json({
    sales: { standard: r2(s.std_sales - s.returns_net), standardVat: outputVat, zeroRated: s.zero_sales, returns: s.returns_net, returnsVat: s.returns_vat },
    purchases: { standard: r2(p.std_purchases + e.std_expenses), vat: inputVat, purchases: p.std_purchases, expenses: e.std_expenses },
    outputVat, inputVat, netVat: r2(outputVat - inputVat),
  });
}));

r.get('/periods', ah(async (_req, res) => res.json(await db.select().from(schema.accountingPeriods).orderBy(desc(schema.accountingPeriods.startDate)))));
r.post('/periods', can('accounting.manage'), ah(async (req, res) => {
  const b = z.object({ name: z.string().min(2), startDate: z.string(), endDate: z.string() }).parse(req.body);
  const [row] = await db.insert(schema.accountingPeriods).values({ name: b.name, startDate: new Date(b.startDate), endDate: new Date(new Date(b.endDate).getTime() + 86400000 - 1) }).returning();
  res.status(201).json(row);
}));
r.post('/periods/:id/:action', can('accounting.manage'), ah(async (req, res) => {
  const close = req.params.action === 'close';
  await db.update(schema.accountingPeriods).set({ closed: close, closedAt: close ? new Date() : null }).where(eq(schema.accountingPeriods.id, Number(req.params.id)));
  res.json({ message: close ? 'تم إقفال الفترة.' : 'تم فتح الفترة.' });
}));

/** صحة الحسابات: فحوصات سريعة للمشكلات الشائعة */
r.get('/health', ah(async (_req, res) => {
  const { rows: [h] } = await pool.query(`select
    (select count(*)::int from products where cost = 0 and avg_cost = 0 and not unlimited and type in ('SIMPLE','PRO')) as products_without_cost,
    (select count(*)::int from stocks where not counted) as uncounted_stocks,
    (select count(*)::int from invoices where zatca_status in ('PENDING','REJECTED')) as zatca_pending,
    (select coalesce(sum(debit) - sum(credit),0)::float from journal_lines) as ledger_diff,
    (select count(*)::int from shifts where status = 'CLOSED' and difference <> 0) as shifts_with_diff`);
  res.json(h);
}));

export default r;
