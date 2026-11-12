// نوافذ نقطة البيع: الدفع، العميل، الخصم، البند اليدوي، الوحدات، الوزن، الوردية، المعلّقة، فحص السعر، الصرف الداخلي
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CreditCard, Landmark, Clock, Trash2, Printer, Plus, Wallet2, CalendarClock, Bike, Globe, CircleDollarSign } from 'lucide-react';
import { api } from '../../lib/api';
import { money, dateTime, time, PAYMENT_LABELS } from '../../lib/format';
import { Badge, Button, Checkbox, Empty, Input, Modal, NumberInput, Segmented, Select, Spinner, Textarea, clsx, useDebounced, useToast } from '../../components/ui';
import type { Customer, LookupResult, Shift } from './types';
import { CustomerForm } from '../../pages/customers/CustomerForm';
import { printHtml } from '../print/receipt';

export type PayLine = { method: string; amount: number };
export interface PayMethod { id: number; code: string; name: string; kind: string; active: boolean; sortOrder: number }
const ICONS: Record<string, JSX.Element> = { CASH: <Banknote className="size-5" />, CARD: <CreditCard className="size-5" />, TRANSFER: <Landmark className="size-5" />, CREDIT: <Clock className="size-5" />, WALLET: <Wallet2 className="size-5" />, BNPL: <CalendarClock className="size-5" />, DELIVERY_APP: <Bike className="size-5" />, ONLINE: <Globe className="size-5" />, OTHER: <CircleDollarSign className="size-5" /> };

export function usePayMethods() {
  return useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PayMethod[]>('/payment-methods'), staleTime: 60_000 });
}

// ===== الدفع (طرق دفع ديناميكية: نقدي، شبكة، محفظة، تطبيقات التوصيل، تقسيط…) =====
export function PaymentModal({ open, onClose, total, customer, onPay, loading, showPad = true }: { open: boolean; onClose: () => void; total: number; customer: Customer | null; onPay: (p: PayLine[]) => void; loading: boolean; showPad?: boolean }) {
  const { data: methodsAll } = usePayMethods();
  const methods = (methodsAll ?? []).filter((m) => m.active);
  const [pays, setPays] = useState<PayLine[]>([]);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState<number | null>(null);
  const { data: wallet } = useQuery({ queryKey: ['wallet', customer?.id], queryFn: () => api<{ walletBalance: number }>(`/customers/${customer!.id}/wallet`), enabled: open && !!customer });
  useEffect(() => { if (open) { setPays([]); setMethod('CASH'); setAmount(total); } }, [open, total]);
  const paid = pays.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);
  const change = Math.max(0, Math.round((paid - total) * 100) / 100);
  const needsCustomer = (code: string) => code === 'CREDIT' || code === 'WALLET';
  const pick = (code: string) => {
    setMethod(code);
    if (code === 'WALLET') setAmount(Math.min(remaining, wallet?.walletBalance ?? 0));
    else if (code !== 'CASH') setAmount(remaining);
  };
  const add = (m = method, a = amount ?? 0) => {
    if (a <= 0) return;
    if (m !== 'CASH' && a > remaining + 0.001) return;
    setPays((p) => [...p, { method: m, amount: a }]); setAmount(Math.max(0, Math.round((remaining - a) * 100) / 100));
  };
  const finish = (list = pays) => onPay(list);
  const name = (code: string) => methods.find((m) => m.code === code)?.name ?? PAYMENT_LABELS[code] ?? code;
  const quick = [...new Set([remaining, Math.ceil(remaining), Math.ceil(remaining / 5) * 5, Math.ceil(remaining / 10) * 10, Math.ceil(remaining / 50) * 50, Math.ceil(remaining / 100) * 100])].filter((x) => x > 0).slice(0, 5);
  return (
    <Modal open={open} onClose={onClose} title="الدفع" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button size="lg" loading={loading}
          onClick={() => finish(pays.length ? (remaining > 0 && amount ? [...pays, { method, amount }] : pays) : [{ method, amount: amount ?? 0 }])}>
          إصدار الفاتورة</Button></>}>
      <div className="rounded-xl bg-brand-50 p-4 flex items-center justify-between mb-4">
        <span className="text-brand-800">المطلوب</span><span className="text-3xl font-extrabold num text-brand-900">{money(total)}</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3" role="radiogroup" aria-label="طريقة الدفع">
        {methods.map((m) => (
          <button key={m.code} role="radio" aria-checked={method === m.code} disabled={needsCustomer(m.code) && !customer}
            onClick={() => pick(m.code)}
            className={clsx('flex flex-col items-center gap-1 rounded-xl border p-2.5 text-[13px] transition disabled:opacity-40', method === m.code ? 'border-brand-600 bg-brand-50 text-brand-800 font-bold' : 'border-ink-200 hover:bg-ink-50')}>
            {ICONS[m.kind] ?? ICONS.OTHER}{m.name}
          </button>
        ))}
      </div>
      {!customer && <p className="text-[13px] text-ink-500 mb-3">البيع الآجل والدفع من المحفظة يتطلبان اختيار العميل.</p>}
      {customer && wallet && <p className="text-[13px] text-ink-600 mb-3">رصيد محفظة {customer.name}: <b className="num">{money(wallet.walletBalance)}</b></p>}
      <div className="flex gap-2 items-end">
        <NumberInput label="المبلغ" value={amount} onChange={setAmount} className="!h-12 !text-xl" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (pays.length === 0 && amount && amount >= total) finish([{ method, amount }]); else add(); } }} />
        <Button variant="secondary" className="!h-12" onClick={() => add()}>إضافة دفعة</Button>
      </div>
      {method === 'CASH' && showPad && (
        <div className="flex flex-wrap gap-2 mt-3">
          {quick.map((q) => <Button key={q} variant="secondary" size="sm" onClick={() => setAmount(q)}><span className="num">{money(q, q % 1 ? 2 : 0)}</span></Button>)}
        </div>
      )}
      {pays.length > 0 && (
        <ul className="mt-4 divide-y divide-ink-100 border border-ink-200 rounded-lg">
          {pays.map((p, i) => (
            <li key={i} className="flex items-center justify-between px-3 py-2">
              <span>{name(p.method)}</span>
              <span className="flex items-center gap-2"><span className="num font-bold">{money(p.amount)}</span>
                <button aria-label="حذف الدفعة" className="text-ink-400 hover:text-red-600" onClick={() => setPays((l) => l.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-3 mt-4 text-center">
        <div className="rounded-lg bg-ink-50 p-3"><div className="text-sm text-ink-500">المتبقي</div><div className="text-xl font-bold num">{money(remaining)}</div></div>
        <div className="rounded-lg bg-emerald-50 p-3"><div className="text-sm text-emerald-700">الباقي للعميل</div><div className="text-xl font-bold num text-emerald-800">{money(pays.length ? change : Math.max(0, (amount ?? 0) - total))}</div></div>
      </div>
    </Modal>
  );
}

// ===== اختيار العميل =====
export function CustomerModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (c: Customer | null) => void }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['customers', 'pos', dq], queryFn: () => api<{ rows: Customer[] }>('/customers', { query: { search: dq, limit: 20 } }), enabled: open });
  useEffect(() => { if (open) { setQ(''); setCreating(false); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={creating ? 'عميل جديد' : 'اختيار عميل'} size="md">
      {creating ? <CustomerForm onSaved={(c) => { onSelect(c); onClose(); }} onCancel={() => setCreating(false)} /> : (
        <>
          <div className="flex gap-2 mb-3">
            <input className="input" autoFocus placeholder="ابحث بالاسم أو الجوال أو الرقم الضريبي" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث العملاء" />
            <Button variant="secondary" onClick={() => setCreating(true)}><Plus className="size-4" />عميل جديد</Button>
          </div>
          <button className="w-full text-start px-3 py-2.5 rounded-lg hover:bg-ink-50 text-ink-600" onClick={() => { onSelect(null); onClose(); }}>بدون عميل (عميل نقدي)</button>
          {isLoading ? <Spinner /> : (
            <ul className="divide-y divide-ink-100">
              {data?.rows.map((c) => (
                <li key={c.id}><button className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-brand-50 rounded-lg text-start" onClick={() => { onSelect(c); onClose(); }}>
                  <span><span className="font-medium">{c.name}</span>{c.vatNumber && <Badge tone="blue">منشأة</Badge>}<span className="block text-sm text-ink-500 num text-start">{c.phone}</span></span>
                  {c.due ? <span className="text-sm text-amber-700">مستحق: <span className="num">{money(c.due)}</span></span> : null}
                </button></li>
              ))}
              {data && !data.rows.length && <Empty title="لا نتائج" />}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

// ===== الخصم والكوبون ونقاط الولاء =====
export function DiscountModal({ open, onClose, value, onApply, loyaltyEnabled, customer }: {
  open: boolean; onClose: () => void; customer: Customer | null; loyaltyEnabled: boolean;
  value: { discount: { type: 'AMOUNT' | 'PERCENT'; value: number } | null; coupon: string; points: number };
  onApply: (v: { discount: { type: 'AMOUNT' | 'PERCENT'; value: number } | null; coupon: string; points: number }) => void;
}) {
  const [tab, setTab] = useState<'discount' | 'coupon' | 'points'>('discount');
  const [type, setType] = useState<'AMOUNT' | 'PERCENT'>(value.discount?.type ?? 'AMOUNT');
  const [amt, setAmt] = useState<number | null>(value.discount?.value ?? null);
  const [coupon, setCoupon] = useState(value.coupon);
  const [points, setPoints] = useState<number | null>(value.points || null);
  useEffect(() => { if (open) { setType(value.discount?.type ?? 'AMOUNT'); setAmt(value.discount?.value ?? null); setCoupon(value.coupon); setPoints(value.points || null); } }, [open]); // eslint-disable-line
  const apply = () => { onApply({ discount: amt ? { type, value: amt } : null, coupon: coupon.trim(), points: points ?? 0 }); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="الخصم والعروض" size="sm"
      footer={<><Button variant="ghost" onClick={() => { onApply({ discount: null, coupon: '', points: 0 }); onClose(); }}>إزالة الخصم</Button><Button onClick={apply}>تطبيق</Button></>}>
      <div className="mb-4"><Segmented value={tab} onChange={setTab} items={[{ value: 'discount', label: 'خصم' }, { value: 'coupon', label: 'كوبون' }, ...(loyaltyEnabled ? [{ value: 'points' as const, label: 'نقاط الولاء' }] : [])]} /></div>
      {tab === 'discount' && (
        <div className="space-y-3">
          <Segmented value={type} onChange={setType} items={[{ value: 'AMOUNT', label: 'مبلغ' }, { value: 'PERCENT', label: 'نسبة %' }]} />
          <NumberInput label="مبلغ الخصم" value={amt} onChange={setAmt} suffix={type === 'PERCENT' ? '%' : 'ر.س'} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </div>
      )}
      {tab === 'coupon' && <Input label="كود الكوبون" dir="ltr" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && apply()} />}
      {tab === 'points' && (customer ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-600">رصيد العميل: <b className="num">{money(customer.loyaltyPoints ?? 0, 0)}</b> نقطة</p>
          <NumberInput label="استخدام النقاط" value={points} onChange={setPoints} />
        </div>
      ) : <p className="text-ink-500">اختر العميل أولاً لاستخدام النقاط.</p>)}
    </Modal>
  );
}

// ===== بند يدوي =====
export function ManualItemModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (v: { name: string; price: number; qty: number; taxable: boolean }) => void }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState<number | null>(null); const [q, setQ] = useState<number | null>(1); const [taxable, setTaxable] = useState(true);
  useEffect(() => { if (open) { setName(''); setPrice(null); setQ(1); setTaxable(true); } }, [open]);
  const ok = name.trim() && price != null && q;
  return (
    <Modal open={open} onClose={onClose} title="إضافة بند يدوي" size="sm" footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button disabled={!ok} onClick={() => { onAdd({ name: name.trim(), price: price!, qty: q!, taxable }); onClose(); }}>إضافة</Button></>}>
      <div className="space-y-3">
        <Input label="اسم الصنف" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3"><NumberInput label="السعر (شامل)" value={price} onChange={setPrice} /><NumberInput label="الكمية" value={q} onChange={setQ} /></div>
        <Checkbox checked={taxable} onChange={setTaxable} label="خاضع للضريبة" />
      </div>
    </Modal>
  );
}

// ===== اختيار الوحدة =====
export function UnitsModal({ productId, onClose, onPick }: { productId: number | null; onClose: () => void; onPick: (u: { unitId: number | null; name: string; price: number; barcode?: string | null }) => void }) {
  const { data } = useQuery({ queryKey: ['pos-units', productId], queryFn: () => api<{ product: { id: number; name: string; price: number; unitName: string; barcode: string | null }; units: Array<{ id: number; name: string; price: number; barcode: string | null; factor: number }> }>(`/pos/products/${productId}/units`), enabled: !!productId });
  return (
    <Modal open={!!productId} onClose={onClose} title="اختر الوحدة" size="sm">
      {!data ? <Spinner /> : (
        <div className="grid gap-2">
          {[{ id: null, name: data.product.unitName, price: data.product.price, barcode: data.product.barcode, factor: 1 }, ...data.units].map((u) => (
            <button key={u.id ?? 'base'} className="flex items-center justify-between rounded-xl border border-ink-200 px-4 py-3 hover:border-brand-500 hover:bg-brand-50"
              onClick={() => { onPick({ unitId: u.id, name: u.id ? `${data.product.name} - ${u.name}` : data.product.name, price: u.price, barcode: u.barcode }); onClose(); }}>
              <span className="font-medium">{u.name}{u.factor > 1 && <span className="text-sm text-ink-500"> ({u.factor} حبة)</span>}</span><span className="num font-bold">{money(u.price)}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ===== إدخال الوزن =====
export function WeightModal({ product, onClose, onAdd }: { product: { name: string; price: number } | null; onClose: () => void; onAdd: (w: number) => void }) {
  const [w, setW] = useState<number | null>(null);
  useEffect(() => setW(null), [product]);
  return (
    <Modal open={!!product} onClose={onClose} title={`الوزن — ${product?.name ?? ''}`} size="sm" footer={<Button disabled={!w} onClick={() => { onAdd(w!); onClose(); }}>إضافة</Button>}>
      <NumberInput label="الوزن (كجم)" value={w} onChange={setW} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && w) { onAdd(w); onClose(); } }} hint={product ? `السعر = الوزن × ${money(product.price)} — المبلغ: ${money((w ?? 0) * product.price)}` : undefined} />
    </Modal>
  );
}

// ===== باركود مكرر =====
export function DuplicateModal({ matches, onClose, onPick }: { matches: LookupResult[]; onClose: () => void; onPick: (m: LookupResult) => void }) {
  return (
    <Modal open={matches.length > 1} onClose={onClose} title="باركود مكرّر — اختر الصنف" size="sm">
      <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3 mb-3">هذا الباركود مسجَّل على أكثر من صنف. الاختيار التلقائي قد يخصم من رصيد الصنف الخطأ.</p>
      <div className="grid gap-2">{matches.map((m, i) => (
        <button key={i} className="flex justify-between rounded-xl border border-ink-200 px-4 py-3 hover:bg-brand-50 text-start" onClick={() => { onPick(m); onClose(); }}>
          <span>{m.name}<span className="block text-sm text-ink-500">المتوفر: <span className="num">{m.unlimited ? '∞' : m.stock}</span></span></span><span className="num font-bold">{money(m.price)}</span>
        </button>
      ))}</div>
    </Modal>
  );
}

// ===== فحص السعر =====
export function PriceCheckModal({ open, onClose, branchId }: { open: boolean; onClose: () => void; branchId: number }) {
  const [code, setCode] = useState(''); const [res, setRes] = useState<LookupResult[] | null>(null);
  useEffect(() => { if (open) { setCode(''); setRes(null); } }, [open]);
  const check = async () => { if (!code.trim()) return; setRes(await api<LookupResult[]>('/products/lookup', { query: { code: code.trim(), branchId } }).catch(() => [])); setCode(''); };
  return (
    <Modal open={open} onClose={onClose} title="فحص السعر" size="sm">
      <Input autoFocus placeholder="امسح الباركود" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} />
      {res && (res.length ? res.map((r, i) => (
        <div key={i} className="mt-4 rounded-xl bg-brand-50 p-4 text-center">
          <div className="font-bold text-lg">{r.name}</div>
          <div className="text-4xl font-extrabold num text-brand-800 my-2">{money(r.price)}</div>
          <div className="text-sm text-ink-600">المتوفر في الفرع: <span className="num">{r.unlimited ? 'غير محدود' : r.stock}</span></div>
        </div>
      )) : <p className="mt-4 text-center text-red-600">لا يوجد منتج بهذا الباركود.</p>)}
    </Modal>
  );
}

// ===== الفواتير المعلّقة =====
export function HeldModal({ open, onClose, branchId, onResume }: { open: boolean; onClose: () => void; branchId: number; onResume: (data: unknown, id: number) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['held', branchId], queryFn: () => api<Array<{ id: number; label: string | null; data: { lines: Array<{ qty: number; price: number }>; customer?: Customer | null }; createdAt: string }>>('/pos/held', { query: { branchId } }), enabled: open });
  const del = useMutation({ mutationFn: (id: number) => api(`/pos/held/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['held'] }) });
  return (
    <Modal open={open} onClose={onClose} title="الفواتير المعلّقة" size="md">
      {!data ? <Spinner /> : !data.length ? <Empty title="لا فواتير معلّقة" /> : (
        <ul className="divide-y divide-ink-100">{data.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-3 py-3">
            <div><div className="font-medium">{h.label || h.data.customer?.name || `سلة #${h.id}`}</div>
              <div className="text-sm text-ink-500">{h.data.lines.length} بند · <span className="num">{money(h.data.lines.reduce((s, l) => s + l.qty * l.price, 0))}</span> · {time(h.createdAt)}</div></div>
            <div className="flex gap-2"><Button size="sm" onClick={() => { onResume(h.data, h.id); onClose(); }}>استئناف</Button><Button size="sm" variant="ghost" onClick={() => del.mutate(h.id)} aria-label="حذف"><Trash2 className="size-4" /></Button></div>
          </li>
        ))}</ul>
      )}
    </Modal>
  );
}

// ===== آخر الفواتير =====
export function RecentModal({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (id: number) => void }) {
  const [scope, setScope] = useState<'shift' | 'today' | 'all'>('today');
  const query = useMemo(() => ({ mine: 1, limit: 30, from: scope === 'today' ? new Date().toISOString().slice(0, 10) : undefined }), [scope]);
  const { data } = useQuery({ queryKey: ['recent', query], queryFn: () => api<{ rows: Array<{ id: number; number: string; total: number; createdAt: string; customer: string | null; type: string; status: string }> }>('/invoices', { query }), enabled: open });
  return (
    <Modal open={open} onClose={onClose} title="آخر الفواتير" size="md">
      <div className="mb-3"><Segmented value={scope} onChange={setScope} items={[{ value: 'today', label: 'اليوم' }, { value: 'all', label: 'الكل' }]} /></div>
      {!data ? <Spinner /> : !data.rows.length ? <Empty title="الفواتير التي تصدرها من نقطة البيع تظهر هنا." /> : (
        <ul className="divide-y divide-ink-100">{data.rows.map((r) => (
          <li key={r.id}><button className="w-full flex justify-between py-2.5 px-2 hover:bg-ink-50 rounded-lg text-start" onClick={() => onOpen(r.id)}>
            <span><span className="num font-medium">{r.number}</span>{r.type === 'CREDIT_NOTE' && <Badge tone="red">مرتجع</Badge>}<span className="block text-sm text-ink-500">{r.customer ?? 'عميل نقدي'} · {time(r.createdAt)}</span></span>
            <span className="num font-bold">{money(r.total)}</span>
          </button></li>
        ))}</ul>
      )}
    </Modal>
  );
}

// ===== الوردية =====
export function ShiftModal({ open, onClose, branchId, shift }: { open: boolean; onClose: () => void; branchId: number; shift: Shift | null | undefined }) {
  const qc = useQueryClient(); const toast = useToast();
  const [opening, setOpening] = useState<number | null>(0);
  const [entry, setEntry] = useState<{ type: 'CASH_IN' | 'CASH_OUT' | 'EXPENSE'; amount: number | null; note: string } | null>(null);
  const [closing, setClosing] = useState(false); const [counted, setCounted] = useState<number | null>(null); const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['shift'] });
  const openM = useMutation({ mutationFn: () => api('/pos/shift/open', { body: { branchId, openingCash: opening ?? 0 } }), onSuccess: () => { refresh(); toast.success('تم فتح الوردية.'); onClose(); }, onError: toast.error });
  const entryM = useMutation({ mutationFn: () => api(`/pos/shift/${shift!.id}/entry`, { body: { type: entry!.type, amount: entry!.amount, note: entry!.note } }), onSuccess: () => { refresh(); setEntry(null); toast.success('تم التسجيل.'); }, onError: toast.error });
  const closeM = useMutation({ mutationFn: () => api<Shift>(`/pos/shift/${shift!.id}/close`, { body: { countedCash: counted, diffReason: reason || null } }), onSuccess: (s) => { refresh(); setClosing(false); toast.success('تم إغلاق الوردية.'); printStatement(s); onClose(); }, onError: toast.error });
  useEffect(() => { if (open) { setClosing(false); setEntry(null); setCounted(null); setReason(''); } }, [open]);
  const diff = counted != null && shift ? Math.round((counted - shift.expected_cash) * 100) / 100 : null;
  return (
    <Modal open={open} onClose={onClose} title={shift ? 'الوردية الحالية' : 'فتح وردية'} size="md"
      footer={shift ? (closing ? <><Button variant="secondary" onClick={() => setClosing(false)}>إلغاء</Button><Button variant="danger" loading={closeM.isPending} onClick={() => closeM.mutate()}>تأكيد إغلاق الوردية</Button></>
        : <><Button variant="secondary" onClick={() => printStatement(shift)}><Printer className="size-4" />طباعة الكشف</Button><Button variant="danger" onClick={() => setClosing(true)}>إغلاق الوردية</Button></>)
        : <Button loading={openM.isPending} onClick={() => openM.mutate()}>فتح الوردية</Button>}>
      {!shift ? (
        <div className="space-y-3">
          <p className="text-ink-600">افتح وردية ليدخل النقد في درجك ويظهر في كشف الصندوق.</p>
          <NumberInput label="النقد الافتتاحي في الدرج" value={opening} onChange={setOpening} suffix="ر.س" />
        </div>
      ) : closing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-ink-50 p-3"><div className="text-xs text-ink-500">إجمالي المبيعات</div><div className="font-bold num">{money(shift.sales_total)}</div></div>
            <div className="rounded-lg bg-ink-50 p-3"><div className="text-xs text-ink-500">عدد الفواتير</div><div className="font-bold num">{shift.invoices_count}</div></div>
            <div className="rounded-lg bg-brand-50 p-3"><div className="text-xs text-brand-700">النقد المتوقّع</div><div className="font-bold num">{money(shift.expected_cash)}</div></div>
          </div>
          <NumberInput label="النقد المعدود (اختياري)" value={counted} onChange={setCounted} hint="تركه فارغاً يغلق الوردية دون تسجيل عد أو فرق." />
          {diff != null && <p className={clsx('font-bold', diff === 0 ? 'text-emerald-700' : 'text-red-600')}>الفرق: <span className="num">{money(diff)}</span></p>}
          {diff ? <Input label="سبب الفرق" value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm"><Badge tone="green">مفتوحة</Badge><span className="text-ink-500">منذ {dateTime(shift.opened_at)}</span></div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[15px]">
            {[['النقد الافتتاحي', Number(shift.opening_cash)], ['مبيعات نقدية', shift.cash_sales], ['مبيعات الشبكة', shift.card_sales], ['تحويلات', shift.transfer_sales], ['مبيعات آجلة', shift.credit_sales], ['المرتجعات', shift.returns_total], ['إضافات نقدية', shift.cash_in], ['مصروفات وسحوبات', shift.cash_out]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between border-b border-ink-100 py-1"><dt className="text-ink-600">{k}</dt><dd className="num">{money(v as number)}</dd></div>
            ))}
          </dl>
          <div className="rounded-xl bg-brand-50 p-4 flex justify-between"><span className="text-brand-800">النقد المتوقّع في الدرج</span><span className="text-2xl font-extrabold num">{money(shift.expected_cash)}</span></div>
          {entry ? (
            <div className="rounded-xl border border-ink-200 p-3 space-y-3">
              <Select label="نوع الحركة" value={entry.type} onChange={(e) => setEntry({ ...entry, type: e.target.value as 'EXPENSE' })}><option value="EXPENSE">مصروف</option><option value="CASH_IN">إضافة نقد</option><option value="CASH_OUT">سحب نقد</option></Select>
              <NumberInput label="المبلغ" value={entry.amount} onChange={(v) => setEntry({ ...entry, amount: v })} />
              <Input label="ملاحظة" value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} />
              <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setEntry(null)}>إلغاء</Button><Button loading={entryM.isPending} onClick={() => entryM.mutate()}>تسجيل</Button></div>
            </div>
          ) : (
            <div className="flex gap-2"><Button variant="secondary" onClick={() => setEntry({ type: 'EXPENSE', amount: null, note: '' })}>إضافة مصروف</Button><Button variant="secondary" onClick={() => setEntry({ type: 'CASH_IN', amount: null, note: '' })}>إضافة نقدي</Button></div>
          )}
        </div>
      )}
    </Modal>
  );
}

function printStatement(s: Shift) {
  const rows: Array<[string, number]> = [['النقد الافتتاحي', Number(s.opening_cash)], ['مبيعات نقدية', s.cash_sales], ['مبيعات الشبكة', s.card_sales], ['تحويلات', s.transfer_sales], ['مبيعات آجلة', s.credit_sales], ['المرتجعات', s.returns_total], ['إضافات نقدية', s.cash_in], ['مصروفات وسحوبات', s.cash_out], ['النقد المتوقّع', s.expected_cash]];
  if (s.counted_cash != null) rows.push(['النقد المعدود', Number(s.counted_cash)], ['الفرق', Number(s.difference ?? 0)]);
  printHtml(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:0}body{width:80mm;padding:4mm;font-family:Tajawal,Tahoma;font-size:13px}.r{display:flex;justify-content:space-between;border-bottom:1px dashed #999;padding:3px 0}h3{text-align:center;margin:4px 0}.num{direction:ltr}</style></head><body>
    <h3>كشف الوردية #${s.id}</h3><div style="text-align:center">${s.branch_name} — ${s.user_name}</div><div style="text-align:center">${dateTime(s.opened_at)}${s.closed_at ? ` ← ${dateTime(s.closed_at)}` : ''}</div><br>
    ${rows.map(([k, v]) => `<div class="r"><span>${k}</span><span class="num">${money(v)}</span></div>`).join('')}
    <div class="r"><span>عدد الفواتير</span><span class="num">${s.invoices_count}</span></div></body></html>`);
}

// ===== الصرف الداخلي =====
export function IssueModal({ open, onClose, onSubmit, loading }: { open: boolean; onClose: () => void; onSubmit: (v: { reason: string; recipient: string; notes: string }) => void; loading: boolean }) {
  const [reason, setReason] = useState('EMPLOYEE_MEAL'); const [recipient, setRecipient] = useState(''); const [notes, setNotes] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="صرف السلة داخلياً" size="sm" footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button loading={loading} onClick={() => onSubmit({ reason, recipient, notes })}>حفظ واعتماد</Button></>}>
      <p className="text-sm text-ink-600 mb-3">تصرف بنود السلة من مخزون فرعك بلا بيع ولا فاتورة: وجبة موظف أو عينة أو تالف. اختر السبب ثم احفظ.</p>
      <div className="space-y-3">
        <Select label="السبب" value={reason} onChange={(e) => setReason(e.target.value)}><option value="EMPLOYEE_MEAL">وجبة موظف</option><option value="SAMPLE">عينة</option><option value="DAMAGED">تالف</option><option value="GIFT">هدية</option></Select>
        <Input label="المستلم" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        <Textarea label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <p className="text-[13px] text-ink-500">ضريبة التوريد المفترض تُحسب آلياً وفق المادة 15 (الهدايا والعينات وسلع الموظفين معفاة حتى 200 ريال لكل مستلم سنوياً).</p>
      </div>
    </Modal>
  );
}
