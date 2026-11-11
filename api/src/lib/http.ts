import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

// خطأ تطبيقي برسالة عربية واضحة للمستخدم
export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, details);
export const notFound = (msg = 'العنصر غير موجود.') => new AppError(404, msg);
export const forbidden = (msg = 'لا تملك صلاحية تنفيذ هذا الإجراء.') => new AppError(403, msg);

export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      message: 'راجع الحقول المعلَّمة بالأحمر.',
      errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }
  const pgErr = err as { code?: string; detail?: string };
  if (pgErr?.code === '23505') {
    return res.status(409).json({ message: 'القيمة مستخدمة مسبقاً.', details: pgErr.detail });
  }
  console.error(err);
  return res.status(500).json({ message: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.' });
}

export const page = (q: Record<string, unknown>) => {
  const limit = Math.min(Math.max(Number(q.limit ?? 25), 1), 500);
  const pageNo = Math.max(Number(q.page ?? 1), 1);
  return { limit, offset: (pageNo - 1) * limit, page: pageNo };
};
