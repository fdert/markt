import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { qcol } from '../lib/col.js';
import { db, schema } from '../db/index.js';
import { ah, forbidden, page } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { createInvoice, returnInvoice, collectPayment, invoiceDetails, deleteDraft } from '../services/sales.js';
import { submitToZatca } from '../services/zatca/index.js';

const r = Router();
const I = schema.invoices;

const STATUS_LABEL: Record<string, string> = { DRAFT: 'مسودة', PAID: 'مدفوعة', PARTIAL: 'مدفوعة جزئياً', UNPAID: 'آجلة', RETURNED: 'مرتجعة', PARTIALLY_RETURNED: 'مرتجعة جزئياً', CANCELLED: 'ملغاة' };

function filters(q: Record<string, string>, user: { permissions: string[]; id: number }) {
  const where: SQL[] = [];
  if (q.search) where.push(or(ilike(I.number, `%${q.search}%`), sql`exists (select 1 from customers c where c.id = ${qcol(I.customerId)} and (c.name ilike ${'%' + q.search + '%'} or c.phone ilike ${'%' + q.search + '%'}))`)!);
  if (q.status === 'paid') where.push(and(eq(I.type, 'INVOICE'), eq(I.status, 'PAID'))!);
  if (q.status === 'credit') where.push(and(eq(I.type, 'INVOICE'), sql`${qcol(I.due)} > 0`)!);
  if (q.status === 'drafts') where.push(or(eq(I.status, 'DRAFT'), eq(I.type, 'QUOTE'))!);
  if (q.status === 'returns') where.push(eq(I.type, 'CREDIT_NOTE'));
  if (q.status === 'cancelled') where.push(eq(I.status, 'CANCELLED'));
  if (q.status === 'zatca_pending') where.push(sql`${qcol(I.zatcaStatus)} in ('PENDING','REJECTED')`);
  if (q.userId) where.push(eq(I.userId, Number(q.userId)));
  if (q.branchId) where.push(eq(I.branchId, Number(q.branchId)));
  if (q.channel) where.push(eq(I.channel, q.channel));
  if (q.customerId) where.push(eq(I.customerId, Number(q.customerId)));
  if (q.shiftId) where.push(eq(I.shiftId, Number(q.shiftId)));
  if (q.from) where.push(gte(I.createdAt, new Date(q.from)));
  if (q.to) where.push(lte(I.createdAt, new Date(new Date(q.to).getTime() + 86400000 - 1)));
  if (q.mine === '1' || !user.permissions.includes('invoices.view')) where.push(eq(I.userId, user.id));
  return where.length ? and(...where) : undefined;
}

const listCols = {
  id: I.id, number: I.number, kind: I.kind, type: I.type, status: I.status, channel: I.channel, total: I.total, paid: I.paid, due: I.due,
  taxTotal: I.taxTotal, subtotal: I.subtotal, discount: I.discount, createdAt: I.createdAt, zatcaStatus: I.zatcaStatus, branchId: I.branchId,
  customer: sql<string>`(select name from customers c where c.id = ${qcol(I.customerId)})`, customerId: I.customerId,
  user: sql<string>`(select name from users u where u.id = ${qcol(I.userId)})`,
  paymentMethods: sql<string>`(select string_agg(distinct p.method, ',') from payments p where p.invoice_id = ${qcol(I.id)})`,
  orderType: I.orderType, orderNo: I.orderNo,
};

r.get('/', can('invoices.view', 'pos.use'), ah(async (req, res) => {
  const q = req.query as Record<string, string>; const { limit, offset } = page(q);
  const cond = filters(q, req.user!);
  const rows = await db.select(listCols).from(I).where(cond).orderBy(desc(I.id)).limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(I).where(cond);
  const sumCond = filters({ ...q, status: '' }, req.user!);
  const [summary] = await db.select({
    sales: sql<number>`coalesce(sum(total) filter (where type = 'INVOICE' and status not in ('DRAFT','CANCELLED')),0)::float`,
    returns: sql<number>`coalesce(sum(total) filter (where type = 'CREDIT_NOTE'),0)::float`,
    count: sql<number>`count(*) filter (where type = 'INVOICE' and status not in ('DRAFT','CANCELLED'))::int`,
    returnsCount: sql<number>`count(*) filter (where type = 'CREDIT_NOTE')::int`,
    due: sql<number>`coalesce(sum(due) filter (where type = 'INVOICE' and status <> 'DRAFT'),0)::float`,
    tax: sql<number>`coalesce(sum(case when type = 'INVOICE' and status not in ('DRAFT','CANCELLED') then tax_total when type = 'CREDIT_NOTE' then -tax_total else 0 end),0)::float`,
  }).from(I).where(sumCond);
  res.json({ rows, total, summary: { ...summary, net: summary.sales - summary.returns } });
}));

r.get('/export', can('invoices.view'), ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const rows = await db.select(listCols).from(I).where(filters(q, req.user!)).orderBy(desc(I.id)).limit(20000);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('الفواتير', { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: 'رقم الفاتورة', key: 'number', width: 18 }, { header: 'التاريخ', key: 'date', width: 20 }, { header: 'العميل', key: 'customer', width: 24 },
    { header: 'النوع', key: 'kind', width: 12 }, { header: 'الحالة', key: 'status', width: 14 }, { header: 'قبل الضريبة', key: 'subtotal', width: 14 },
    { header: 'الضريبة', key: 'taxTotal', width: 12 }, { header: 'الإجمالي', key: 'total', width: 14 }, { header: 'المدفوع', key: 'paid', width: 14 },
    { header: 'المتبقي', key: 'due', width: 12 }, { header: 'الموظف', key: 'user', width: 18 },
  ];
  rows.forEach((x) => ws.addRow({ ...x, date: new Date(x.createdAt).toLocaleString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh' }), kind: x.type === 'CREDIT_NOTE' ? 'إشعار دائن' : x.kind === 'STANDARD' ? 'ضريبية' : 'مبسطة', status: STATUS_LABEL[x.status] ?? x.status }));
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="invoices.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

const lineSchema = z.object({ productId: z.number().nullish(), unitId: z.number().nullish(), qty: z.number().positive('الكمية يجب أن تكون أكبر من صفر.'), price: z.number().min(0).nullish(), name: z.string().optional(), taxable: z.boolean().optional(), lineDiscount: z.number().min(0).optional() });
const createSchema = z.object({
  branchId: z.number(), customerId: z.number().nullish(), kind: z.enum(['SIMPLIFIED', 'STANDARD']).default('SIMPLIFIED'),
  channel: z.enum(['POS', 'ONLINE', 'ORDER']).default('POS'), lines: z.array(lineSchema).min(1, 'السلة فارغة.'),
  couponCode: z.string().nullish(), discount: z.object({ type: z.enum(['AMOUNT', 'PERCENT']), value: z.number().min(0) }).nullish(),
  loyaltyPoints: z.number().min(0).optional(), shipping: z.number().min(0).optional(), isEmployeeSale: z.boolean().optional(),
  payments: z.array(z.object({ method: z.string().min(2), amount: z.number().min(0), reference: z.string().optional() })).default([]),
  orderType: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']).nullish(), tableId: z.number().nullish(), orderNo: z.number().nullish(), priceListId: z.number().nullish(),
  notes: z.string().nullish(), privateNote: z.string().nullish(), supplyDate: z.string().nullish(), asDraft: z.boolean().optional(), asQuote: z.boolean().optional(),
});

r.post('/', can('pos.use'), ah(async (req, res) => {
  const b = createSchema.parse(req.body);
  if ((b.lines.some((l) => l.price != null && l.productId)) && !req.user!.permissions.includes('pos.price_override')) {
    b.lines.forEach((l) => { if (l.productId) l.price = undefined; });
  }
  if (b.discount?.value && !req.user!.permissions.includes('pos.discount')) throw forbidden('لا تملك صلاحية إضافة خصم يدوي.');
  const out = await createInvoice(b as never, req.user!);
  res.status(201).json({ ...(await invoiceDetails(out.invoice.id)), change: out.change });
}));

r.get('/:id', can('invoices.view', 'pos.use'), ah(async (req, res) => res.json(await invoiceDetails(Number(req.params.id)))));

r.get('/:id/xml', can('invoices.view'), ah(async (req, res) => {
  const [inv] = await db.select({ xml: I.xml, number: I.number }).from(I).where(eq(I.id, Number(req.params.id)));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${inv?.number ?? 'invoice'}.xml"`);
  res.send(inv?.xml ?? '');
}));

r.post('/:id/return', can('invoices.return'), ah(async (req, res) => {
  const b = z.object({ items: z.array(z.object({ itemId: z.number(), qty: z.number().min(0) })), refundMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT', 'WALLET']), reason: z.string().optional(), restock: z.boolean().default(true) }).parse(req.body);
  const out = await returnInvoice(Number(req.params.id), b, req.user!);
  res.status(201).json(await invoiceDetails(out.creditNote.id));
}));

r.post('/:id/collect', can('invoices.collect'), ah(async (req, res) => {
  const b = z.object({ amount: z.number().positive('أدخل مبلغاً صحيحاً.'), method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']), note: z.string().optional() }).parse(req.body);
  res.json(await collectPayment(Number(req.params.id), b, req.user!));
}));

r.post('/:id/zatca-retry', can('invoices.view'), ah(async (req, res) => res.json(await submitToZatca(Number(req.params.id)) ?? { message: 'لا تحتاج الفاتورة إلى إرسال.' })));

r.delete('/:id', can('invoices.cancel'), ah(async (req, res) => { await deleteDraft(Number(req.params.id)); res.json({ message: 'تم الحذف.' }); }));

export default r;
