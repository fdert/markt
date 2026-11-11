import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ah, badRequest } from '../lib/http.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { initialSetup } from '../services/setup.js';
import { getSetting } from '../lib/settings.js';

const r = Router();

r.get('/status', ah(async (_req, res) => {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  const store = await getSetting('store');
  res.json({ initialized: n > 0, storeName: store.name });
}));

r.post('/setup', ah(async (req, res) => {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if (n > 0) throw badRequest('النظام مهيأ مسبقاً.');
  const body = z.object({
    storeName: z.string().min(2, 'اسم المتجر مطلوب.'), ownerName: z.string().min(2, 'الاسم مطلوب.'),
    email: z.string().email('البريد الإلكتروني غير صحيح.'), password: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل.'),
    vatNumber: z.string().regex(/^3\d{13}3$/, 'الرقم الضريبي 15 رقماً يبدأ وينتهي بالرقم 3.').optional().or(z.literal('')),
  }).parse(req.body);
  const { owner } = await initialSetup({ ...body, vatNumber: body.vatNumber || undefined });
  res.status(201).json({ token: signToken(owner.id) });
}));

r.post('/login', ah(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email('البريد الإلكتروني غير صحيح.'), password: z.string().min(1, 'كلمة المرور مطلوبة.') }).parse(req.body);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()));
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw badRequest('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  if (!u.active) throw badRequest('الحساب موقوف. تواصل مع مالك المتجر.');
  res.json({ token: signToken(u.id) });
}));

r.get('/me', authenticate, ah(async (req, res) => {
  const store = await getSetting('store');
  const branches = await db.select({ id: schema.branches.id, name: schema.branches.name, type: schema.branches.type, isDefault: schema.branches.isDefault }).from(schema.branches).where(eq(schema.branches.active, true));
  res.json({ user: req.user, store: { name: store.name, logo: store.logo, currencySymbol: store.currencySymbol }, branches });
}));

r.post('/change-password', authenticate, ah(async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل.') }).parse(req.body);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, req.user!.id));
  if (!(await bcrypt.compare(current, u.passwordHash))) throw badRequest('كلمة المرور الحالية غير صحيحة.');
  await db.update(schema.users).set({ passwordHash: await bcrypt.hash(next, 10) }).where(eq(schema.users.id, u.id));
  res.json({ message: 'تم تحديث كلمة المرور.' });
}));

export default r;
