// تهيئة النظام لأول مرة: الفرع الرئيسي، المالك، دليل الحسابات، تصنيفات المصروفات
import bcrypt from 'bcryptjs';
import { db, schema } from '../db/index.js';
import { seedAccounts } from './accounting.js';
import { setSetting } from '../lib/settings.js';

export async function initialSetup(p: { storeName: string; ownerName: string; email: string; password: string; vatNumber?: string }) {
  return db.transaction(async (tx) => {
    const [branch] = await tx.insert(schema.branches).values({ name: 'الفرع الرئيسي', isDefault: true, city: 'الرياض' }).returning();
    const [owner] = await tx.insert(schema.users).values({
      name: p.ownerName, email: p.email.toLowerCase(), passwordHash: await bcrypt.hash(p.password, 10), role: 'OWNER', branchId: branch.id,
    }).returning();
    await seedAccounts(tx);
    await tx.insert(schema.expenseCategories).values(['إيجار', 'رواتب', 'كهرباء ومياه', 'تسويق', 'صيانة', 'نثريات'].map((name) => ({ name })));
    await setSetting('store', { name: p.storeName }, tx);
    if (p.vatNumber) await setSetting('tax', { vatNumber: p.vatNumber }, tx);
    return { owner, branch };
  });
}
