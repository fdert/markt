// إدارة المخزون لكل فرع مع سجل حركات دائم (بطاقة الصنف)
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '../db/index.js';
import { r3 } from '../lib/money.js';

type Product = typeof schema.products.$inferSelect;

export const isStockTracked = (p: Pick<Product, 'unlimited' | 'type' | 'isComposite'>) =>
  !p.unlimited && p.type !== 'SERVICE' && p.type !== 'DIGITAL' && !p.isComposite;

/** تحريك كمية منتج في فرع (الكمية موجبة للزيادة وسالبة للنقص) */
export async function moveStock(tx: Tx, m: { productId: number; branchId: number; qty: number; type: string; refType?: string; refId?: number; note?: string; userId?: number; unitCost?: number; setCounted?: boolean }) {
  const [row] = await tx.insert(schema.stocks).values({ productId: m.productId, branchId: m.branchId, qty: r3(m.qty), counted: !!m.setCounted })
    .onConflictDoUpdate({
      target: [schema.stocks.productId, schema.stocks.branchId],
      set: { qty: sql`${schema.stocks.qty} + ${r3(m.qty)}`, ...(m.setCounted ? { counted: true } : {}) },
    }).returning();
  await tx.insert(schema.stockMovements).values({
    productId: m.productId, branchId: m.branchId, type: m.type, qty: r3(m.qty), balanceAfter: row.qty,
    refType: m.refType, refId: m.refId, note: m.note, userId: m.userId, unitCost: m.unitCost,
  });
  return row.qty;
}

/** بيع/إرجاع منتج: يخصم المنتج نفسه أو مكونات وصفته إن كان مركباً */
export async function moveForSale(tx: Tx, p: Product, baseQty: number, branchId: number, type: 'SALE' | 'RETURN' | 'ISSUE', ref: { refType: string; refId: number; userId: number }) {
  const sign = type === 'RETURN' ? 1 : -1;
  if (p.isComposite) {
    const recipe = await tx.select().from(schema.recipeItems).where(eq(schema.recipeItems.productId, p.id));
    let cost = 0;
    for (const r of recipe) {
      const [c] = await tx.select().from(schema.products).where(eq(schema.products.id, r.componentId));
      if (!c) continue;
      cost += (c.avgCost || c.cost) * r.qty;
      if (isStockTracked(c)) await moveStock(tx, { productId: c.id, branchId, qty: sign * r.qty * baseQty, type, note: `مكوّن في ${p.name}`, ...ref });
    }
    return cost;
  }
  if (isStockTracked(p)) await moveStock(tx, { productId: p.id, branchId, qty: sign * baseQty, type, ...ref, unitCost: p.avgCost || p.cost });
  return p.avgCost || p.cost;
}

export async function stockOf(tx: Tx, productId: number, branchId: number) {
  const [s] = await tx.select().from(schema.stocks).where(and(eq(schema.stocks.productId, productId), eq(schema.stocks.branchId, branchId)));
  return s?.qty ?? 0;
}
