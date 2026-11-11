// محرّك التسعير: الوحدات، العروض، الكوبونات، الخصم اليدوي، نقاط الولاء، وضريبة القيمة المضافة
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import { badRequest } from '../lib/http.js';
import { r2, r3, r4 } from '../lib/money.js';

export interface CartLineInput {
  productId?: number | null;
  unitId?: number | null;
  qty: number;
  price?: number | null; // سعر مُدخل يدوياً (للبند اليدوي أو تعديل السعر)
  name?: string; // للبند اليدوي
  taxable?: boolean; // للبند اليدوي
  lineDiscount?: number; // خصم على البند (شامل الضريبة)
}

export interface CartInput {
  lines: CartLineInput[];
  customerId?: number | null;
  couponCode?: string | null;
  discount?: { type: 'AMOUNT' | 'PERCENT'; value: number } | null;
  loyaltyPoints?: number;
  shipping?: number;
  channel?: 'POS' | 'ONLINE' | 'ORDER';
  isEmployeeSale?: boolean;
  branchId: number;
}

export interface ComputedLine {
  productId: number | null; unitId: number | null; unitName: string | null; unitFactor: number;
  name: string; barcode: string | null; qty: number; unitPrice: number; discount: number;
  taxRate: number; taxAmount: number; netAmount: number; total: number; unitCost: number;
  grossIncl: number; offerDiscount: number; offerName?: string; nonReturnable: boolean;
}

export interface ComputedCart {
  lines: ComputedLine[];
  subtotal: number; discount: number; offerDiscount: number; couponDiscount: number; manualDiscount: number;
  loyaltyDiscount: number; loyaltyPointsUsed: number; taxTotal: number; total: number; costTotal: number;
  couponCode: string | null; appliedOffers: string[]; warnings: string[];
}

type Product = typeof schema.products.$inferSelect;
type Offer = typeof schema.offers.$inferSelect;

export async function activeOffers(tx: Tx, channel: string) {
  const now = new Date();
  const rows = await tx.select().from(schema.offers).where(eq(schema.offers.active, true));
  return rows.filter((o) => o.startsAt <= now && (!o.endsAt || o.endsAt >= now) && (o.channel === 'ALL' || (o.channel === 'POS' ? channel === 'POS' : channel !== 'POS')));
}

function offerApplies(o: Offer, p: Product | undefined) {
  if (!p) return false;
  if (o.excludedIds.includes(p.id)) return false;
  if (o.scope === 'ALL') return true;
  if (o.scope === 'PRODUCTS') return o.productIds.includes(p.id);
  if (o.scope === 'CATEGORIES') return p.categoryId != null && o.categoryIds.includes(p.categoryId);
  return false;
}

export async function computeCart(tx: Tx, input: CartInput, opts: { maxDiscountPercent?: number } = {}): Promise<ComputedCart> {
  const tax = await getSetting('tax', tx);
  const pos = await getSetting('pos', tx);
  const channel = input.channel ?? 'POS';
  const warnings: string[] = [];
  if (!input.lines.length) throw badRequest('السلة فارغة. أضف منتجاً واحداً على الأقل.');

  const productIds = [...new Set(input.lines.map((l) => l.productId).filter(Boolean))] as number[];
  const prods = productIds.length ? await tx.select().from(schema.products).where(inArray(schema.products.id, productIds)) : [];
  const pMap = new Map(prods.map((p) => [p.id, p]));
  const unitIds = input.lines.map((l) => l.unitId).filter(Boolean) as number[];
  const units = unitIds.length ? await tx.select().from(schema.productUnits).where(inArray(schema.productUnits.id, unitIds)) : [];
  const uMap = new Map(units.map((u) => [u.id, u]));
  const rateOf = (taxable: boolean) => (tax.enabled && taxable ? tax.rate : 0);

  // 1) تجهيز البنود بالسعر الشامل للضريبة
  type Work = ComputedLine & { product?: Product; rate: number; unitNetPrice: number; extraDiscIncl: number };
  const work: Work[] = input.lines.map((l) => {
    if (l.qty <= 0) throw badRequest('الكمية يجب أن تكون أكبر من صفر.');
    const p = l.productId ? pMap.get(l.productId) : undefined;
    if (l.productId && !p) throw badRequest('أحد المنتجات غير موجود.');
    if (p && !p.active) throw badRequest(`المنتج «${p.name}» غير نشط.`);
    if (p?.expiryDate && p.expiryDate < new Date() && !pos.allowExpiredSale) throw badRequest(`المنتج «${p.name}» منتهي الصلاحية. البيع غير مسموح.`);
    const u = l.unitId ? uMap.get(l.unitId) : undefined;
    const rate = rateOf(p ? p.taxable : l.taxable ?? true);
    const taxIncluded = p ? p.taxIncluded : true;
    let price = l.price ?? (u ? u.price : p?.isWeighted && p.pricePerWeight ? p.pricePerWeight : p?.price ?? 0);
    const factor = u ? u.factor : 1;
    let unitCost = p ? (p.avgCost || p.cost) * factor : 0;
    // بيع للموظف بسعر التكلفة (المادة 38): يُحسب السعر بالتكلفة
    if (input.isEmployeeSale && p) price = taxIncluded ? r4(unitCost * (1 + rate / 100)) : unitCost;
    const unitNetPrice = taxIncluded ? price / (1 + rate / 100) : price;
    const grossIncl = r2(unitNetPrice * l.qty * (1 + rate / 100));
    return {
      product: p, rate, unitNetPrice, extraDiscIncl: Math.min(l.lineDiscount ?? 0, grossIncl),
      productId: p?.id ?? null, unitId: u?.id ?? null, unitName: u?.name ?? p?.unitName ?? null, unitFactor: factor,
      name: u && p ? `${p.name} - ${u.name}` : p?.name ?? l.name ?? 'بند يدوي', barcode: u?.barcode ?? p?.barcode ?? null,
      qty: r3(l.qty), unitPrice: r4(unitNetPrice), discount: 0, taxRate: rate, taxAmount: 0, netAmount: 0, total: 0,
      unitCost: r4(unitCost), grossIncl, offerDiscount: 0, nonReturnable: p?.nonReturnable ?? false,
    };
  });

  // 2) العروض والتخفيضات
  const appliedOffers = new Set<string>();
  const noCouponLines = new Set<Work>();
  if (!input.isEmployeeSale) {
    const offers = await activeOffers(tx, channel);
    for (const o of offers) {
      const eligible = work.filter((w) => offerApplies(o, w.product));
      if (!eligible.length) continue;
      const unitGross = (w: Work) => w.grossIncl / w.qty;
      if (o.type === 'PERCENT' || o.type === 'AMOUNT') {
        for (const w of eligible) {
          if (w.offerDiscount > 0) continue;
          const d = o.type === 'PERCENT' ? w.grossIncl * (o.value / 100) : Math.min(o.value * w.qty, w.grossIncl);
          if (o.type === 'AMOUNT' && unitGross(w) <= o.value) continue;
          w.offerDiscount = r2(d); w.offerName = o.name; appliedOffers.add(o.name);
          if (!o.stackCoupons) noCouponLines.add(w);
        }
      } else if (o.type === 'BXGY' && o.buyQty && o.getQty) {
        for (const w of eligible) {
          const free = Math.floor(w.qty / (o.buyQty + o.getQty)) * o.getQty;
          if (free > 0) { w.offerDiscount = r2(w.offerDiscount + free * unitGross(w)); w.offerName = o.name; appliedOffers.add(o.name); if (!o.stackCoupons) noCouponLines.add(w); }
        }
      } else if (o.type === 'BUNDLE' && o.buyQty && o.getQty) {
        const pieces: Array<{ w: Work; price: number }> = [];
        for (const w of eligible) for (let k = 0; k < Math.floor(w.qty); k++) pieces.push({ w, price: unitGross(w) });
        pieces.sort((x, y) => y.price - x.price);
        const group = o.buyQty + o.getQty;
        for (let g = 0; g + group <= pieces.length; g += group) {
          for (const pc of pieces.slice(g + o.buyQty, g + group)) {
            pc.w.offerDiscount = r2(pc.w.offerDiscount + pc.price); pc.w.offerName = o.name; appliedOffers.add(o.name);
            if (!o.stackCoupons) noCouponLines.add(pc.w);
          }
        }
      }
    }
  }
  for (const w of work) w.offerDiscount = r2(Math.min(w.offerDiscount + w.extraDiscIncl, w.grossIncl));

  const afterOffers = (w: Work) => w.grossIncl - w.offerDiscount;
  const baseTotal = r2(work.reduce((s, w) => s + afterOffers(w), 0));

  // 3) الكوبون
  let couponDiscount = 0; let couponCode: string | null = null;
  if (input.couponCode && !input.isEmployeeSale) {
    if (channel === 'POS' && !pos.allowCoupons) throw badRequest('الكوبونات غير مفعّلة في نقطة البيع.');
    const code = input.couponCode.trim().toUpperCase();
    const [c] = await tx.select().from(schema.coupons).where(sql`upper(${schema.coupons.code}) = ${code}`);
    const now = new Date();
    if (!c || !c.active) throw badRequest('كود الكوبون غير صحيح أو موقوف.');
    if (c.startsAt > now) throw badRequest('الكوبون لم يبدأ بعد.');
    if (c.endsAt < now) throw badRequest('انتهت صلاحية الكوبون.');
    if (c.channel !== 'ALL' && c.channel !== (channel === 'POS' ? 'POS' : 'ONLINE')) throw badRequest('الكوبون لا يعمل في هذه القناة.');
    if (c.usageLimit != null && c.usedCount >= c.usageLimit) throw badRequest('استُنفد الكوبون.');
    if (c.customerId && c.customerId !== input.customerId) throw badRequest('الكوبون مخصص لعميل آخر.');
    if (c.perCustomer && input.customerId) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.invoices)
        .where(and(eq(schema.invoices.customerId, input.customerId), eq(schema.invoices.couponCode, c.code), eq(schema.invoices.type, 'INVOICE')));
      if (n >= c.perCustomer) throw badRequest('استخدم العميل الكوبون بالحد المسموح.');
    }
    const couponBase = r2(work.filter((w) => !noCouponLines.has(w)).reduce((s, w) => s + afterOffers(w), 0));
    if (c.minOrder && couponBase < c.minOrder) throw badRequest(`الحد الأدنى للطلب لاستخدام الكوبون ${c.minOrder.toFixed(2)}.`);
    couponDiscount = c.type === 'PERCENT' ? couponBase * (c.value / 100) : c.value;
    if (c.maxDiscount) couponDiscount = Math.min(couponDiscount, c.maxDiscount);
    couponDiscount = r2(Math.min(couponDiscount, couponBase));
    couponCode = c.code;
  }

  // 4) الخصم اليدوي
  let manualDiscount = 0;
  if (input.discount && input.discount.value > 0) {
    if (input.isEmployeeSale) throw badRequest('بيع الموظف لا يجتمع مع خصم أو كوبون أو نقاط.');
    if (!pos.allowManualDiscount && channel === 'POS') throw badRequest('الخصم اليدوي غير مسموح.');
    const remaining = baseTotal - couponDiscount;
    manualDiscount = input.discount.type === 'PERCENT' ? remaining * (input.discount.value / 100) : input.discount.value;
    manualDiscount = r2(Math.min(manualDiscount, remaining));
    const maxPct = Math.min(pos.maxDiscountPercent, opts.maxDiscountPercent ?? 100);
    if (baseTotal > 0 && (manualDiscount / baseTotal) * 100 > maxPct + 0.001) throw badRequest(`الخصم يتجاوز الحد المسموح (${maxPct}%).`);
  }

  // 5) نقاط الولاء
  let loyaltyDiscount = 0; let loyaltyPointsUsed = 0;
  if (input.loyaltyPoints && input.loyaltyPoints > 0) {
    if (!pos.loyalty.enabled) throw badRequest('نظام الولاء غير مفعّل.');
    if (!input.customerId) throw badRequest('اختر العميل لاستخدام النقاط.');
    const [cu] = await tx.select().from(schema.customers).where(eq(schema.customers.id, input.customerId));
    if (!cu || cu.loyaltyPoints < input.loyaltyPoints) throw badRequest('رصيد النقاط غير كافٍ.');
    if (input.loyaltyPoints < pos.loyalty.minRedeem) throw badRequest(`الحد الأدنى لاستخدام النقاط ${pos.loyalty.minRedeem} نقطة.`);
    loyaltyDiscount = r2(Math.min(input.loyaltyPoints * pos.loyalty.riyalPerPoint, baseTotal - couponDiscount - manualDiscount));
    loyaltyPointsUsed = r2(loyaltyDiscount / pos.loyalty.riyalPerPoint);
  }

  // 6) توزيع خصومات الفاتورة على البنود بالتناسب ثم حساب الضريبة لكل بند
  const docDiscount = r2(couponDiscount + manualDiscount + loyaltyDiscount);
  let allocated = 0;
  work.forEach((w, idx) => {
    const share = baseTotal > 0 ? (idx === work.length - 1 ? r2(docDiscount - allocated) : r2(docDiscount * (afterOffers(w) / baseTotal))) : 0;
    allocated = r2(allocated + share);
    // نحافظ على السعر الشامل كما يراه العميل: الضريبة = الشامل − الصافي
    const finalIncl = r2(Math.max(0, afterOffers(w) - share));
    const lineBase = w.unitNetPrice * w.qty;
    const net = r2(finalIncl / (1 + w.rate / 100));
    w.discount = r2(Math.max(0, lineBase - net));
    w.netAmount = net;
    w.taxAmount = r2(finalIncl - net);
    w.total = finalIncl;
  });

  // 7) الشحن كبند خدمات
  if (input.shipping && input.shipping > 0) {
    const rate = tax.taxOnShipping ? rateOf(true) : 0;
    const net = r2(input.shipping / (1 + rate / 100));
    work.push({
      productId: null, unitId: null, unitName: null, unitFactor: 1, name: 'خدمات الشحن', barcode: null, qty: 1, unitPrice: net,
      discount: 0, taxRate: rate, taxAmount: r2(net * rate / 100), netAmount: net, total: r2(net + r2(net * rate / 100)), unitCost: 0,
      grossIncl: input.shipping, offerDiscount: 0, nonReturnable: true, rate, unitNetPrice: net, extraDiscIncl: 0,
    });
  }

  const lines: ComputedLine[] = work.map(({ product: _p, rate: _r, unitNetPrice: _u, extraDiscIncl: _e, ...rest }) => rest);
  const subtotal = r2(lines.reduce((s, l) => s + l.netAmount, 0));
  const taxTotal = r2(lines.reduce((s, l) => s + l.taxAmount, 0));
  const offerDiscount = r2(work.reduce((s, w) => s + w.offerDiscount, 0));
  return {
    lines, subtotal, taxTotal, total: r2(subtotal + taxTotal), costTotal: r2(lines.reduce((s, l) => s + l.unitCost * l.qty, 0)),
    discount: r2(docDiscount + offerDiscount), offerDiscount, couponDiscount, manualDiscount, loyaltyDiscount, loyaltyPointsUsed,
    couponCode, appliedOffers: [...appliedOffers], warnings,
  };
}
