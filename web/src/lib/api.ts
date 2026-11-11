// عميل الواجهة البرمجية: يضيف رمز الدخول ويعرض رسائل الخطأ بالعربية
const TOKEN_KEY = 'raseed.token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* تجاهل */ } },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: Array<{ path: string; message: string }>) { super(message); }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query; raw?: boolean } = {}): Promise<T> {
  const qs = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'تعذّر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.');
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) { tokenStore.set(null); if (!location.pathname.startsWith('/login')) location.href = '/login'; }
  if (opts.raw) { if (!res.ok) throw new ApiError(res.status, 'حدث خطأ أثناء التنزيل.'); return res as unknown as T; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.message ?? 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.', data.errors);
  return data as T;
}

export async function download(path: string, filename: string, query?: Query) {
  const res = await api<Response>(path, { raw: true, query });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
