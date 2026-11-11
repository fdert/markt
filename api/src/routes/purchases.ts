// الموردون، فواتير الشراء (مع تحديث متوسط التكلفة)، المصروفات
import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';
import { qcol } from '../lib/col.js';
import { db, schema } from '../db/index.js';
import { ah, badRequest, notFound, page } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { nextNumber } from '../lib/counter.js';
import { r2, r4 } from '../lib/money.js';
import { moveStock, isStockTracked } from '../services/inventory.js';
import { postEntry, methodAccount } from '../services/accounting.js';
import { logActivity } from '../lib/activity.js';
import { getSetting } from '../lib/settings.js';

const r = Router();
const S = schema.suppliers; const PU = schema.purchases;

// ===== الموردون =====
const supBalance = sql<number>`coalesce((select sum(case when p.is_return then -(p.total - p.paid) else p.total - p.paid end) from purchases p where p.supplier_id = ${qcol(S.id)} and p.status = 'APPROVED'),0)::float`;
r.get('/suppliers', can('suppliers.manage', 'purchases.manage'), ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const rows = await db.select({ id: S.id, name: S.name, phone: S.phone, email: S.email, vatNumber: S.vatNumber, crNumber: S.crNumber, city: S.city, address: S.address, notes: S.notes, active: S.active, balance: supBalance,
    purchasesTotal: sql<number>`coalesce((select sum(total) from purchases p where p.supplier_id = ${qcol(S.id)} and p.status = 'APPROVED' and not p.is_return),0)::float` })
    .from(S).where(q.search ? ilike(S.name, `%${q.search}%`) : undefined).orderBy(asc(S.name));
  res.json(rows);
}));
const supBody = z.object({ name: z.string().min(2, 'اسم المورد مطلوب.'), phone: z.string().nullish(), email: z.string().email('البريد الإلكتروني غير صحيح.').nullish().or(z.literal('')), vatNumber: z.string().regex(/^3\d{13}3$/, 'الرقم الضريبي 15 رقماً يبدأ وينتهي بالرقم 3.').nullish().or(z.literal('')), crNumber: z.string().nullish(), city: z.string().nullish(), address: z.string().nullish(), notes: z.string().nullish(), active: z.boolean().default(true) });
r.post('/suppliers', can('suppliers.manage'), ah(async (req, res) => { const b = supBody.parse(req.body); const [row] = await db.insert(S).values({ ...b, email: b.email || null, vatNumber: b.vatNumber || null }).returning(); res.status(201).json(row); }));
r.put('/suppliers/:id', can('suppliers.manage'), ah(async (req, res) => { const b = supBody.partial().parse(req.body); const [row] = await db.update(S).set({ ...b, email: b.email || null, vatNumber: b.vatNumber || null }).where(eq(S.id, Number(req.params.id))).returning(); res.json(row); }));

// ===== فواتير الشراء =====
r.get('/purchases', can('purchases.manage'), ah(async (req, res) => {
  const q = req.query as Record<string, string>; const { limit, offset } = page(q);
  const where: SQL[] = [];
  if (q.supplierId) where.push(eq(PU.supplierId, Number(q.supplierId)));
  if (q.status) where.push(eq(PU.status, q.status));
  if (q.from) where.push(gte(PU.date, new Date(q.from)));
  if (q.to) where.push(lte(PU.date, new Date(q.to)));
  const cond = where.length ? and(...where) : undefined;
  const rows = await db.select({ id: PU.id, number: PU.number, isReturn: PU.isReturn, date: PU.date, status: PU.status, subtotal: PU.subtotal, taxTotal: PU.taxTotal, total: PU.total, paid: PU.paid, supplierInvoiceNo: PU.supplierInvoiceNo,
    supplier: sql<string>`(select name from suppliers s where s.id = ${qcol(PU.supplierId)})`, branch: sql<string>`(select name from branches b where b.id = ${qcol(PU.branchId)})` })
    .from(PU).where(cond).orderBy(desc(PU.id)).limit(limit).offset(offset);
  const [stats] = await db.select({ total: sql<number>`coalesce(sum(total) filter (where status='APPROVED' and not is_return),0)::float`, tax: sql<number>`coalesce(sum(tax_total) filter (where status='APPROVED' and not is_return),0)::float`, due: sql<number>`coalesce(sum(total-paid) filter (where status='APPROVED' and not is_return),0)::float`, drafts: sql<number>`count(*) filter (where status='DRAFT')::int` }).from(PU).where(cond);
  res.json({ rows, stats });
}));

r.get('/purchases/:id', can('purchases.manage'), ah(async (req, res) => {
  const [p] = await db.select().from(PU).where(eq(PU.id, Number(req.params.id)));
  if (!p) throw notFound('فاتورة الشراء غير موجودة.');
  const items = await db.select({ id: schema.purchaseItems.id, productId: schema.purchaseItems.productId, qty: schema.purchaseItems.qty, unitCost: schema.purchaseItems.unitCost, taxRate: schema.purchaseItems.taxRate, taxAmount: schema.purchaseItems.taxAmount, total: schema.purchaseItems.total, expiryDate: schema.purchaseItems.expiryDate, name: schema.products.name, barcode: schema.products.barcode })
    .from(schema.purchaseItems).innerJoin(schema.products, eq(schema.products.id, schema.purchaseItems.productId)).where(eq(schema.purchaseItems.purchaseId, p.id));
  res.json({ ...p, items });
}));

const purBody = z.object({
  supplierId: z.number().nullish(), branchId: z.number(), supplierInvoiceNo: z.string().nullish(), date: z.string().nullish(), isReturn: z.boolean().default(false),
  paid: z.number().min(0).default(0), paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT']).default('CASH'), notes: z.string().nullish(), approve: z.boolean().default(false),
  pricesIncludeTax: z.boolean().default(false),
  items: z.array(z.object({ productId: z.number(), qty: z.number().positive('الكمية يجب أن تكون أكبر من صفر.'), unitCost: z.number().min(0), taxable: z.boolean().default(true), expiryDate: z.string().nullish() })).min(1, 'أضف صنفاً واحداً على الأقل.'),
});

async function approvePurchase(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: number, userId: number) {
  const [p] = await tx.select().from(PU).where(eq(PU.id, id));
  if (!p || p.status !== 'DRAFT') throw badRequest('فاتورة الشراء معتمدة أو ملغاة.');
  const items = await tx.select().from(schema.purchaseItems).where(eq(schema.purchaseItems.purchaseId, id));
  for (const it of items) {
    const [prod] = await tx.select().from(schema.products).where(eq(schema.products.id, it.productId));
    if (!isStockTracked(prod)) continue;
    const [{ q }] = await tx.select({ q: sql<number>`coalesce(sum(qty),0)::float` }).from(schema.stocks).where(eq(schema.stocks.productId, prod.id));
    if (!p.isReturn) {
      // متوسط التكلفة المرجّح
      const oldQty = Math.max(0, q); const oldCost = prod.avgCost || prod.cost;
      const newAvg = oldQty + it.qty > 0 ? r4((oldQty * oldCost + it.qty * it.unitCost) / (oldQty + it.qty)) : it.unitCost;
      await tx.update(schema.products).set({ avgCost: newAvg, cost: it.unitCost, ...(it.expiryDate ? { expiryDate: it.expiryDate } : {}) }).where(eq(schema.products.id, prod.id));
    }
    await moveStock(tx, { productId: prod.id, branchId: p.branchId, qty: p.isReturn ? -it.qty : it.qty, type: p.isReturn ? 'PURCHASE_RETURN' : 'PURCHASE', refType: 'purchase', refId: p.id, userId, unitCost: it.unitCost, setCounted: true });
  }
  const sign = p.isReturn ? -1 : 1;
  const due = r2(p.total - p.paid);
  await postEntry(tx, { description: `${p.isReturn ? 'مرتجع مشتريات' : 'فاتورة شراء'} ${p.number}`, refType: 'purchase', refId: p.id, branchId: p.branchId, userId, date: p.date,
    lines: [{ key: 'INVENTORY', debit: sign * p.subtotal }, { key: 'VAT_INPUT', debit: sign * p.taxTotal }, ...(p.paid > 0 ? [{ key: methodAccount(p.paymentMethod) === 'AR' ? 'AP' : methodAccount(p.paymentMethod), credit: sign * p.paid }] : []), ...(due > 0 ? [{ key: 'AP', credit: sign * due }] : [])] });
  await tx.update(PU).set({ status: 'APPROVED' }).where(eq(PU.id, id));
  await logActivity({ userId, action: 'purchase.approve', entity: 'purchase', entityId: id, summary: `اعتمد ${p.isReturn ? 'مرتجع المشتريات' : 'فاتورة الشراء'} ${p.number} بمبلغ ${p.total.toFixed(2)}` }, tx);
}

r.post('/purchases', can('purchases.manage'), ah(async (req, res) => {
  const b = purBody.parse(req.body);
  const tax = await getSetting('tax');
  const out = await db.transaction(async (tx) => {
    const lines = b.items.map((it) => {
      const rate = tax.enabled && it.taxable ? tax.rate : 0;
      const unitCost = b.pricesIncludeTax ? r4(it.unitCost / (1 + rate / 100)) : it.unitCost;
      const net = r2(unitCost * it.qty); const taxAmount = r2(net * rate / 100);
      return { ...it, unitCost, taxRate: rate, taxAmount, total: r2(net + taxAmount), net, expiryDate: it.expiryDate ? new Date(it.expiryDate) : null };
    });
    const subtotal = r2(lines.reduce((s, l) => s + l.net, 0)); const taxTotal = r2(lines.reduce((s, l) => s + l.taxAmount, 0)); const total = r2(subtotal + taxTotal);
    const paid = b.paymentMethod === 'CREDIT' ? 0 : Math.min(b.paid || total, total);
    if (paid < total && !b.supplierId) throw badRequest('الشراء الآجل يتطلب اختيار المورد.');
    const [p] = await tx.insert(PU).values({ number: await nextNumber(tx, b.isReturn ? 'pret' : 'purchase', b.isReturn ? 'PR-' : 'PUR-'), isReturn: b.isReturn, supplierId: b.supplierId, branchId: b.branchId, supplierInvoiceNo: b.supplierInvoiceNo, date: b.date ? new Date(b.date) : new Date(), subtotal, taxTotal, total, paid, paymentMethod: b.paymentMethod, notes: b.notes, userId: req.user!.id }).returning();
    await tx.insert(schema.purchaseItems).values(lines.map((l) => ({ purchaseId: p.id, productId: l.productId, qty: l.qty, unitCost: l.unitCost, taxRate: l.taxRate, taxAmount: l.taxAmount, total: l.total, expiryDate: l.expiryDate })));
    if (b.approve) await approvePurchase(tx, p.id, req.user!.id);
    return p;
  });
  res.status(201).json(out);
}));

r.post('/purchases/:id/approve', can('purchases.manage'), ah(async (req, res) => {
  await db.transaction((tx) => approvePurchase(tx, Number(req.params.id), req.user!.id));
  res.json({ message: 'تم الاعتماد.' });
}));

r.post('/purchases/:id/pay', can('purchases.manage'), ah(async (req, res) => {
  const b = z.object({ amount: z.number().positive(), method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']) }).parse(req.body);
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(PU).where(eq(PU.id, Number(req.params.id)));
    if (!p || p.status !== 'APPROVED') throw badRequest('الفاتورة غير معتمدة.');
    const amount = r2(Math.min(b.amount, p.total - p.paid));
    if (amount <= 0) throw badRequest('لا يوجد مبلغ مستحق.');
    await tx.update(PU).set({ paid: r2(p.paid + amount) }).where(eq(PU.id, p.id));
    await postEntry(tx, { description: `سداد للمورد - ${p.number}`, refType: 'supplier_payment', refId: p.id, branchId: p.branchId, userId: req.user!.id, lines: [{ key: 'AP', debit: amount }, { key: methodAccount(b.method), credit: amount }] });
  });
  res.json({ message: 'تم تسجيل السداد.' });
}));

r.delete('/purchases/:id', can('purchases.manage'), ah(async (req, res) => {
  const [p] = await db.select().from(PU).where(eq(PU.id, Number(req.params.id)));
  if (!p || p.status !== 'DRAFT') throw badRequest('يمكن حذف المسودات فقط.');
  await db.delete(PU).where(eq(PU.id, p.id));
  res.json({ message: 'تم الحذف.' });
}));

// ===== المصروفات =====
r.get('/expense-categories', ah(async (_req, res) => res.json(await db.select().from(schema.expenseCategories).orderBy(asc(schema.expenseCategories.name)))));
r.post('/expense-categories', can('expenses.manage'), ah(async (req, res) => {
  const [row] = await db.insert(schema.expenseCategories).values(z.object({ name: z.string().min(2), accountId: z.number().nullish() }).parse(req.body)).returning();
  res.status(201).json(row);
}));

r.get('/expenses', can('expenses.manage'), ah(async (req, res) => {
  const q = req.query as Record<string, string>; const { limit, offset } = page(q);
  const E = schema.expenses;
  const cond = and(q.categoryId ? eq(E.categoryId, Number(q.categoryId)) : undefined, q.branchId ? eq(E.branchId, Number(q.branchId)) : undefined, q.from ? gte(E.date, new Date(q.from)) : undefined, q.to ? lte(E.date, new Date(q.to)) : undefined, q.recurring ? sql`${qcol(E.recurring)} is not null` : undefined);
  const rows = await db.select({ id: E.id, number: E.number, amount: E.amount, taxAmount: E.taxAmount, total: E.total, date: E.date, notes: E.notes, vendorName: E.vendorName, paymentMethod: E.paymentMethod, recurring: E.recurring,
    category: schema.expenseCategories.name, branch: sql<string>`(select name from branches b where b.id = ${qcol(E.branchId)})` })
    .from(E).leftJoin(schema.expenseCategories, eq(schema.expenseCategories.id, E.categoryId)).where(cond).orderBy(desc(E.id)).limit(limit).offset(offset);
  const [stats] = await db.select({ total: sql<number>`coalesce(sum(total),0)::float`, tax: sql<number>`coalesce(sum(tax_amount),0)::float`, count: sql<number>`count(*)::int` }).from(E).where(cond);
  res.json({ rows, stats });
}));

r.post('/expenses', can('expenses.manage'), ah(async (req, res) => {
  const b = z.object({ categoryId: z.number({ required_error: 'اختر التصنيف.' }), branchId: z.number(), amount: z.number().positive('أدخل مبلغاً صحيحاً.'), taxable: z.boolean().default(false), vendorName: z.string().nullish(), vendorVat: z.string().nullish(), paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']).default('CASH'), date: z.string().nullish(), notes: z.string().nullish(), recurring: z.enum(['WEEKLY', 'MONTHLY']).nullish() }).parse(req.body);
  const tax = await getSetting('tax');
  const out = await db.transaction(async (tx) => {
    const taxAmount = b.taxable && tax.enabled ? r2(b.amount * tax.rate / 100) : 0;
    const [cat] = await tx.select().from(schema.expenseCategories).where(eq(schema.expenseCategories.id, b.categoryId));
    if (!cat) throw badRequest('تصنيف المصروف غير موجود.');
    const [e] = await tx.insert(schema.expenses).values({ number: await nextNumber(tx, 'expense', 'EXP-'), categoryId: b.categoryId, branchId: b.branchId, amount: b.amount, taxAmount, total: r2(b.amount + taxAmount), vendorName: b.vendorName, vendorVat: b.vendorVat, paymentMethod: b.paymentMethod, date: b.date ? new Date(b.date) : new Date(), notes: b.notes, recurring: b.recurring, userId: req.user!.id }).returning();
    await postEntry(tx, { description: `مصروف ${e.number}: ${cat.name}`, refType: 'expense', refId: e.id, branchId: b.branchId, userId: req.user!.id, date: e.date,
      lines: [cat.accountId ? { accountId: cat.accountId, debit: b.amount } : { key: 'GENERAL_EXP', debit: b.amount }, { key: 'VAT_INPUT', debit: taxAmount }, { key: methodAccount(b.paymentMethod), credit: r2(b.amount + taxAmount) }] });
    await logActivity({ userId: req.user!.id, action: 'expense.create', entity: 'expense', entityId: e.id, summary: `سجّل مصروف ${cat.name} بمبلغ ${e.total.toFixed(2)}` }, tx);
    return e;
  });
  res.status(201).json(out);
}));

export default r;
