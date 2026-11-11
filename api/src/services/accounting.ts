// المحاسبة: دليل الحسابات والقيود الآلية (القيد المزدوج)
import { eq, inArray } from 'drizzle-orm';
import { db, schema, type Tx } from '../db/index.js';
import { nextNumber } from '../lib/counter.js';
import { r2 } from '../lib/money.js';
import { badRequest } from '../lib/http.js';

export const DEFAULT_ACCOUNTS: Array<{ code: string; name: string; type: string; parent?: string; key?: string; group?: boolean }> = [
  { code: '1000', name: 'الأصول', type: 'ASSET', group: true },
  { code: '1100', name: 'الصندوق (النقدية)', type: 'ASSET', parent: '1000', key: 'CASH' },
  { code: '1110', name: 'البنك والشبكة', type: 'ASSET', parent: '1000', key: 'BANK' },
  { code: '1200', name: 'ذمم العملاء', type: 'ASSET', parent: '1000', key: 'AR' },
  { code: '1300', name: 'المخزون', type: 'ASSET', parent: '1000', key: 'INVENTORY' },
  { code: '1400', name: 'ضريبة القيمة المضافة - المدخلات', type: 'ASSET', parent: '1000', key: 'VAT_INPUT' },
  { code: '2000', name: 'الخصوم', type: 'LIABILITY', group: true },
  { code: '2100', name: 'ذمم الموردين', type: 'LIABILITY', parent: '2000', key: 'AP' },
  { code: '2200', name: 'ضريبة القيمة المضافة - المخرجات', type: 'LIABILITY', parent: '2000', key: 'VAT_OUTPUT' },
  { code: '2300', name: 'تأمينات العملاء', type: 'LIABILITY', parent: '2000', key: 'DEPOSITS' },
  { code: '2400', name: 'نقاط الولاء المستحقة', type: 'LIABILITY', parent: '2000', key: 'LOYALTY' },
  { code: '3000', name: 'حقوق الملكية', type: 'EQUITY', group: true },
  { code: '3100', name: 'رأس المال', type: 'EQUITY', parent: '3000', key: 'CAPITAL' },
  { code: '3200', name: 'الأرباح المحتجزة', type: 'EQUITY', parent: '3000', key: 'RETAINED' },
  { code: '3300', name: 'أرصدة افتتاحية', type: 'EQUITY', parent: '3000', key: 'OPENING' },
  { code: '4000', name: 'الإيرادات', type: 'REVENUE', group: true },
  { code: '4100', name: 'المبيعات', type: 'REVENUE', parent: '4000', key: 'SALES' },
  { code: '4200', name: 'مرتجعات المبيعات', type: 'REVENUE', parent: '4000', key: 'SALES_RETURNS' },
  { code: '4300', name: 'إيرادات الإيجار', type: 'REVENUE', parent: '4000', key: 'RENTAL_REV' },
  { code: '5000', name: 'المصروفات', type: 'EXPENSE', group: true },
  { code: '5100', name: 'تكلفة البضاعة المباعة', type: 'EXPENSE', parent: '5000', key: 'COGS' },
  { code: '5200', name: 'فروقات الجرد والتالف', type: 'EXPENSE', parent: '5000', key: 'INVENTORY_DIFF' },
  { code: '5300', name: 'مصروفات عمومية وإدارية', type: 'EXPENSE', parent: '5000', key: 'GENERAL_EXP' },
  { code: '5310', name: 'الرواتب والأجور', type: 'EXPENSE', parent: '5000' },
  { code: '5320', name: 'الإيجارات', type: 'EXPENSE', parent: '5000' },
  { code: '5330', name: 'الكهرباء والمياه', type: 'EXPENSE', parent: '5000' },
  { code: '5340', name: 'التسويق والإعلان', type: 'EXPENSE', parent: '5000' },
  { code: '5400', name: 'فروقات الصندوق', type: 'EXPENSE', parent: '5000', key: 'CASH_DIFF' },
];

export async function seedAccounts(tx: Tx = db) {
  const ids = new Map<string, number>();
  for (const a of DEFAULT_ACCOUNTS) {
    const [row] = await tx.insert(schema.accounts).values({
      code: a.code, name: a.name, type: a.type, parentId: a.parent ? ids.get(a.parent) : null, systemKey: a.key ?? null, isGroup: !!a.group,
    }).onConflictDoNothing().returning();
    if (row) ids.set(a.code, row.id);
    else {
      const [ex] = await tx.select().from(schema.accounts).where(eq(schema.accounts.code, a.code));
      ids.set(a.code, ex.id);
    }
  }
}

export const methodAccount = (method: string) => (method === 'CASH' ? 'CASH' : method === 'CREDIT' ? 'AR' : method === 'LOYALTY' ? 'LOYALTY' : 'BANK');

export interface EntryLine { key?: string; accountId?: number; debit?: number; credit?: number; memo?: string }

export async function postEntry(tx: Tx, e: { description: string; refType?: string; refId?: number; branchId?: number; userId?: number; date?: Date; lines: EntryLine[] }) {
  const lines = e.lines.map((l) => ({ ...l, debit: r2(l.debit ?? 0), credit: r2(l.credit ?? 0) })).filter((l) => l.debit !== 0 || l.credit !== 0);
  if (!lines.length) return null;
  // تحويل القيم السالبة إلى الجانب المقابل
  for (const l of lines) {
    if (l.debit < 0) { l.credit += -l.debit; l.debit = 0; }
    if (l.credit < 0) { l.debit += -l.credit; l.credit = 0; }
  }
  const dr = r2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = r2(lines.reduce((s, l) => s + l.credit, 0));
  const diff = r2(dr - cr);
  if (Math.abs(diff) > 0.05) throw badRequest(`القيد غير متوازن (${dr} ≠ ${cr}).`);
  if (diff !== 0) lines[lines.length - 1][diff > 0 ? 'credit' : 'debit'] += Math.abs(diff); // فرق تقريب بسيط

  const keys = [...new Set(lines.filter((l) => l.key).map((l) => l.key!))];
  const accs = keys.length ? await tx.select().from(schema.accounts).where(inArray(schema.accounts.systemKey, keys)) : [];
  const byKey = new Map(accs.map((a) => [a.systemKey!, a.id]));
  const date = e.date ?? new Date();
  const periods = await tx.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.closed, true));
  if (periods.some((p) => date >= p.startDate && date <= p.endDate)) throw badRequest('الفترة المحاسبية مقفلة. لا يمكن تسجيل قيود فيها.');

  const number = await nextNumber(tx, 'journal', 'JV-');
  const [entry] = await tx.insert(schema.journalEntries).values({
    number, date, description: e.description, refType: e.refType, refId: e.refId, branchId: e.branchId, userId: e.userId,
  }).returning();
  await tx.insert(schema.journalLines).values(lines.map((l) => {
    const accountId = l.accountId ?? byKey.get(l.key!);
    if (!accountId) throw badRequest(`الحساب ${l.key} غير معرَّف في دليل الحسابات.`);
    return { entryId: entry.id, accountId, debit: r2(l.debit), credit: r2(l.credit), memo: l.memo };
  }));
  return entry;
}
