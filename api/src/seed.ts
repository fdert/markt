// بيانات تجريبية: يُشغَّل مرة واحدة على قاعدة فارغة (npm run seed)
import { sql } from 'drizzle-orm';
import { db, pool, schema } from './db/index.js';
import { initialSetup } from './services/setup.js';
import { moveStock } from './services/inventory.js';
import { setSetting } from './lib/settings.js';
import { postEntry } from './services/accounting.js';

async function main() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if (n > 0) { console.log('Database already initialized, skipping seed.'); return pool.end(); }
  const { owner, branch } = await initialSetup({ storeName: 'متجر رصيد التجريبي', ownerName: 'مدير المتجر', email: 'owner@raseed.sa', password: 'Raseed@123', vatNumber: '310123456700003' });
  await setSetting('store', { crNumber: '1010123456', phone: '0112345678', city: 'الرياض', district: 'العليا', street: 'طريق الملك فهد', buildingNo: '1234', postalCode: '12211' });
  await setSetting('pos', { loyalty: { enabled: true, pointsPerRiyal: 1, riyalPerPoint: 0.05, minRedeem: 100 }, salesTarget: 50000 });
  await db.update(schema.branches).set({ phone: '0112345678', street: 'طريق الملك فهد', district: 'العليا', buildingNo: '1234', postalCode: '12211', crNumber: '1010123456' });
  const [b2] = await db.insert(schema.branches).values({ name: 'فرع جدة', city: 'جدة' }).returning();
  const [wh] = await db.insert(schema.branches).values({ name: 'المستودع المركزي', type: 'WAREHOUSE', city: 'الرياض' }).returning();
  await db.insert(schema.users).values({ name: 'خالد الكاشير', email: 'cashier@raseed.sa', passwordHash: owner.passwordHash, role: 'CASHIER', branchId: branch.id, maxDiscount: 10 });

  const cats = await db.insert(schema.categories).values(['الألبان', 'المشروبات', 'المخبوزات', 'الخضار والفواكه', 'المنظفات', 'القهوة'].map((name, i) => ({ name, sortOrder: i }))).returning();
  const c = Object.fromEntries(cats.map((x) => [x.name, x.id]));
  const items: Array<Partial<typeof schema.products.$inferInsert> & { name: string; price: number; qty?: number }> = [
    { name: 'حليب طازج كامل الدسم 1 لتر', barcode: '6281007000011', price: 7.5, cost: 5.2, categoryId: c['الألبان'], qty: 120 },
    { name: 'لبن زبادي 500 جم', barcode: '6281007000028', price: 4.5, cost: 3, categoryId: c['الألبان'], qty: 80 },
    { name: 'جبنة شيدر شرائح 200 جم', barcode: '6281007000035', price: 12.95, cost: 9, categoryId: c['الألبان'], qty: 40 },
    { name: 'مياه معدنية 330 مل', barcode: '6281007000042', price: 1, cost: 0.55, categoryId: c['المشروبات'], qty: 600 },
    { name: 'عصير برتقال طبيعي 1 لتر', barcode: '6281007000059', price: 9.95, cost: 6.5, categoryId: c['المشروبات'], qty: 3, lowStockAlert: 10 },
    { name: 'خبز أبيض شرائح', barcode: '6281007000066', price: 5, cost: 3.2, categoryId: c['المخبوزات'], qty: 50, nonReturnable: true },
    { name: 'كرواسون بالزبدة', barcode: '6281007000073', price: 3.5, cost: 1.8, categoryId: c['المخبوزات'], qty: 60 },
    { name: 'طماطم (بالكيلو)', barcode: '10001', price: 6, pricePerWeight: 6, isWeighted: true, cost: 3.5, categoryId: c['الخضار والفواكه'], qty: 200, unitName: 'كجم' },
    { name: 'موز (بالكيلو)', barcode: '10002', price: 7.25, pricePerWeight: 7.25, isWeighted: true, cost: 4, categoryId: c['الخضار والفواكه'], qty: 150, unitName: 'كجم' },
    { name: 'سائل غسيل أطباق 750 مل', barcode: '6281007000080', price: 11.5, cost: 7.8, categoryId: c['المنظفات'], qty: 70 },
    { name: 'بن عربي محمص', barcode: '6281007000097', price: 45, cost: 30, categoryId: c['القهوة'], qty: 25, unitName: 'كجم' },
    { name: 'كوب ورقي', barcode: '6281007000103', price: 0.5, cost: 0.15, categoryId: c['القهوة'], qty: 1000, posEnabled: false },
    { name: 'خدمة توصيل داخل المدينة', price: 15, type: 'SERVICE', unlimited: true },
    { name: 'خيمة رحلات 6 أشخاص', price: 80, type: 'RENTAL', rentalRate: 80, rentalUnit: 'DAY', depositAmount: 300, qty: 5 },
  ];
  const created: Record<string, number> = {};
  let openingValue = 0;
  for (const it of items) {
    const { qty, ...data } = it;
    const [p] = await db.insert(schema.products).values({ ...data, avgCost: data.cost ?? 0 } as typeof schema.products.$inferInsert).returning();
    created[p.name] = p.id;
    if (qty) {
      await moveStock(db, { productId: p.id, branchId: branch.id, qty, type: 'OPENING', note: 'رصيد افتتاحي', userId: owner.id, setCounted: true, unitCost: data.cost });
      await moveStock(db, { productId: p.id, branchId: wh.id, qty: qty * 2, type: 'OPENING', note: 'رصيد افتتاحي', userId: owner.id, setCounted: true, unitCost: data.cost });
      openingValue += (qty * 3 + Math.ceil(qty / 2)) * (data.cost ?? 0);
      await moveStock(db, { productId: p.id, branchId: b2.id, qty: Math.ceil(qty / 2), type: 'OPENING', note: 'رصيد افتتاحي', userId: owner.id, setCounted: true, unitCost: data.cost });
    }
  }
  // قيد الرصيد الافتتاحي للمخزون
  await postEntry(db, { description: 'رصيد افتتاحي للمخزون', refType: 'opening', userId: owner.id, lines: [{ key: 'INVENTORY', debit: Math.round(openingValue * 100) / 100 }, { key: 'OPENING', credit: Math.round(openingValue * 100) / 100 }] });
  // وحدات متعددة للمياه: حبة / كرتون 40
  await db.insert(schema.productUnits).values({ productId: created['مياه معدنية 330 مل'], name: 'كرتون 40 حبة', factor: 40, price: 32, barcode: '6281007000999' });
  // منتج مركب: قهوة عربية = بن 20 جم + كوب
  const [coffee] = await db.insert(schema.products).values({ name: 'قهوة عربية (كوب)', price: 8, isComposite: true, categoryId: c['القهوة'], unlimited: false }).returning();
  await db.insert(schema.recipeItems).values([{ productId: coffee.id, componentId: created['بن عربي محمص'], qty: 0.02 }, { productId: coffee.id, componentId: created['كوب ورقي'], qty: 1 }]);

  await db.insert(schema.customers).values([
    { name: 'عبدالله محمد العتيبي', phone: '0551234567', city: 'الرياض' },
    { name: 'شركة الأفق للتجارة', phone: '0112223333', type: 'COMPANY', vatNumber: '300000000000003', crNumber: '1010999888', city: 'الرياض', district: 'الملز', street: 'شارع الجامعة', buildingNo: '4321', postalCode: '12611' },
    { name: 'نورة السبيعي', phone: '0509876543', city: 'جدة', gender: 'FEMALE' },
  ]);
  await db.insert(schema.suppliers).values([{ name: 'شركة المراعي', vatNumber: '300000000000013'.replace(/13$/, '03'), phone: '0114700005' }, { name: 'مؤسسة الخضار الطازجة', phone: '0555000111' }]);
  const now = new Date();
  await db.insert(schema.coupons).values({ name: 'خصم الافتتاح', code: 'WELCOME10', type: 'PERCENT', value: 10, maxDiscount: 50, startsAt: now, endsAt: new Date(now.getTime() + 30 * 86400000) });
  await db.insert(schema.offers).values({ name: 'اشترِ 2 والثالث مجاناً - المياه', type: 'BXGY', buyQty: 2, getQty: 1, scope: 'PRODUCTS', productIds: [created['مياه معدنية 330 مل']], active: false });
  console.log('Seed done. Login: owner@raseed.sa / Raseed@123  |  cashier@raseed.sa / Raseed@123');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
