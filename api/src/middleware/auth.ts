import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { ROLE_PRESETS, type Permission } from '../lib/permissions.js';

export interface AuthUser {
  id: number; name: string; email: string; role: string; branchId: number | null;
  permissions: string[]; maxDiscount: number | null;
}

declare module 'express-serve-static-core' {
  interface Request { user?: AuthUser }
}

export const signToken = (userId: number) => jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpires } as jwt.SignOptions);

export function effectivePermissions(role: string, custom: string[]) {
  if (role === 'OWNER') return ROLE_PRESETS.OWNER as string[];
  return custom.length ? custom : (ROLE_PRESETS[role] ?? []);
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'سجّل الدخول للمتابعة.' });
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as unknown as { sub: number };
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, Number(payload.sub)));
    if (!u || !u.active) return res.status(401).json({ message: 'الحساب موقوف أو غير موجود.' });
    req.user = {
      id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branchId,
      permissions: effectivePermissions(u.role, u.permissions), maxDiscount: u.maxDiscount,
    };
    next();
  } catch {
    return res.status(401).json({ message: 'انتهت الجلسة. سجّل الدخول مرة أخرى.' });
  }
}

export const can = (...perms: Permission[]) => (req: Request, res: Response, next: NextFunction) => {
  const p = req.user?.permissions ?? [];
  if (perms.some((x) => p.includes(x))) return next();
  return res.status(403).json({ message: 'لا تملك صلاحية تنفيذ هذا الإجراء.' });
};
