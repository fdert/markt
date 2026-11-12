// المنيو الذكي العام: صفحة يفتحها الزبون بمسح رمز QR دون تسجيل دخول
import { Router } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ah, notFound } from '../lib/http.js';
import { getSetting } from '../lib/settings.js';

const r = Router();

r.get('/menu', ah(async (req, res) => {
  const menu = await getSetting('menu');
  if (!menu.enabled) throw notFound('المنيو غير مفعّل.');
  const store = await getSetting('store');
  const branchId = req.query.branch ? Number(req.query.branch) : null;
  const P = schema.products;
  const products = await db.select({
    id: P.id, name: P.name, nameEn: P.nameEn, price: P.price, image: P.image, categoryId: P.categoryId, description: P.shortDescription, isWeighted: P.isWeighted, pricePerWeight: P.pricePerWeight,
    available: sql<boolean>`${P.unlimited} or ${P.isComposite} or ${P.type} = 'SERVICE' or coalesce((select sum(qty) from stocks s where s.product_id = "products"."id" and (${branchId}::int is null or s.branch_id = ${branchId})),0) > 0`,
  }).from(P).where(and(eq(P.active, true), eq(P.posEnabled, true))).orderBy(asc(P.name));
  const categories = await db.select({ id: schema.categories.id, name: schema.categories.name, nameEn: schema.categories.nameEn, image: schema.categories.image })
    .from(schema.categories).where(eq(schema.categories.active, true)).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
  const list = products.filter((p) => menu.showOutOfStock || p.available).map((p) => ({ ...p, price: menu.showPrices ? p.price : null }));
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ store: { name: menu.title || store.name, subtitle: menu.subtitle, logo: store.logo, phone: store.phone, whatsapp: menu.whatsapp, currency: store.currencySymbol },
    categories: categories.filter((c) => list.some((p) => p.categoryId === c.id)), products: list });
}));

export default r;
