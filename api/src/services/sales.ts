// إصدار فواتير البيع والمرتجعات وتحصيل المستحقات
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, type Tx } from '../db/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/http.js';
import { nextNumber } from '../lib/counter.js';
import { r2, r3 } from '../lib/money.js';
import { getSetting } from '../lib/settings.js';
import { logActivity } from '../lib/activity.js';
import { computeCart, type CartInput } from './pricing.js';
import { moveForSale, isStockTracked, stockOf } from './inventory.js';
import { postEntry, methodAccount } from './accounting.js';
import { stampInvoice, submitToZatca } from './zatca/index.js';
import { isValidVat } from './zatca/qr.js';

export interface PaymentInput { method: string; amount: number; reference?: string }

export interface CreateInvoiceInput extends CartInput {
  kind?: 'SIMPLIFIED' | 'STANDARD';
  payments: PaymentInput[];
  notes?: string; privateNote?: string; supplyDate?: string | null;
  asDraft?: boolean; asQuote?: boolean;
  shiftId?: number | null;
  orderType?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | null;
  tableId?: number | null;
  orderNo?: number | null;
}

/** رقم الطلب اليومي لكل فرع (يبدأ من 1 كل يوم بتوقيت الرياض) */
export async function nextOrderNo(tx: Tx, branchId: number) {
  const day = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  const n = await nextNumber(tx, `order-${branchId}-${day}`, '', 1);
  return Number(n);
}

async function openShiftFor(tx: Tx, userId: number, branchId: number) {
  const [s] = await tx.select().from(schema.shifts).where(and(eq(schema.shifts.userId, userId), eq(schema.shifts.branchId, branchId), eq(schema.shifts.status, 'OPEN')));
  return s ?? null;
}

export async function createInvoice(input: CreateInvoiceInput, user: AuthUser) {
  const result = await db.transaction(async (tx) => {
    const pos = await getSetting('pos', tx);
    const [branch] = await tx.select().from(schema.branches).where(eq(schema.branches.id, input.branchId));
    if (!branch) throw notFound('الفرع غير موجود.');
    if (branch.type === 'WAREHOUSE') throw badRequest('لا يمكن البيع من مستودع. اختر فرع بيع.');

    let customer: typeof schema.customers.$inferSelect | null = null;
    if (input.customerId) {
      [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId));
      if (!customer) throw notFound('العميل غير موجود.');
    }
    if (pos.requireCustomer && !customer && input.channel === 'POS') throw badRequest('اختر العميل قبل إصدار الفاتورة.');
    const kind = input.kind ?? 'SIMPLIFIED';
    if (kind === 'STANDARD') {
      if (!customer) throw badRequest('الفاتورة الضريبية تتطلب بيانات العميل.');
      if (customer.vatNumber && !isValidVat(customer.vatNumber)) throw badRequest('الرقم الضريبي للعميل غير صحيح: 15 رقماً يبدأ وينتهي بالرقم 3.');
    }

    const cart = await computeCart(tx, input, { maxDiscountPercent: user.role === 'OWNER' ? 100 : user.maxDiscount ?? 100 });
    const isDraft = !!(input.asDraft || input.asQuote);

    // المدفوعات
    const payments = (input.payments ?? []).filter((p) => p.amount > 0);
    // التحقق من طرق الدفع المفعّلة
    const methods = await tx.select().from(schema.paymentMethods);
    for (const p of payments) {
      const m = methods.find((x) => x.code === p.method);
      if (!m || !m.active) throw badRequest(`طريقة الدفع «${m?.name ?? p.method}» غير مفعّلة.`);
    }
    if (!pos.multiPayment && payments.filter((p) => p.method !== 'CREDIT').length > 1) throw badRequest('الدفع المتعدد غير مفعّل.');
    const walletPay = r2(payments.filter((p) => p.method === 'WALLET').reduce((s2, p) => s2 + p.amount, 0));
    if (walletPay > 0) {
      if (!customer) throw badRequest('الدفع من المحفظة يتطلب اختيار العميل.');
      if (customer.walletBalance < walletPay - 0.001) throw badRequest(`رصيد محفظة العميل غير كافٍ (${customer.walletBalance.toFixed(2)}).`);
    }
    const nonCredit = payments.filter((p) => p.method !== 'CREDIT');
    const tendered = r2(nonCredit.reduce((s, p) => s + p.amount, 0));
    let paid = Math.min(tendered, cart.total);
    const change = r2(Math.max(0, tendered - cart.total));
    if (!isDraft) {
      const due = r2(cart.total - paid);
      if (due > 0 && !customer) throw badRequest('البيع الآجل يتطلب اختيار العميل.');
      if (change > 0 && !nonCredit.some((p) => p.method === 'CASH')) throw badRequest('المبلغ المدفوع أكبر من الإجمالي.');
    }
    paid = r2(paid);
    const due = isDraft ? cart.total : r2(cart.total - paid);
    const status = isDraft ? 'DRAFT' : due <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';

    // التحقق من المخزون
    if (!isDraft && !pos.allowNegativeStock) {
      for (const l of cart.lines) {
        if (!l.productId) continue;
        const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, l.productId));
        if (isStockTracked(p)) {
          const available = await stockOf(tx, p.id, branch.id);
          if (available < l.qty * l.unitFactor) throw badRequest(`الكمية المتاحة من «${p.name}» غير كافية (${available}).`);
        }
      }
    }

    const shift = isDraft ? null : input.shiftId ? (await tx.select().from(schema.shifts).where(eq(schema.shifts.id, input.shiftId)))[0] ?? null : await openShiftFor(tx, user.id, branch.id);
    const number = input.asQuote ? await nextNumber(tx, 'quote', 'QT-') : isDraft ? await nextNumber(tx, 'draft', 'DR-') : await nextNumber(tx, `inv-${branch.id}`, `INV-${branch.id}-`);

    const orderNo = isDraft ? null : input.orderNo ?? (pos.showOrderNumber ? await nextOrderNo(tx, branch.id) : null);
    const [inv] = await tx.insert(schema.invoices).values({
      number, uuid: randomUUID(), kind, type: input.asQuote ? 'QUOTE' : 'INVOICE', status, channel: input.channel ?? 'POS',
      branchId: branch.id, userId: user.id, customerId: customer?.id ?? null, shiftId: shift?.id ?? null,
      subtotal: cart.subtotal, discount: cart.discount, shipping: input.shipping ?? 0, taxTotal: cart.taxTotal, total: cart.total,
      paid, due, costTotal: cart.costTotal, couponCode: cart.couponCode, offerDiscount: cart.offerDiscount, loyaltyUsed: cart.loyaltyDiscount,
      isEmployeeSale: !!input.isEmployeeSale, notes: input.notes, privateNote: input.privateNote,
      orderType: input.orderType ?? null, tableId: input.tableId ?? null, priceListId: input.priceListId ?? null, orderNo, rounding: cart.rounding,
      supplyDate: input.supplyDate ? new Date(input.supplyDate) : null,
    }).returning();

    const items = await tx.insert(schema.invoiceItems).values(cart.lines.map((l) => ({
      invoiceId: inv.id, productId: l.productId, unitId: l.unitId, unitName: l.unitName, unitFactor: l.unitFactor, name: l.name,
      barcode: l.barcode, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate, taxAmount: l.taxAmount,
      netAmount: l.netAmount, total: l.total, unitCost: l.unitCost,
    }))).returning();

    if (isDraft) return { invoice: inv, items, change: 0 };

    // حركة المخزون وتكلفة البضاعة
    let costTotal = 0;
    for (const it of items) {
      if (!it.productId) continue;
      const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, it.productId));
      const unitCost = await moveForSale(tx, p, r3(it.qty * it.unitFactor), branch.id, 'SALE', { refType: 'invoice', refId: inv.id, userId: user.id });
      const lineCost = r2(unitCost * it.qty * it.unitFactor);
      costTotal += lineCost;
      if (p.isComposite) await tx.update(schema.invoiceItems).set({ unitCost: r2(unitCost * it.unitFactor) }).where(eq(schema.invoiceItems.id, it.id));
    }
    costTotal = r2(costTotal);

    // المدفوعات (يُسجَّل النقد بعد طرح الباقي)
    let remainingChange = change;
    const payRows = payments.filter((p) => p.method !== 'CREDIT').map((p) => {
      let amount = p.amount;
      if (p.method === 'CASH' && remainingChange > 0) { const d = Math.min(remainingChange, amount); amount -= d; remainingChange -= d; }
      return { invoiceId: inv.id, shiftId: shift?.id ?? null, method: p.method, amount: r2(amount), reference: p.reference, userId: user.id };
    }).filter((p) => p.amount > 0);
    if (cart.loyaltyDiscount > 0) payRows.push({ invoiceId: inv.id, shiftId: shift?.id ?? null, method: 'LOYALTY' as never, amount: 0, reference: `${cart.loyaltyPointsUsed} نقطة`, userId: user.id });
    if (payRows.length) await tx.insert(schema.payments).values(payRows);

    // خصم المحفظة
    if (walletPay > 0 && customer) {
      const balanceAfter = r2(customer.walletBalance - walletPay);
      await tx.update(schema.customers).set({ walletBalance: balanceAfter }).where(eq(schema.customers.id, customer.id));
      await tx.insert(schema.walletTransactions).values({ customerId: customer.id, amount: -walletPay, balanceAfter, type: 'PAYMENT', method: 'WALLET', invoiceId: inv.id, userId: user.id, note: `دفع الفاتورة ${inv.number}` });
    }

    // الكوبون ونقاط الولاء
    if (cart.couponCode) {
      await tx.update(schema.coupons).set({ usedCount: sql`${schema.coupons.usedCount} + 1`, totalGranted: sql`${schema.coupons.totalGranted} + ${cart.couponDiscount}` })
        .where(eq(schema.coupons.code, cart.couponCode));
    }
    if (customer && pos.loyalty.enabled) {
      const earned = r2(Math.floor(cart.total) * pos.loyalty.pointsPerRiyal);
      await tx.update(schema.customers).set({ loyaltyPoints: sql`${schema.customers.loyaltyPoints} + ${earned} - ${cart.loyaltyPointsUsed}` })
        .where(eq(schema.customers.id, customer.id));
    }

    // القيد المحاسبي
    await postEntry(tx, {
      description: `فاتورة مبيعات ${inv.number}`, refType: 'invoice', refId: inv.id, branchId: branch.id, userId: user.id,
      lines: [
        ...payRows.filter((p) => p.amount > 0).map((p) => ({ key: methodAccount(p.method), debit: p.amount })),
        ...(due > 0 ? [{ key: 'AR', debit: due }] : []),
        { key: 'SALES', credit: cart.subtotal },
        { key: 'VAT_OUTPUT', credit: cart.taxTotal },
        ...(costTotal > 0 ? [{ key: 'COGS', debit: costTotal }, { key: 'INVENTORY', credit: costTotal }] : []),
      ],
    });

    const updated = { ...inv, costTotal };
    await tx.update(schema.invoices).set({ costTotal }).where(eq(schema.invoices.id, inv.id));
    const payMeans = payRows[0]?.method ?? (due > 0 ? 'CREDIT' : 'CASH');
    await stampInvoice(tx, updated, items.map((it, i) => ({ id: i + 1, name: it.name, qty: it.qty, unitPrice: it.unitPrice, discount: it.discount, netAmount: it.netAmount, taxRate: it.taxRate, taxAmount: it.taxAmount, total: it.total })), branch, kind === 'STANDARD' ? customer : customer?.vatNumber ? customer : null, payMeans);
    await logActivity({ userId: user.id, action: 'invoice.create', entity: 'invoice', entityId: inv.id, summary: `أصدر الفاتورة ${inv.number} بمبلغ ${cart.total.toFixed(2)}` }, tx);
    return { invoice: updated, items, change };
  });
  if (result.invoice.status !== 'DRAFT') submitToZatca(result.invoice.id).catch(() => undefined);
  return result;
}

export interface ReturnInput { items: Array<{ itemId: number; qty: number }>; refundMethod: string; reason?: string; restock?: boolean }

export async function returnInvoice(invoiceId: number, input: ReturnInput, user: AuthUser) {
  const result = await db.transaction(async (tx) => {
    const [orig] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    if (!orig || orig.type !== 'INVOICE' || orig.status === 'DRAFT') throw notFound('الفاتورة غير موجودة أو غير قابلة للإرجاع.');
    if (orig.status === 'CANCELLED' || orig.status === 'RETURNED') throw badRequest('هذه الفاتورة مرتجعة أو ملغاة بالكامل.');
    const origItems = await tx.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, orig.id));
    const [branch] = await tx.select().from(schema.branches).where(eq(schema.branches.id, orig.branchId));

    const lines = input.items.filter((x) => x.qty > 0).map((x) => {
      const it = origItems.find((o) => o.id === x.itemId);
      if (!it) throw badRequest('بند غير موجود في الفاتورة.');
      if (x.qty > it.qty - it.returnedQty + 0.0001) throw badRequest(`الكمية المرتجعة من «${it.name}» أكبر من المتبقي.`);
      const ratio = x.qty / it.qty;
      return { it, qty: x.qty, net: r2(it.netAmount * ratio), tax: r2(it.taxAmount * ratio), disc: r2(it.discount * ratio) };
    });
    if (!lines.length) throw badRequest('حدد بنداً واحداً على الأقل للإرجاع.');
    for (const l of lines) {
      if (l.it.productId) {
        const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, l.it.productId));
        if (p?.nonReturnable) throw badRequest(`المنتج «${p.name}» غير قابل للإرجاع.`);
      }
    }
    const subtotal = r2(lines.reduce((s, l) => s + l.net, 0));
    const taxTotal = r2(lines.reduce((s, l) => s + l.tax, 0));
    const total = r2(subtotal + taxTotal);
    const shift = await openShiftFor(tx, user.id, orig.branchId);

    const [cn] = await tx.insert(schema.invoices).values({
      number: await nextNumber(tx, `cn-${branch.id}`, `CN-${branch.id}-`), uuid: randomUUID(), kind: orig.kind, type: 'CREDIT_NOTE',
      status: 'PAID', channel: orig.channel, branchId: orig.branchId, userId: user.id, customerId: orig.customerId, shiftId: shift?.id ?? null,
      originalId: orig.id, subtotal, discount: r2(lines.reduce((s, l) => s + l.disc, 0)), taxTotal, total, paid: total, due: 0,
      returnReason: input.reason ?? 'إرجاع بضاعة',
    }).returning();
    const cnItems = await tx.insert(schema.invoiceItems).values(lines.map((l) => ({
      invoiceId: cn.id, productId: l.it.productId, unitId: l.it.unitId, unitName: l.it.unitName, unitFactor: l.it.unitFactor, name: l.it.name,
      barcode: l.it.barcode, qty: l.qty, unitPrice: l.it.unitPrice, discount: l.disc, taxRate: l.it.taxRate, taxAmount: l.tax,
      netAmount: l.net, total: r2(l.net + l.tax), unitCost: l.it.unitCost,
    }))).returning();

    let costTotal = 0;
    for (const l of lines) {
      await tx.update(schema.invoiceItems).set({ returnedQty: sql`${schema.invoiceItems.returnedQty} + ${l.qty}` }).where(eq(schema.invoiceItems.id, l.it.id));
      costTotal += l.it.unitCost * l.qty;
      if (l.it.productId && input.restock !== false) {
        const [p] = await tx.select().from(schema.products).where(eq(schema.products.id, l.it.productId));
        await moveForSale(tx, p, r3(l.qty * l.it.unitFactor), orig.branchId, 'RETURN', { refType: 'invoice', refId: cn.id, userId: user.id });
      }
    }
    costTotal = r2(costTotal);
    const refundMethod = input.refundMethod === 'CREDIT' || orig.due > 0 ? (orig.due >= total ? 'CREDIT' : input.refundMethod) : input.refundMethod;
    if (refundMethod === 'WALLET') {
      if (!orig.customerId) throw badRequest('الاسترداد للمحفظة يتطلب عميلاً على الفاتورة.');
      const [cu] = await tx.select().from(schema.customers).where(eq(schema.customers.id, orig.customerId));
      const balanceAfter = r2(cu.walletBalance + total);
      await tx.update(schema.customers).set({ walletBalance: balanceAfter }).where(eq(schema.customers.id, cu.id));
      await tx.insert(schema.walletTransactions).values({ customerId: cu.id, amount: total, balanceAfter, type: 'REFUND', method: 'WALLET', invoiceId: cn.id, userId: user.id, note: `استرداد ${cn.number}` });
    }
    if (refundMethod !== 'CREDIT') await tx.insert(schema.payments).values({ invoiceId: cn.id, shiftId: shift?.id ?? null, method: refundMethod, amount: -total, userId: user.id, note: 'استرداد' });

    // تحديث حالة الفاتورة الأصلية والمستحق
    const remaining = await tx.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, orig.id));
    const fully = remaining.every((it) => it.returnedQty >= it.qty - 0.0001);
    const newDue = refundMethod === 'CREDIT' ? r2(Math.max(0, orig.due - total)) : orig.due;
    await tx.update(schema.invoices).set({ status: fully ? 'RETURNED' : 'PARTIALLY_RETURNED', due: newDue }).where(eq(schema.invoices.id, orig.id));

    await postEntry(tx, {
      description: `إشعار دائن ${cn.number} للفاتورة ${orig.number}`, refType: 'invoice', refId: cn.id, branchId: orig.branchId, userId: user.id,
      lines: [
        { key: 'SALES_RETURNS', debit: subtotal }, { key: 'VAT_OUTPUT', debit: taxTotal },
        { key: methodAccount(refundMethod), credit: total },
        ...(costTotal > 0 && input.restock !== false ? [{ key: 'INVENTORY', debit: costTotal }, { key: 'COGS', credit: costTotal }] : []),
      ],
    });
    let customer = null;
    if (orig.customerId) [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, orig.customerId));
    await stampInvoice(tx, cn, cnItems.map((it, i) => ({ id: i + 1, name: it.name, qty: it.qty, unitPrice: it.unitPrice, discount: it.discount, netAmount: it.netAmount, taxRate: it.taxRate, taxAmount: it.taxAmount, total: it.total })), branch, orig.kind === 'STANDARD' ? customer : null, refundMethod, orig.number);
    await logActivity({ userId: user.id, action: 'invoice.return', entity: 'invoice', entityId: cn.id, summary: `أرجع ${total.toFixed(2)} من الفاتورة ${orig.number}` }, tx);
    return { creditNote: cn, items: cnItems };
  });
  submitToZatca(result.creditNote.id).catch(() => undefined);
  return result;
}

/** تحصيل مستحقات فاتورة آجلة (سند قبض) */
export async function collectPayment(invoiceId: number, p: { amount: number; method: 'CASH' | 'CARD' | 'BANK_TRANSFER'; note?: string }, user: AuthUser) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    if (!inv || inv.due <= 0) throw badRequest('لا يوجد مبلغ مستحق على هذه الفاتورة.');
    const amount = r2(Math.min(p.amount, inv.due));
    if (amount <= 0) throw badRequest('أدخل مبلغاً صحيحاً.');
    const shift = await openShiftFor(tx, user.id, inv.branchId);
    await tx.insert(schema.payments).values({ invoiceId: inv.id, shiftId: shift?.id ?? null, method: p.method, amount, note: p.note ?? 'تحصيل مستحق', userId: user.id });
    const due = r2(inv.due - amount); const paid = r2(inv.paid + amount);
    await tx.update(schema.invoices).set({ due, paid, status: inv.status === 'PARTIALLY_RETURNED' ? inv.status : due <= 0 ? 'PAID' : 'PARTIAL' }).where(eq(schema.invoices.id, inv.id));
    await postEntry(tx, { description: `سند قبض للفاتورة ${inv.number}`, refType: 'receipt', refId: inv.id, branchId: inv.branchId, userId: user.id, lines: [{ key: methodAccount(p.method), debit: amount }, { key: 'AR', credit: amount }] });
    await logActivity({ userId: user.id, action: 'invoice.collect', entity: 'invoice', entityId: inv.id, summary: `حصّل ${amount.toFixed(2)} من الفاتورة ${inv.number}` }, tx);
    return { amount, due };
  });
}

export async function invoiceDetails(id: number) {
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!inv) throw notFound('الفاتورة غير موجودة.');
  const [items, pays, customer, branch, user, returns] = await Promise.all([
    db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, id)),
    db.select().from(schema.payments).where(eq(schema.payments.invoiceId, id)),
    inv.customerId ? db.select().from(schema.customers).where(eq(schema.customers.id, inv.customerId)).then((r) => r[0]) : null,
    db.select().from(schema.branches).where(eq(schema.branches.id, inv.branchId)).then((r) => r[0]),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, inv.userId)).then((r) => r[0]),
    db.select({ id: schema.invoices.id, number: schema.invoices.number, total: schema.invoices.total, createdAt: schema.invoices.createdAt }).from(schema.invoices).where(eq(schema.invoices.originalId, id)),
  ]);
  const tableName = inv.tableId ? (await db.select({ name: schema.restaurantTables.name }).from(schema.restaurantTables).where(eq(schema.restaurantTables.id, inv.tableId)))[0]?.name ?? null : null;
  const original = inv.originalId ? (await db.select({ id: schema.invoices.id, number: schema.invoices.number }).from(schema.invoices).where(eq(schema.invoices.id, inv.originalId)))[0] : null;
  const { zatcaPrivateKey: _k, complianceSecret: _s, productionSecret: _ps, ...safeBranch } = branch;
  return { ...inv, xml: undefined, items, payments: pays, customer, branch: safeBranch, user, returns, original, tableName };
}

export async function deleteDraft(id: number) {
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!inv || !['DRAFT'].includes(inv.status)) throw badRequest('يمكن حذف المسودات وعروض الأسعار فقط.');
  await db.delete(schema.invoices).where(eq(schema.invoices.id, id));
}

export const _internal = { inArray };
