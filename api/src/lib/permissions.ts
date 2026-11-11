// قاموس الصلاحيات — يُفحص في الخادم عند كل طلب
export const PERMISSIONS = {
  'dashboard.view': 'عرض لوحة التحكم',
  'pos.use': 'استخدام نقطة البيع',
  'pos.discount': 'إضافة خصم يدوي',
  'pos.price_override': 'تعديل السعر في نقطة البيع',
  'pos.issue': 'الصرف الداخلي من نقطة البيع',
  'invoices.view': 'عرض الفواتير',
  'invoices.return': 'إرجاع الفواتير',
  'invoices.cancel': 'إلغاء الفواتير',
  'invoices.collect': 'تحصيل المستحقات',
  'products.view': 'عرض المنتجات',
  'products.manage': 'إدارة المنتجات والتصنيفات',
  'inventory.adjust': 'تسوية المخزون',
  'inventory.transfer': 'تحويلات المخزون',
  'customers.view': 'عرض العملاء',
  'customers.manage': 'إدارة العملاء',
  'suppliers.manage': 'إدارة الموردين',
  'purchases.manage': 'إدارة المشتريات',
  'expenses.manage': 'إدارة المصروفات',
  'accounting.view': 'عرض المحاسبة',
  'accounting.manage': 'إدارة القيود والفترات',
  'reports.view': 'عرض التقارير',
  'marketing.manage': 'إدارة الكوبونات والعروض',
  'rentals.manage': 'إدارة عقود الإيجار',
  'shifts.manage': 'مراجعة الصناديق والورديات',
  'settings.manage': 'إدارة الإعدادات',
  'users.manage': 'إدارة الموظفين والصلاحيات',
} as const;
export type Permission = keyof typeof PERMISSIONS;

export const ROLE_PRESETS: Record<string, Permission[]> = {
  OWNER: Object.keys(PERMISSIONS) as Permission[],
  MANAGER: (Object.keys(PERMISSIONS) as Permission[]).filter((p) => p !== 'users.manage'),
  ACCOUNTANT: ['dashboard.view', 'invoices.view', 'invoices.collect', 'customers.view', 'suppliers.manage', 'purchases.manage', 'expenses.manage', 'accounting.view', 'accounting.manage', 'reports.view', 'shifts.manage', 'products.view'],
  CASHIER: ['pos.use', 'pos.discount', 'invoices.view', 'customers.view', 'customers.manage', 'products.view'],
  STOREKEEPER: ['products.view', 'products.manage', 'inventory.adjust', 'inventory.transfer', 'purchases.manage', 'suppliers.manage'],
};

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'المالك', MANAGER: 'مدير', ACCOUNTANT: 'محاسب', CASHIER: 'كاشير', STOREKEEPER: 'أمين مستودع',
};
