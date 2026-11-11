// مكتبة المكونات المشتركة: أزرار، حقول، نوافذ، جداول، شارات، إشعارات
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Inbox } from 'lucide-react';
import clsx from 'clsx';
import type { Tone } from '../lib/format';

export { clsx };

// ===== الإشعارات المنبثقة =====
type Toast = { id: number; type: 'success' | 'error'; text: string };
const ToastCtx = createContext<(type: Toast['type'], text: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((type: Toast['type'], text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, type, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), type === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-4 z-[100] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))]" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} role="status" className={clsx('flex items-start gap-2 rounded-xl px-4 py-3 shadow-pop text-[15px] text-white animate-[fadeIn_.15s]', t.type === 'success' ? 'bg-ink-900' : 'bg-red-600')}>
            {t.type === 'success' ? <CheckCircle2 className="size-5 shrink-0 text-emerald-400" /> : <AlertCircle className="size-5 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => {
  const push = useContext(ToastCtx);
  return { success: (t: string) => push('success', t), error: (e: unknown) => push('error', e instanceof Error ? e.message : String(e)) };
};

// ===== الحقول =====
export function Field({ label, hint, error, children, required, className }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}{required && <span className="text-red-600"> *</span>}</label>}
      {children}
      {error ? <p className="mt-1 text-[13px] text-red-600">{error}</p> : hint ? <p className="mt-1 text-[13px] text-ink-500">{hint}</p> : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string; suffix?: ReactNode };
export function Input({ label, hint, error, suffix, className, required, id, ...p }: InputProps) {
  const gen = useId(); const fid = id ?? gen;
  const field = (
    <div className="relative">
      <input id={fid} required={required} aria-invalid={!!error} className={clsx('input', suffix && 'pe-14', error && 'border-red-400', className)} {...p} />
      {suffix && <span className="absolute inset-y-0 end-3 flex items-center text-sm text-ink-500 pointer-events-none">{suffix}</span>}
    </div>
  );
  if (!label && !hint && !error) return field;
  return <Field label={<label htmlFor={fid}>{label}</label>} hint={hint} error={error} required={required}>{field}</Field>;
}

export function NumberInput({ value, onChange, ...p }: Omit<InputProps, 'value' | 'onChange' | 'type'> & { value: number | null | undefined; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { if (value == null ? text !== '' : Number(text) !== value) setText(value == null ? '' : String(value)); }, [value]); // eslint-disable-line
  return <Input inputMode="decimal" dir="ltr" className="text-end num" value={text} onChange={(e) => {
    const t = e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d.]/g, '');
    setText(t); onChange(t === '' ? null : Number(t));
  }} {...p} />;
}

export function Select({ label, hint, error, children, className, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string }) {
  const id = useId();
  const el = <select id={id} className={clsx('input pe-8', className)} {...p}>{children}</select>;
  if (!label) return el;
  return <Field label={<label htmlFor={id}>{label}</label>} hint={hint} error={error}>{el}</Field>;
}

export function Textarea({ label, hint, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode }) {
  const id = useId();
  const el = <textarea id={id} className={clsx('input h-auto py-2 min-h-[80px]', className)} {...p} />;
  return label ? <Field label={<label htmlFor={id}>{label}</label>} hint={hint}>{el}</Field> : el;
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="text-[15px] font-medium text-ink-800 cursor-pointer">{label}</label>
        {hint && <p className="text-[13px] text-ink-500 mt-0.5">{hint}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={clsx('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50', checked ? 'bg-brand-600' : 'bg-ink-300')}>
        <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'start-[22px]' : 'start-0.5')} />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-[15px]">
      <input type="checkbox" className="size-4 rounded accent-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ===== الأزرار =====
// أسماء الأصناف مكتوبة صراحة حتى لا يحذفها Tailwind عند البناء
const BTN = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger' } as const;
export function Button({ variant = 'primary', loading, children, className, size, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean; size?: 'sm' | 'lg' }) {
  return (
    <button type="button" className={clsx(BTN[variant], size === 'sm' && '!h-8 !px-3 !text-sm', size === 'lg' && '!h-12 !px-6 !text-base', className)} disabled={loading || p.disabled} {...p}>
      {loading && <Loader2 className="size-4 animate-spin" />}{children}
    </button>
  );
}

export function IconButton({ label, children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" aria-label={label} title={label} className={clsx('inline-flex items-center justify-center size-9 rounded-lg text-ink-600 hover:bg-ink-100 hover:text-ink-900 transition', className)} {...p}>{children}</button>;
}

// ===== الشارات =====
const TONES: Record<Tone, string> = {
  gray: 'bg-ink-100 text-ink-700', green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20', blue: 'bg-sky-50 text-sky-700 ring-sky-600/20', brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
};
export const Badge = ({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) => <span className={clsx('inline-flex items-center rounded-md px-2 py-0.5 text-[12.5px] font-medium ring-1 ring-inset ring-transparent whitespace-nowrap', TONES[tone])}>{children}</span>;

// ===== النوافذ =====
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea,button[data-autofocus]')?.focus(), 30);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink-900/40" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={clsx('relative w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-pop flex flex-col max-h-[92vh]', w)}>
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-ink-100">
          <h2 className="text-lg font-bold">{title}</h2>
          <IconButton label="إغلاق" onClick={onClose}><X className="size-5" /></IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-ink-100 flex flex-wrap justify-end gap-2 bg-ink-50/50 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-2xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink-900/30" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className={clsx('absolute inset-y-0 start-0 w-full bg-white shadow-pop flex flex-col', width)}>
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-ink-100">
          <h2 className="text-lg font-bold">{title}</h2>
          <IconButton label="إغلاق" onClick={onClose}><X className="size-5" /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-ink-100 flex flex-wrap gap-2">{footer}</div>}
      </aside>
    </div>
  );
}

export function Confirm({ open, onClose, onConfirm, title, message, confirmText = 'تأكيد', danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmText?: string; danger?: boolean; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm} data-autofocus>{confirmText}</Button></>}>
      <p className="text-ink-700">{message}</p>
    </Modal>
  );
}

// ===== التخطيط =====
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-ink-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          {title && <h3 className="font-bold text-[16px]">{title}</h3>}
          {actions}
        </header>
      )}
      <div className={clsx('px-5 pb-5', !title && !actions && 'pt-5', bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down'; icon?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-ink-500 text-sm">{label}{icon}</div>
      <div className="mt-2 text-2xl font-extrabold num text-start">{value}</div>
      {sub && <div className={clsx('mt-1 text-[13px]', tone === 'up' ? 'text-emerald-700' : tone === 'down' ? 'text-red-600' : 'text-ink-500')}>{sub}</div>}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => <div className={clsx('flex justify-center py-10 text-ink-400', className)} role="status" aria-label="جارٍ التحميل"><Loader2 className="size-6 animate-spin" /></div>;

export function Empty({ title = 'لا بيانات لعرضها.', hint, action, icon }: { title?: string; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <div className="size-12 rounded-full bg-ink-100 flex items-center justify-center text-ink-400 mb-3">{icon ?? <Inbox className="size-6" />}</div>
      <p className="font-medium text-ink-700">{title}</p>
      {hint && <p className="text-sm text-ink-500 mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode; count?: number }>; className?: string }) {
  return (
    <div role="tablist" className={clsx('flex gap-1 overflow-x-auto border-b border-ink-200 mb-4 -mx-1 px-1', className)}>
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={clsx('px-3 py-2.5 text-[15px] whitespace-nowrap border-b-2 -mb-px transition', value === it.value ? 'border-brand-700 text-brand-800 font-bold' : 'border-transparent text-ink-500 hover:text-ink-800')}>
          {it.label}{it.count != null && <span className="ms-1.5 text-xs bg-ink-100 rounded-full px-1.5 py-0.5 num">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string }> }) {
  return (
    <div className="inline-flex rounded-lg bg-ink-100 p-0.5" role="radiogroup">
      {items.map((it) => (
        <button key={it.value} role="radio" aria-checked={value === it.value} onClick={() => onChange(it.value)}
          className={clsx('px-3 h-8 rounded-md text-sm transition', value === it.value ? 'bg-white shadow-card font-bold text-ink-900' : 'text-ink-600 hover:text-ink-900')}>{it.label}</button>
      ))}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="table w-full">
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <Empty />}
    </div>
  );
}

export function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-ink-500">
      <span>عرض <span className="num">{(page - 1) * limit + 1}–{Math.min(page * limit, total)}</span> من <span className="num">{total}</span></span>
      <div className="flex gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابق</Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالي</Button>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'بحث', className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return <input type="search" aria-label={placeholder} className={clsx('input', className)} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />;
}

/** تأخير القيمة لتقليل طلبات البحث */
export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** نموذج بسيط لإدارة حالة الحقول */
export function useForm<T extends object>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = <K extends keyof T>(k: K, v: T[K]) => setValues((s) => ({ ...s, [k]: v }));
  const bind = <K extends keyof T>(k: K) => ({ value: (values[k] ?? '') as string, onChange: (e: { target: { value: string } }) => set(k, e.target.value as T[K]) });
  return { values, setValues, set, bind };
}
