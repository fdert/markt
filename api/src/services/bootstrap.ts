// تهيئة البيانات المرجعية عند تشغيل الخادم: دليل الحسابات وطرق الدفع (عملية آمنة التكرار)
import { db, schema } from '../db/index.js';
import { seedAccounts, setMethodAccounts } from './accounting.js';

export const DEFAULT_PAYMENT_METHODS = [
  { code: 'CASH', name: 'نقدي', kind: 'CASH', accountKey: 'CASH', builtIn: true, sortOrder: 1 },
  { code: 'CARD', name: 'شبكة (مدى)', kind: 'CARD', accountKey: 'BANK', builtIn: true, sortOrder: 2 },
  { code: 'BANK_TRANSFER', name: 'تحويل بنكي', kind: 'TRANSFER', accountKey: 'BANK', builtIn: true, sortOrder: 3 },
  { code: 'CREDIT', name: 'آجل', kind: 'CREDIT', accountKey: 'AR', builtIn: true, sortOrder: 4 },
  { code: 'WALLET', name: 'محفظة العميل', kind: 'WALLET', accountKey: 'CUSTOMER_WALLET', builtIn: true, sortOrder: 5 },
  { code: 'TABBY', name: 'تابي', kind: 'BNPL', accountKey: 'APP_RECEIVABLE', active: false, sortOrder: 10 },
  { code: 'TAMARA', name: 'تمارا', kind: 'BNPL', accountKey: 'APP_RECEIVABLE', active: false, sortOrder: 11 },
  { code: 'GEIDEA', name: 'جيديا', kind: 'CARD', accountKey: 'BANK', active: false, sortOrder: 12 },
  { code: 'HUNGERSTATION', name: 'هنقرستيشن', kind: 'DELIVERY_APP', accountKey: 'APP_RECEIVABLE', active: false, sortOrder: 20 },
  { code: 'JAHEZ', name: 'جاهز', kind: 'DELIVERY_APP', accountKey: 'APP_RECEIVABLE', active: false, sortOrder: 21 },
  { code: 'TOYOU', name: 'تو يو', kind: 'DELIVERY_APP', accountKey: 'APP_RECEIVABLE', active: false, sortOrder: 22 },
  { code: 'NINJA', name: 'نينجا', kind: 'DELIVERY_APP', accountKey: 'APP_RECEIVABLE', active: false, sortOrder: 23 },
  { code: 'WASEL', name: 'واصل', kind: 'DELIVERY_APP', accountKey: 'APP_RECEIVABLE', active: false, sortOrder: 24 },
  { code: 'ONLINE', name: 'دفع أونلاين', kind: 'ONLINE', accountKey: 'BANK', active: false, sortOrder: 30 },
];

export async function refreshPaymentMethods() {
  setMethodAccounts(await db.select({ code: schema.paymentMethods.code, accountKey: schema.paymentMethods.accountKey }).from(schema.paymentMethods));
}

let done: Promise<void> | null = null;
export function bootstrap() {
  done ??= (async () => {
    await seedAccounts(db);
    await db.insert(schema.paymentMethods).values(DEFAULT_PAYMENT_METHODS).onConflictDoNothing();
    await refreshPaymentMethods();
  })().catch((e) => { done = null; throw e; });
  return done;
}
