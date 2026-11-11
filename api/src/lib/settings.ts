import { eq } from 'drizzle-orm';
import { db, schema, type Tx } from '../db/index.js';

// القيم الافتراضية لإعدادات المتجر
export const defaultSettings = {
  store: {
    name: 'متجري', nameEn: '', description: '', crNumber: '', logo: '', icon: '', phone: '', email: '',
    city: 'الرياض', district: '', street: '', buildingNo: '', postalCode: '', additionalNo: '',
    timezone: 'Asia/Riyadh', currencyCode: 'SAR', currencySymbol: 'ر.س', currencyName: 'ريال سعودي',
  },
  tax: {
    enabled: true, rate: 15, vatNumber: '', taxOnShipping: true, pricesIncludeTax: true,
    phase: 1 as 1 | 2,
  },
  pos: {
    requireCustomer: false, allowManualDiscount: true, maxDiscountPercent: 100, allowCoupons: true,
    allowExpiredSale: false, expiryWarningDays: 30, defaultLowStock: 0, allowNegativeStock: true,
    weightBarcode: { enabled: true, prefixes: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'], itemCodeLength: 5, valueLength: 5, valueType: 'WEIGHT' as 'WEIGHT' | 'PRICE', divisor: 1000 },
    loyalty: { enabled: false, pointsPerRiyal: 1, riyalPerPoint: 0.05, minRedeem: 100 },
    salesTarget: 0,
  },
  invoice: {
    showLogo: true, showStoreName: true, showCr: true, showVatNumber: true, showBranch: true,
    showBranchAddress: true, showBranchPhone: true, showEmployee: true, showOrderNo: true,
    showPaymentMethod: true, showCustomer: true, showCustomerPhone: true, showCustomerVat: true,
    showCustomerAddress: true, showLineNumbers: true, showSku: false, showUnit: true,
    showItemDiscount: true, showSubtotal: true, showTaxRate: true, showTaxAmount: true,
    showBarcode: true, showNotes: true, showFooter: true, showSignature: false, showStamp: false,
    notesText: '', footerText: 'شكراً لزيارتكم', signature: '', stamp: '', documentLanguage: 'BRANCH',
  },
  printer: {
    paperWidth: 80, method: 'BROWSER', autoPrint: true, cutMode: 'AUTO', openDrawer: false,
    copies: 1, agentUrl: 'http://127.0.0.1:17777', networkPrinter: '',
  },
};
export type Settings = typeof defaultSettings;
export type SettingsKey = keyof Settings;

export async function getSetting<K extends SettingsKey>(key: K, tx: Tx = db): Promise<Settings[K]> {
  const [row] = await tx.select().from(schema.settings).where(eq(schema.settings.key, key));
  return { ...defaultSettings[key], ...((row?.value as object) ?? {}) } as Settings[K];
}

export async function getAllSettings(tx: Tx = db): Promise<Settings> {
  const rows = await tx.select().from(schema.settings);
  const out = structuredClone(defaultSettings) as Record<string, unknown>;
  for (const r of rows) if (r.key in out) out[r.key] = { ...(out[r.key] as object), ...(r.value as object) };
  return out as Settings;
}

export async function setSetting<K extends SettingsKey>(key: K, value: Partial<Settings[K]>, tx: Tx = db) {
  const merged = { ...(await getSetting(key, tx)), ...value };
  await tx.insert(schema.settings).values({ key, value: merged })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: merged } });
  return merged;
}
