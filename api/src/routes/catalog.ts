// التصنيفات والعلامات التجارية والمنتجات والوحدات والوصفات والباركود
import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { qcol } from '../lib/col.js';
import { db, schema } from '../db/index.js';
import { ah, badRequest, notFound, page } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { logActivity } from '../lib/activity.js';
import { getSetting } from '../lib/settings.js';
import { moveStock } from '../services/inventory.js';
import { postEntry } from '../services/accounting.js';
import { r2 } from '../lib/money.js';

const r = Router();
const P = schema.products;

// ===== التصنيفات =====
r.get('/categories', ah(async (_req, res) => {
  const rows = await db.select({
    id: schema.categories.id, name: schema.categories.name, nameEn: schema.categories.nameEn, description: schema.categories.description,
    image: schema.categories.image, parentId: schema.categories.parentId, active: schema.categories.active, sortOrder: schema.categories.sortOrder,
    productsCount: sql<number>`(select count(*)::int from products p where p.category_id = ${qcol(schema.categories.id)})`,
  }).from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
  res.json(rows);
}));
const catBody = z.object({ name: z.string().min(1, 'اسم التصنيف مطلوب.'), nameEn: z.string().nullish(), description: z.string().nullish(), image: z.string().nullish(), parentId: z.number().nullish(), active: z.boolean().default(true), sortOrder: z.number().default(0) });
r.post('/categories', can('products.manage'), ah(async (req, res) => {
  const [row] = await db.insert(schema.categories).values(catBody.parse(req.body)).returning();
  res.status(201).json(row);
}));
r.put('/categories/:id', can('products.manage'), ah(async (req, res) => {
  const id = Number(req.params.id); const b = catBody.partial().parse(req.body);
  if (b.parentId === id) throw badRequest('لا يمكن جعل التصنيف أباً لنفسه.');
  if (b.parentId) {
    const [child] = await db.select().from(schema.categories).where(eq(schema.categories.parentId, id)).limit(1);
    if (child) throw badRequest('هذا التصنيف له فروع — لا يمكن جعله فرعيّاً.');
  }
  const [row] = await db.update(schema.categories).set(b).where(eq(schema.categories.id, id)).returning();
  res.json(row);
}));
r.delete('/categories/:id', can('products.manage'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const [used] = await db.select({ id: P.id }).from(P).where(eq(P.categoryId, id)).limit(1);
  if (used) throw badRequest('لا يمكن حذف تصنيف يحتوي على منتجات. انقل المنتجات أولاً.');
  await db.update(schema.categories).set({ parentId: null }).where(eq(schema.categories.parentId, id));
  await db.delete(schema.categories).where(eq(schema.categories.id, id));
  res.json({ message: 'تم الحذف.' });
}));

// ===== العلامات التجارية =====
r.get('/brands', ah(async (_req, res) => res.json(await db.select().from(schema.brands).orderBy(asc(schema.brands.name)))));
r.post('/brands', can('products.manage'), ah(async (req, res) => {
  const [row] = await db.insert(schema.brands).values(z.object({ name: z.string().min(1) }).parse(req.body)).returning();
  res.status(201).json(row);
}));

// ===== المنتجات =====
const stockSum = sql<number>`coalesce((select sum(s.qty) from stocks s where s.product_id = ${qcol(P.id)}), 0)::float`;
const soldSum = sql<number>`coalesce((select sum(ii.qty * ii.unit_factor) from invoice_items ii join invoices i on i.id = ii.invoice_id where ii.product_id = ${qcol(P.id)} and i.type = 'INVOICE' and i.status <> 'DRAFT'), 0)::float`;

r.get('/products', ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const { limit, offset } = page(q);
  const where: SQL[] = [];
  if (q.search) {
    const s = `%${q.search}%`;
    where.push(or(ilike(P.name, s), ilike(P.nameEn, s), eq(P.barcode, q.search), ilike(P.sku, s), sql`exists (select 1 from product_units u where u.product_id = ${qcol(P.id)} and u.barcode = ${q.search})`)!);
  }
  if (q.categoryId) where.push(eq(P.categoryId, Number(q.categoryId)));
  if (q.type) where.push(eq(P.type, q.type));
  if (q.brandId) where.push(eq(P.brandId, Number(q.brandId)));
  if (q.status === 'active') where.push(eq(P.active, true));
  if (q.status === 'hidden') where.push(eq(P.active, false));
  if (q.channel === 'pos') where.push(eq(P.posEnabled, true));
  if (q.channel === 'online') where.push(eq(P.onlineEnabled, true));
  if (q.noImage) where.push(isNull(P.image));
  if (q.noBarcode) where.push(isNull(P.barcode));
  if (q.noCategory) where.push(isNull(P.categoryId));
  if (q.minPrice) where.push(sql`${qcol(P.price)} >= ${Number(q.minPrice)}`);
  if (q.maxPrice) where.push(sql`${qcol(P.price)} <= ${Number(q.maxPrice)}`);
  if (q.stock === 'out') where.push(and(eq(P.unlimited, false), sql`${stockSum} <= 0`)!);
  if (q.stock === 'low') where.push(and(eq(P.unlimited, false), sql`${stockSum} > 0 and ${stockSum} <= coalesce(${qcol(P.lowStockAlert)}, 5)`)!);
  if (q.expiry === 'expired') where.push(sql`${qcol(P.expiryDate)} < now()`);
  if (q.expiry === 'soon') where.push(sql`${qcol(P.expiryDate)} between now() and now() + interval '30 days'`);
  if (q.neverSold) where.push(sql`${soldSum} = 0`);
  const cond = where.length ? and(...where) : undefined;
  const order = q.sort === 'oldest' ? asc(P.id) : q.sort === 'price_asc' ? asc(P.price) : q.sort === 'price_desc' ? desc(P.price) : q.sort === 'name' ? asc(P.name) : desc(P.id);
  const rows = await db.select({
    id: P.id, type: P.type, name: P.name, nameEn: P.nameEn, barcode: P.barcode, sku: P.sku, categoryId: P.categoryId, price: P.price, cost: P.cost,
    avgCost: P.avgCost, taxIncluded: P.taxIncluded, unlimited: P.unlimited, active: P.active, image: P.image, isWeighted: P.isWeighted,
    pricePerWeight: P.pricePerWeight, expiryDate: P.expiryDate, posEnabled: P.posEnabled, onlineEnabled: P.onlineEnabled, lowStockAlert: P.lowStockAlert,
    unitName: P.unitName, isComposite: P.isComposite, isFavorite: P.isFavorite, stock: stockSum,
    category: sql<string>`(select name from categories c where c.id = ${qcol(P.categoryId)})`,
  }).from(P).where(cond).orderBy(order).limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(P).where(cond);
  const [stats] = await db.select({
    total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where active)::int`, hidden: sql<number>`count(*) filter (where not active)::int`,
    low: sql<number>`count(*) filter (where not unlimited and ${stockSum} > 0 and ${stockSum} <= coalesce(low_stock_alert, 5))::int`,
    out: sql<number>`count(*) filter (where not unlimited and ${stockSum} <= 0)::int`,
    expired: sql<number>`count(*) filter (where expiry_date < now())::int`,
    expiringSoon: sql<number>`count(*) filter (where expiry_date between now() and now() + interval '30 days')::int`,
  }).from(P);
  res.json({ rows, total, stats });
}));

/** بحث نقطة البيع بالباركود: يدعم باركود المنتج والوحدات وباركود الميزان */
r.get('/products/lookup', ah(async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  const branchId = Number(req.query.branchId ?? req.user!.branchId ?? 0);
  if (!code) throw badRequest('أدخل الباركود.');
  const pos = await getSetting('pos');
  const matches: Array<{ product: typeof P.$inferSelect; unit: typeof schema.productUnits.$inferSelect | null; qty?: number; price?: number }> = [];
  const byProduct = await db.select().from(P).where(and(eq(P.active, true), or(eq(P.barcode, code), eq(P.sku, code))));
  byProduct.forEach((p) => matches.push({ product: p, unit: null }));
  const byUnit = await db.select().from(schema.productUnits).innerJoin(P, eq(P.id, schema.productUnits.productId))
    .where(and(eq(schema.productUnits.barcode, code), eq(schema.productUnits.active, true), eq(P.active, true)));
  byUnit.forEach((u) => matches.push({ product: u.products, unit: u.product_units }));

  // باركود الميزان: بادئة + رمز الصنف + الوزن/السعر + رقم التحقق
  const wb = pos.weightBarcode;
  if (!matches.length && wb.enabled && code.length >= 12 && wb.prefixes.some((pfx) => code.startsWith(pfx))) {
    const pfxLen = wb.prefixes.find((pfx) => code.startsWith(pfx))!.length;
    const itemCode = code.slice(pfxLen, pfxLen + wb.itemCodeLength);
    const value = Number(code.slice(pfxLen + wb.itemCodeLength, pfxLen + wb.itemCodeLength + wb.valueLength)) / wb.divisor;
    const candidates = await db.select().from(P).where(and(eq(P.active, true), or(eq(P.barcode, itemCode), eq(P.sku, itemCode), eq(P.barcode, String(Number(itemCode))))));
    for (const p of candidates) {
      const unitPrice = p.pricePerWeight ?? p.price;
      if (wb.valueType === 'PRICE') matches.push({ product: p, unit: null, qty: Math.round((value / unitPrice) * 1000) / 1000, price: unitPrice });
      else matches.push({ product: p, unit: null, qty: value, price: unitPrice });
    }
  }
  const ids = matches.map((m) => m.product.id);
  const stocks = ids.length && branchId ? await db.select().from(schema.stocks).where(and(inArray(schema.stocks.productId, ids), eq(schema.stocks.branchId, branchId))) : [];
  res.json(matches.map((m) => ({
    productId: m.product.id, unitId: m.unit?.id ?? null, name: m.unit ? `${m.product.name} - ${m.unit.name}` : m.product.name,
    price: m.price ?? m.unit?.price ?? (m.product.isWeighted && m.product.pricePerWeight ? m.product.pricePerWeight : m.product.price),
    qty: m.qty ?? null, isWeighted: m.product.isWeighted, image: m.product.image, barcode: code,
    stock: stocks.find((s) => s.productId === m.product.id)?.qty ?? 0, unlimited: m.product.unlimited, expiryDate: m.product.expiryDate,
    taxIncluded: m.product.taxIncluded, taxable: m.product.taxable, factor: m.unit?.factor ?? 1,
  })));
}));

r.get('/products/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(P).where(eq(P.id, id));
  if (!p) throw notFound('المنتج غير موجود.');
  const [units, recipe, stocks] = await Promise.all([
    db.select().from(schema.productUnits).where(eq(schema.productUnits.productId, id)).orderBy(asc(schema.productUnits.id)),
    db.select({ id: schema.recipeItems.id, componentId: schema.recipeItems.componentId, qty: schema.recipeItems.qty, name: P.name, cost: P.avgCost, baseCost: P.cost, unitName: P.unitName })
      .from(schema.recipeItems).innerJoin(P, eq(P.id, schema.recipeItems.componentId)).where(eq(schema.recipeItems.productId, id)),
    db.select({ branchId: schema.branches.id, branchName: schema.branches.name, branchType: schema.branches.type, isDefault: schema.branches.isDefault, qty: schema.stocks.qty, reserved: schema.stocks.reserved, counted: schema.stocks.counted, alertLevel: schema.stocks.alertLevel })
      .from(schema.branches).leftJoin(schema.stocks, and(eq(schema.stocks.branchId, schema.branches.id), eq(schema.stocks.productId, id))),
  ]);
  res.json({ ...p, units, recipe, stocks });
}));

const unitSchema = z.object({ id: z.number().optional(), name: z.string().min(1, 'اسم الوحدة مطلوب.'), factor: z.number().positive().default(1), price: z.number().min(0), barcode: z.string().nullish(), active: z.boolean().default(true) });
const productBody = z.object({
  type: z.enum(['SIMPLE', 'PRO', 'SERVICE', 'RENTAL', 'DIGITAL']).default('SIMPLE'),
  name: z.string().min(1, 'اسم المنتج مطلوب.'), nameEn: z.string().nullish(), sku: z.string().nullish(), barcode: z.string().nullish(),
  categoryId: z.number().nullish(), brandId: z.number().nullish(), unitName: z.string().default('حبة'),
  price: z.number({ invalid_type_error: 'سعر البيع مطلوب.' }).min(0), cost: z.number().min(0).default(0),
  taxIncluded: z.boolean().default(true), taxable: z.boolean().default(true), discountPrice: z.number().nullish(),
  isWeighted: z.boolean().default(false), pricePerWeight: z.number().nullish(), unlimited: z.boolean().default(false),
  expiryDate: z.string().nullish(), posEnabled: z.boolean().default(true), onlineEnabled: z.boolean().default(true),
  requiresShipping: z.boolean().default(true), nonReturnable: z.boolean().default(false), lowStockAlert: z.number().nullish(),
  isComposite: z.boolean().default(false), rentalRate: z.number().nullish(), rentalUnit: z.string().nullish(), depositAmount: z.number().nullish(),
  description: z.string().nullish(), shortDescription: z.string().nullish(), tags: z.array(z.string()).default([]), image: z.string().nullish(), active: z.boolean().default(true), isFavorite: z.boolean().default(false),
  units: z.array(unitSchema).optional(), recipe: z.array(z.object({ componentId: z.number(), qty: z.number().positive('كمية المكوّن يجب أن تكون أكبر من صفر.') })).optional(),
  openingStock: z.array(z.object({ branchId: z.number(), qty: z.number() })).optional(),
});

async function checkBarcodes(barcodes: string[], productId?: number) {
  const list = barcodes.filter(Boolean);
  if (new Set(list).size !== list.length) throw badRequest('يوجد باركود مكرر داخل المنتج نفسه.');
  if (!list.length) return [];
  const a = await db.select({ id: P.id, name: P.name }).from(P).where(and(inArray(P.barcode, list), productId ? sql`${qcol(P.id)} <> ${productId}` : undefined));
  const b = await db.select({ id: schema.productUnits.productId }).from(schema.productUnits).where(and(inArray(schema.productUnits.barcode, list), productId ? sql`${qcol(schema.productUnits.productId)} <> ${productId}` : undefined));
  return [...a.map((x) => x.id), ...b.map((x) => x.id)];
}

async function saveProduct(id: number | null, b: z.infer<typeof productBody>, userId: number) {
  const dup = await checkBarcodes([b.barcode ?? '', ...(b.units ?? []).map((u) => u.barcode ?? '')], id ?? undefined);
  const warnings = dup.length ? ['هذا الباركود مسجَّل على صنف آخر. سيُطلب من الكاشير الاختيار عند البيع.'] : [];
  if (b.isComposite && (!b.recipe || !b.recipe.length)) throw badRequest('التكوين مفعّل بلا مكونات — أضف مكوناً واحداً على الأقل.');
  return db.transaction(async (tx) => {
    const { units, recipe, openingStock, ...data } = b;
    const values = { ...data, expiryDate: data.expiryDate ? new Date(data.expiryDate) : null, updatedAt: new Date() };
    let product: typeof P.$inferSelect;
    if (id) {
      [product] = await tx.update(P).set(values).where(eq(P.id, id)).returning();
      if (!product) throw notFound('المنتج غير موجود.');
    } else {
      [product] = await tx.insert(P).values({ ...values, avgCost: data.cost }).returning();
    }
    if (units) {
      const keep = units.filter((u) => u.id).map((u) => u.id!);
      await tx.delete(schema.productUnits).where(and(eq(schema.productUnits.productId, product.id), keep.length ? sql`${qcol(schema.productUnits.id)} not in (${sql.join(keep.map((k) => sql`${k}`), sql`, `)})` : undefined));
      for (const u of units) {
        if (u.id) await tx.update(schema.productUnits).set({ ...u, barcode: u.barcode || null }).where(eq(schema.productUnits.id, u.id));
        else await tx.insert(schema.productUnits).values({ ...u, barcode: u.barcode || null, productId: product.id });
      }
    }
    if (recipe) {
      if (recipe.some((x) => x.componentId === product.id)) throw badRequest('لا يمكن أن يكون المنتج مكوّناً في نفسه.');
      await tx.delete(schema.recipeItems).where(eq(schema.recipeItems.productId, product.id));
      if (recipe.length) await tx.insert(schema.recipeItems).values(recipe.map((x) => ({ ...x, productId: product.id })));
    }
    if (!id && openingStock?.length) {
      let value = 0;
      for (const s of openingStock.filter((x) => x.qty !== 0)) {
        await moveStock(tx, { productId: product.id, branchId: s.branchId, qty: s.qty, type: 'OPENING', note: 'رصيد افتتاحي', userId, unitCost: data.cost, setCounted: true });
        value += s.qty * data.cost;
      }
      if (value > 0) await postEntry(tx, { description: `رصيد افتتاحي للمنتج ${product.name}`, refType: 'product', refId: product.id, userId, lines: [{ key: 'INVENTORY', debit: r2(value) }, { key: 'OPENING', credit: r2(value) }] });
    }
    await logActivity({ userId, action: id ? 'product.update' : 'product.create', entity: 'product', entityId: product.id, summary: `${id ? 'عدّل' : 'أضاف'} المنتج ${product.name}` }, tx);
    return { product, warnings };
  });
}

r.post('/products', can('products.manage'), ah(async (req, res) => res.status(201).json(await saveProduct(null, productBody.parse(req.body), req.user!.id))));
r.put('/products/:id', can('products.manage'), ah(async (req, res) => res.json(await saveProduct(Number(req.params.id), productBody.partial().parse(req.body) as z.infer<typeof productBody>, req.user!.id))));

r.post('/products/bulk', can('products.manage'), ah(async (req, res) => {
  const { ids, action, categoryId } = z.object({ ids: z.array(z.number()).min(1), action: z.enum(['activate', 'hide', 'delete', 'category', 'favorite', 'unfavorite']), categoryId: z.number().optional() }).parse(req.body);
  if (action === 'activate') await db.update(P).set({ active: true }).where(inArray(P.id, ids));
  if (action === 'favorite' || action === 'unfavorite') await db.update(P).set({ isFavorite: action === 'favorite' }).where(inArray(P.id, ids));
  if (action === 'hide') await db.update(P).set({ active: false }).where(inArray(P.id, ids));
  if (action === 'category') await db.update(P).set({ categoryId }).where(inArray(P.id, ids));
  if (action === 'delete') {
    const used = await db.selectDistinct({ id: schema.invoiceItems.productId }).from(schema.invoiceItems).where(inArray(schema.invoiceItems.productId, ids));
    if (used.length) throw badRequest('بعض المنتجات لها فواتير — أخفِها بدلاً من حذفها.');
    await db.delete(P).where(inArray(P.id, ids));
  }
  res.json({ message: 'تم التحديث.' });
}));

r.delete('/products/:id', can('products.manage'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const [used] = await db.select({ id: schema.invoiceItems.id }).from(schema.invoiceItems).where(eq(schema.invoiceItems.productId, id)).limit(1);
  if (used) throw badRequest('المنتج مستخدم في فواتير — أخفِه بدلاً من حذفه حفاظاً على السجل.');
  await db.delete(P).where(eq(P.id, id));
  res.json({ message: 'تم الحذف.' });
}));

// بطاقة الصنف: آخر الحركات
r.get('/products/:id/movements', ah(async (req, res) => {
  const rows = await db.select({
    id: schema.stockMovements.id, type: schema.stockMovements.type, qty: schema.stockMovements.qty, balanceAfter: schema.stockMovements.balanceAfter,
    note: schema.stockMovements.note, createdAt: schema.stockMovements.createdAt, refType: schema.stockMovements.refType, refId: schema.stockMovements.refId,
    branch: schema.branches.name, user: schema.users.name,
  }).from(schema.stockMovements).leftJoin(schema.branches, eq(schema.branches.id, schema.stockMovements.branchId)).leftJoin(schema.users, eq(schema.users.id, schema.stockMovements.userId))
    .where(eq(schema.stockMovements.productId, Number(req.params.id))).orderBy(desc(schema.stockMovements.id)).limit(Number(req.query.limit ?? 30));
  res.json(rows);
}));

// تسوية المخزون: زيادة / نقص / عد فعلي
r.post('/products/:id/adjust', can('inventory.adjust'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ branchId: z.number(), mode: z.enum(['ADD', 'SUBTRACT', 'COUNT']), qty: z.number().min(0), reason: z.string().min(2, 'سبب التعديل مطلوب.') }).parse(req.body);
  const result = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(P).where(eq(P.id, id));
    if (!p) throw notFound('المنتج غير موجود.');
    const [s] = await tx.select().from(schema.stocks).where(and(eq(schema.stocks.productId, id), eq(schema.stocks.branchId, b.branchId)));
    const current = s?.qty ?? 0;
    const delta = b.mode === 'ADD' ? b.qty : b.mode === 'SUBTRACT' ? -b.qty : b.qty - current;
    const balance = await moveStock(tx, { productId: id, branchId: b.branchId, qty: delta, type: s?.counted || b.mode !== 'COUNT' ? 'ADJUST' : 'OPENING', note: b.reason, userId: req.user!.id, setCounted: true, unitCost: p.avgCost || p.cost });
    const value = r2(delta * (p.avgCost || p.cost));
    if (value !== 0) await postEntry(tx, { description: `تسوية مخزون ${p.name}: ${b.reason}`, refType: 'adjust', refId: id, branchId: b.branchId, userId: req.user!.id, lines: [{ key: 'INVENTORY', debit: value }, { key: s?.counted ? 'INVENTORY_DIFF' : 'OPENING', credit: value }] });
    await logActivity({ userId: req.user!.id, action: 'stock.adjust', entity: 'product', entityId: id, summary: `عدّل كمية ${p.name} بمقدار ${delta} (${b.reason})` }, tx);
    return { balance };
  });
  res.json(result);
}));

r.post('/products/:id/alert', can('inventory.adjust', 'products.manage'), ah(async (req, res) => {
  const b = z.object({ branchId: z.number(), alertLevel: z.number().min(0) }).parse(req.body);
  await db.insert(schema.stocks).values({ productId: Number(req.params.id), branchId: b.branchId, alertLevel: b.alertLevel })
    .onConflictDoUpdate({ target: [schema.stocks.productId, schema.stocks.branchId], set: { alertLevel: b.alertLevel } });
  res.json({ message: 'تم الحفظ.' });
}));

export default r;
