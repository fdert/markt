import { db, schema, type Tx } from '../db/index.js';

export async function logActivity(p: { userId?: number | null; action: string; entity: string; entityId?: number | null; summary: string; data?: unknown }, tx: Tx = db) {
  await tx.insert(schema.activityLogs).values({
    userId: p.userId ?? null, action: p.action, entity: p.entity, entityId: p.entityId ?? null, summary: p.summary, data: (p.data ?? null) as never,
  });
}
