import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ah, badRequest, notFound } from '../lib/http.js';
import { can, effectivePermissions } from '../middleware/auth.js';
import { PERMISSIONS, ROLE_LABELS, ROLE_PRESETS } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';

const r = Router();
const pub = { id: schema.users.id, name: schema.users.name, email: schema.users.email, phone: schema.users.phone, role: schema.users.role, permissions: schema.users.permissions, maxDiscount: schema.users.maxDiscount, active: schema.users.active, branchId: schema.users.branchId, createdAt: schema.users.createdAt };

r.get('/meta', ah(async (_req, res) => res.json({ permissions: PERMISSIONS, roles: ROLE_LABELS, presets: ROLE_PRESETS })));

r.get('/', can('users.manage', 'reports.view', 'invoices.view'), ah(async (_req, res) => {
  const rows = await db.select(pub).from(schema.users).orderBy(asc(schema.users.id));
  res.json(rows.map((u) => ({ ...u, effectivePermissions: effectivePermissions(u.role, u.permissions) })));
}));

const body = z.object({
  name: z.string().min(2, 'الاسم مطلوب.'), email: z.string().email('البريد الإلكتروني غير صحيح.'), phone: z.string().optional().nullable(),
  role: z.enum(['MANAGER', 'ACCOUNTANT', 'CASHIER', 'STOREKEEPER', 'OWNER']), permissions: z.array(z.string()).default([]),
  maxDiscount: z.number().min(0).max(100).nullable().optional(), branchId: z.number().nullable().optional(), active: z.boolean().default(true),
  password: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل.').optional(), pin: z.string().regex(/^\d{4,6}$/, 'الرمز السري من 4 إلى 6 أرقام.').optional().or(z.literal('')),
});

r.post('/', can('users.manage'), ah(async (req, res) => {
  const b = body.parse(req.body);
  if (!b.password) throw badRequest('كلمة المرور مطلوبة للموظف الجديد.');
  if (b.role === 'OWNER') throw badRequest('لا يمكن إضافة مالك آخر.');
  const [u] = await db.insert(schema.users).values({ ...b, email: b.email.toLowerCase(), passwordHash: await bcrypt.hash(b.password, 10), pin: b.pin || null }).returning(pub);
  await logActivity({ userId: req.user!.id, action: 'user.create', entity: 'user', entityId: u.id, summary: `أضاف الموظف ${u.name}` });
  res.status(201).json(u);
}));

r.put('/:id', can('users.manage'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = body.partial().parse(req.body);
  const [ex] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!ex) throw notFound('الموظف غير موجود.');
  if (ex.role === 'OWNER' && (b.role && b.role !== 'OWNER' || b.active === false)) throw badRequest('لا يمكن تغيير دور المالك أو إيقافه.');
  const { password, pin, ...rest } = b;
  const patch: Record<string, unknown> = { ...rest };
  if (rest.email) patch.email = rest.email.toLowerCase();
  if (password) patch.passwordHash = await bcrypt.hash(password, 10);
  if (pin !== undefined) patch.pin = pin || null;
  const [u] = await db.update(schema.users).set(patch).where(eq(schema.users.id, id)).returning(pub);
  await logActivity({ userId: req.user!.id, action: 'user.update', entity: 'user', entityId: id, summary: `عدّل بيانات الموظف ${u.name}` });
  res.json(u);
}));

export default r;
