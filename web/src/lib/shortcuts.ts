// اختصارات لوحة المفاتيح في نقطة البيع — قابلة للتخصيص وتُحفظ لكل جهاز
export const SHORTCUT_ACTIONS = {
  priceCheck: 'فحص السعر',
  removeLine: 'حذف البند المحدد',
  pay: 'الدفع',
  manualItem: 'بند يدوي',
  discount: 'الخصم والكوبون',
  quickCash: 'دفع نقدي سريع',
  quickCard: 'دفع شبكة سريع',
  hold: 'تعليق الفاتورة',
  customer: 'اختيار عميل',
  tables: 'الطاولات',
  held: 'الفواتير المعلّقة',
  newSale: 'تفريغ السلة',
} as const;
export type ShortcutAction = keyof typeof SHORTCUT_ACTIONS;

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  priceCheck: 'F2', removeLine: 'F3', pay: 'F4', manualItem: 'F6', discount: 'F7', quickCash: 'F8', quickCard: 'F9', hold: 'F10',
  customer: 'F11', tables: 'F12', held: 'Ctrl+H', newSale: 'Ctrl+Delete',
};

const KEY = 'raseed.shortcuts';
export const shortcutStore = {
  get(): Record<ShortcutAction, string> {
    try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULT_SHORTCUTS; }
  },
  set(v: Record<ShortcutAction, string>) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* تجاهل */ } },
};

/** تحويل حدث لوحة المفاتيح إلى نص مثل Ctrl+Shift+K */
export function keyString(e: KeyboardEvent | React.KeyboardEvent) {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && e.key.length > 1) parts.push('Shift');
  const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(k)) parts.push(k);
  return parts.join('+');
}
