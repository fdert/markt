import { sql } from 'drizzle-orm';
import { schema, type Tx } from '../db/index.js';

// ترقيم تسلسلي آمن ضد التزامن (مثال: INV-000123)
export async function nextNumber(tx: Tx, key: string, prefix: string, pad = 6): Promise<string> {
  const [row] = await tx.insert(schema.counters).values({ key, value: 1 })
    .onConflictDoUpdate({ target: schema.counters.key, set: { value: sql`${schema.counters.value} + 1` } })
    .returning();
  return `${prefix}${String(row.value).padStart(pad, '0')}`;
}
