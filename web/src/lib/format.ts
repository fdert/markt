// تنسيق الأرقام والتواريخ بالصيغة السعودية (أرقام لاتينية وأسماء الأشهر بالعربية)
const LOCALE = 'ar-SA-u-nu-latn-ca-gregory';
const TZ = 'Asia/Riyadh';

export const money = (n: number | string | null | undefined, digits = 2) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n ?? 0));
export const qty = (n: number | null | undefined) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(Number(n ?? 0));
export const pct = (n: number) => `${n > 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n)}%`;

/** مثال: 05 أغسطس 2026 */
export const date = (d: string | Date | null | undefined) => d ? new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'long', year: 'numeric', timeZone: TZ }).format(new Date(d)) : '—';
export const time = (d: string | Date) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date(d));
export const dateTime = (d: string | Date | null | undefined) => d ? `${date(d)}، ${time(d)}` : '—';
export const shortDate = (d: string | Date) => new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(d));
export const isoDate = (d = new Date()) => new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 10);

export const PAYMENT_LABELS: Record<string, string> = { CASH: 'نقدي', CARD: 'شبكة (مدى)', BANK_TRANSFER: 'تحويل بنكي', CREDIT: 'آجل', LOYALTY: 'نقاط الولاء', OTHER: 'أخرى' };
export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'مسودة', tone: 'gray' }, PAID: { label: 'مدفوعة', tone: 'green' }, PARTIAL: { label: 'مدفوعة جزئياً', tone: 'amber' },
  UNPAID: { label: 'آجلة', tone: 'amber' }, RETURNED: { label: 'مرتجعة', tone: 'red' }, PARTIALLY_RETURNED: { label: 'مرتجعة جزئياً', tone: 'red' }, CANCELLED: { label: 'ملغاة', tone: 'gray' },
};
export const ZATCA_STATUS: Record<string, { label: string; tone: Tone }> = {
  NOT_REQUIRED: { label: 'المرحلة الأولى', tone: 'gray' }, PENDING: { label: 'بانتظار الإبلاغ', tone: 'amber' }, REPORTED: { label: 'مُبلَّغة', tone: 'green' },
  CLEARED: { label: 'معتمدة', tone: 'green' }, REJECTED: { label: 'مرفوضة', tone: 'red' }, WARNING: { label: 'مقبولة بتحذير', tone: 'amber' },
};
export const CHANNEL_LABELS: Record<string, string> = { POS: 'نقطة البيع', ONLINE: 'المتجر الإلكتروني', ORDER: 'طلبات' };
export type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'brand';
