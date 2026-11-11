// إعدادات المتجر، الاستيراد من Excel/CSV، سجل الأحداث
import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { desc, eq, ilike, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ah, badRequest } from '../lib/http.js';
import { can } from '../middleware/auth.js';
import { getAllSettings, setSetting, defaultSettings, type SettingsKey } from '../lib/settings.js';
import { logActivity } from '../lib/activity.js';
import { moveStock } from '../services/inventory.js';

const r = Router();

r.get('/settings', ah(async (_req, res) => res.json(await getAllSettings())));

r.put('/settings/:key', can('settings.manage'), ah(async (req, res) => {
  const key = req.params.key as SettingsKey;
  if (!(key in defaultSettings)) throw badRequest('مفتاح إعدادات غير معروف.');
  if (key === 'tax' && req.body.vatNumber && !/^3\d{13}3$/.test(req.body.vatNumber)) throw badRequest('الرقم الضريبي 15 رقماً يبدأ وينتهي بالرقم 3 كما هو مسجّل في هيئة الزكاة والضريبة والجمارك.');
  if (key === 'tax' && req.body.rate != null && (req.body.rate < 0 || req.body.rate > 100)) throw badRequest('نسبة الضريبة غير صحيحة.');
  if (key === 'pos' && req.body.maxDiscountPercent != null && (req.body.maxDiscountPercent < 0 || req.body.maxDiscountPercent > 100)) throw badRequest('الحد الأقصى للخصم بين 0 و100.');
  const value = await setSetting(key, req.body);
  await logActivity({ userId: req.user!.id, action: 'settings.update', entity: 'settings', summary: `حدّث إعدادات ${key}` });
  res.json(value);
}));

// ===== الاستيراد =====
const PRODUCT_FIELDS: Record<string, string[]> = {
  name: ['الاسم', 'اسم المنتج', 'name', 'product'], nameEn: ['الاسم بالإنجليزية', 'name_en', 'english name'], barcode: ['الباركود', 'barcode', 'sku'],
  price: ['السعر', 'سعر البيع', 'price'], cost: ['التكلفة', 'سعر التكلفة', 'cost'], qty: ['الكمية', 'qty', 'quantity', 'stock'], category: ['التصنيف', 'category'],
};
const CUSTOMER_FIELDS: Record<string, string[]> = {
  name: ['الاسم', 'name'], phone: ['الجوال', 'رقم الجوال', 'phone', 'mobile'], email: ['البريد', 'البريد الإلكتروني', 'email'], city: ['المدينة', 'city'], vatNumber: ['الرقم الضريبي', 'vat', 'vat_number'],
};

async function readRows(base64: string, filename: string): Promise<Record<string, string>[]> {
  const buf = Buffer.from(base64.split(',').pop()!, 'base64');
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    const { Readable } = await import('node:stream');
    await wb.csv.read(Readable.from(buf));
  } else await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]; if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell((c, i) => { headers[i] = String(c.value ?? '').trim(); });
  const out: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o: Record<string, string> = {};
    row.eachCell((c, i) => { if (headers[i]) o[headers[i]] = String((c.value as { text?: string })?.text ?? c.value ?? '').trim(); });
    if (Object.values(o).some(Boolean)) out.push(o);
  });
  return out;
}

const mapRow = (row: Record<string, string>, fields: Record<string, string[]>) => {
  const o: Record<string, string> = {};
  for (const [k, aliases] of Object.entries(fields)) {
    const h = Object.keys(row).find((x) => aliases.some((a) => a.toLowerCase() === x.toLowerCase()));
    if (h) o[k] = row[h];
  }
  return o;
};

r.post('/import/preview', can('products.manage', 'customers.manage'), ah(async (req, res) => {
  const { type, file, filename } = z.object({ type: z.enum(['products', 'customers']), file: z.string(), filename: z.string() }).parse(req.body);
  const rows = (await readRows(file, filename)).map((x) => mapRow(x, type === 'products' ? PRODUCT_FIELDS : CUSTOMER_FIELDS));
  const checked = rows.map((x, i) => {
    const errors: string[] = [];
    if (!x.name) errors.push('الاسم مطلوب');
    if (type === 'products' && (x.price === undefined || isNaN(Number(x.price)))) errors.push('السعر غير صحيح');
    if (type === 'customers' && x.phone && !/^(05\d{8}|\+\d{8,15})$/.test(x.phone)) errors.push('رقم الجوال غير صحيح');
    return { line: i + 2, ...x, errors };
  });
  res.json({ rows: checked, valid: checked.filter((x) => !x.errors.length).length, invalid: checked.filter((x) => x.errors.length).length });
}));

r.post('/import/commit', can('products.manage', 'customers.manage'), ah(async (req, res) => {
  const { type, rows, branchId } = z.object({ type: z.enum(['products', 'customers']), branchId: z.number().optional(), rows: z.array(z.record(z.any())) }).parse(req.body) as { type: 'products' | 'customers'; branchId?: number; rows: Array<Record<string, string> & { errors?: string[] }> };
  let added = 0, updated = 0, skipped = 0;
  await db.transaction(async (tx) => {
    for (const x of rows) {
      if (!x.name || (x.errors && x.errors.length)) { skipped++; continue; }
      if (type === 'customers') {
        const [ex] = x.phone ? await tx.select().from(schema.customers).where(eq(schema.customers.phone, x.phone)) : [];
        if (ex) { await tx.update(schema.customers).set({ name: x.name, email: x.email || ex.email, city: x.city || ex.city, vatNumber: x.vatNumber || ex.vatNumber }).where(eq(schema.customers.id, ex.id)); updated++; }
        else { await tx.insert(schema.customers).values({ name: x.name, phone: x.phone || null, email: x.email || null, city: x.city || null, vatNumber: x.vatNumber || null }); added++; }
        continue;
      }
      let categoryId: number | null = null;
      if (x.category) {
        let [cat] = await tx.select().from(schema.categories).where(eq(schema.categories.name, x.category));
        if (!cat) [cat] = await tx.insert(schema.categories).values({ name: x.category }).returning();
        categoryId = cat.id;
      }
      const [ex] = x.barcode ? await tx.select().from(schema.products).where(or(eq(schema.products.barcode, x.barcode), ilike(schema.products.name, x.name))) : await tx.select().from(schema.products).where(eq(schema.products.name, x.name));
      const data = { name: x.name, nameEn: x.nameEn || null, barcode: x.barcode || null, price: Number(x.price), cost: Number(x.cost || 0), categoryId };
      if (ex) { await tx.update(schema.products).set(data).where(eq(schema.products.id, ex.id)); updated++; }
      else {
        const [p] = await tx.insert(schema.products).values({ ...data, avgCost: data.cost }).returning(); added++;
        if (branchId && Number(x.qty)) await moveStock(tx, { productId: p.id, branchId, qty: Number(x.qty), type: 'OPENING', note: 'استيراد', userId: req.user!.id, setCounted: true });
      }
    }
    await logActivity({ userId: req.user!.id, action: 'import', entity: type, summary: `استورد ${added} وحدّث ${updated} من ${type === 'products' ? 'المنتجات' : 'العملاء'}` }, tx);
  });
  res.json({ added, updated, skipped });
}));

r.get('/import/template/:type', ah(async (req, res) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('نموذج', { views: [{ rightToLeft: true }] });
  if (req.params.type === 'customers') { ws.addRow(['الاسم', 'الجوال', 'البريد', 'المدينة', 'الرقم الضريبي']); ws.addRow(['محمد أحمد', '0551234567', '', 'الرياض', '']); }
  else { ws.addRow(['الاسم', 'الاسم بالإنجليزية', 'الباركود', 'السعر', 'التكلفة', 'الكمية', 'التصنيف']); ws.addRow(['حليب طازج 1 لتر', 'Fresh Milk 1L', '6281007000011', 7.5, 5.2, 24, 'الألبان']); }
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-template.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

r.get('/activity', ah(async (req, res) => {
  const rows = await db.select({ id: schema.activityLogs.id, action: schema.activityLogs.action, entity: schema.activityLogs.entity, entityId: schema.activityLogs.entityId, summary: schema.activityLogs.summary, createdAt: schema.activityLogs.createdAt, user: schema.users.name })
    .from(schema.activityLogs).leftJoin(schema.users, eq(schema.users.id, schema.activityLogs.userId)).orderBy(desc(schema.activityLogs.id)).limit(Number(req.query.limit ?? 100));
  res.json(rows);
}));

export default r;
