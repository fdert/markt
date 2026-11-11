// شاشة الكاشير: بحث وقارئ باركود، سلة، عروض، عملاء، دفع متعدد، وردية، طباعة
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ScanLine, UserPlus, UserRound, Percent, PauseCircle, ListRestart, History, Settings2, Tag, Trash2, Minus, Plus, PackageOpen, Wallet, PenLine, Gift, X, CheckCircle2, Printer, MoreHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, qty as fqty } from '../../lib/format';
import { Badge, Button, IconButton, Modal, Segmented, Textarea, clsx, useDebounced, useToast } from '../../components/ui';
import type { CartLine, Customer, LookupResult, Preview, Shift } from './types';
import { CustomerModal, DiscountModal, DuplicateModal, HeldModal, IssueModal, ManualItemModal, PaymentModal, PriceCheckModal, RecentModal, ShiftModal, UnitsModal, WeightModal, type PayLine } from './PosModals';
import { PrinterSettingsModal, usePrinter, useSettings } from '../print/usePrinter';
import { deviceStore } from '../print/escpos';
import { InvoiceDrawer } from '../../pages/invoices/InvoiceDrawer';

interface GridProduct { id: number; name: string; price: number; image: string | null; barcode: string | null; isWeighted: boolean; pricePerWeight: number | null; unlimited: boolean; stock: number; unitsCount: number; type: string; isComposite: boolean; unitName: string }
type Disc = { discount: { type: 'AMOUNT' | 'PERCENT'; value: number } | null; coupon: string; points: number };

let keySeq = 0;
const newKey = () => `l${++keySeq}`;

export default function PosPage() {
  const { me, branchId, can } = useAuth();
  const nav = useNavigate(); const toast = useToast(); const qc = useQueryClient();
  const printer = usePrinter(); const { data: settings } = useSettings();
  const searchRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [kind, setKind] = useState<'SIMPLIFIED' | 'STANDARD'>('SIMPLIFIED');
  const [disc, setDisc] = useState<Disc>({ discount: null, coupon: '', points: 0 });
  const [notes, setNotes] = useState('');
  const [employeeSale, setEmployeeSale] = useState(false);
  const [heldId, setHeldId] = useState<number | null>(null);
  const [search, setSearch] = useState(''); const dSearch = useDebounced(search, 250);
  const [category, setCategory] = useState<number | null>(null);
  const [modal, setModal] = useState<null | 'pay' | 'customer' | 'discount' | 'manual' | 'price' | 'held' | 'recent' | 'shift' | 'printer' | 'issue' | 'notes' | 'more'>(null);
  const [unitsFor, setUnitsFor] = useState<number | null>(null);
  const [weightFor, setWeightFor] = useState<GridProduct | null>(null);
  const [dupes, setDupes] = useState<LookupResult[]>([]);
  const [success, setSuccess] = useState<{ id: number; number: string; total: number; change: number } | null>(null);
  const [viewInvoice, setViewInvoice] = useState<number | null>(null);
  const [mobileCart, setMobileCart] = useState(false);

  const posSettings = settings?.pos as { requireCustomer?: boolean; allowManualDiscount?: boolean; loyalty?: { enabled: boolean } } | undefined;

  // البيانات
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: number; name: string; parentId: number | null; active: boolean }>>('/categories') });
  const { data: products } = useQuery({ queryKey: ['pos-products', branchId, category, dSearch], queryFn: () => api<GridProduct[]>('/pos/products', { query: { branchId, categoryId: category, search: dSearch, limit: 80 } }), enabled: !!branchId });
  const { data: shift } = useQuery({ queryKey: ['shift', branchId], queryFn: () => api<Shift | null>('/pos/shift/current', { query: { branchId } }), enabled: !!branchId });
  const { data: offers } = useQuery({ queryKey: ['pos-offers'], queryFn: () => api<Array<{ id: number; name: string; badge: string | null }>>('/pos/offers') });

  // معاينة الإجماليات من الخادم (تشمل العروض والضريبة)
  const payload = useMemo(() => ({
    branchId, customerId: customer?.id ?? null, kind, isEmployeeSale: employeeSale,
    lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, price: l.priceOverride || l.manual ? l.price : undefined, name: l.manual ? l.name : undefined, taxable: l.manual?.taxable, lineDiscount: l.lineDiscount })),
    discount: disc.discount, couponCode: disc.coupon || null, loyaltyPoints: disc.points || undefined,
  }), [branchId, customer, kind, employeeSale, lines, disc]);
  const dPayload = useDebounced(payload, 200);
  const { data: preview, error: previewError } = useQuery({ queryKey: ['preview', dPayload], queryFn: () => api<Preview>('/pos/preview', { body: dPayload }), enabled: dPayload.lines.length > 0, retry: false, placeholderData: (p) => p });
  const localTotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const total = lines.length ? (preview?.total ?? localTotal) : 0;

  // إضافة إلى السلة
  const addLine = useCallback((l: Omit<CartLine, 'key'>) => {
    setLines((cur) => {
      const ex = !l.isWeighted && !l.manual ? cur.find((x) => x.productId === l.productId && x.unitId === l.unitId && !x.priceOverride) : undefined;
      if (ex) { setSelected(ex.key); return cur.map((x) => (x === ex ? { ...x, qty: Math.round((x.qty + l.qty) * 1000) / 1000 } : x)); }
      const key = newKey(); setSelected(key); return [...cur, { ...l, key }];
    });
  }, []);

  const addLookup = useCallback((m: LookupResult) => {
    if (!m.unlimited && m.stock <= 0) toast.error(`تنبيه: «${m.name}» نفدت كميته في هذا الفرع.`);
    if (m.isWeighted && !m.qty) { setWeightFor({ id: m.productId, name: m.name, price: m.price } as GridProduct); return; }
    addLine({ productId: m.productId, unitId: m.unitId, name: m.name, price: m.price, qty: m.qty ?? 1, isWeighted: m.isWeighted, stock: m.stock, unlimited: m.unlimited, barcode: m.barcode });
  }, [addLine, toast]);

  const scan = useCallback(async (code: string) => {
    code = code.trim(); if (!code) return;
    try {
      const res = await api<LookupResult[]>('/products/lookup', { query: { code, branchId } });
      if (!res.length) { setSearch(code); toast.error('لا يوجد منتج بهذا الباركود.'); return; }
      if (res.length > 1) { setDupes(res); return; }
      addLookup(res[0]); setSearch('');
    } catch (e) { toast.error(e); }
  }, [branchId, addLookup, toast]);

  const clickProduct = (p: GridProduct) => {
    if (p.unitsCount > 0) { setUnitsFor(p.id); return; }
    if (p.isWeighted) { setWeightFor({ ...p, price: p.pricePerWeight ?? p.price }); return; }
    if (!p.unlimited && !p.isComposite && p.type !== 'SERVICE' && p.stock <= 0) toast.error(`تنبيه: «${p.name}» نفدت كميته في هذا الفرع.`);
    addLine({ productId: p.id, unitId: null, name: p.name, price: p.price, qty: 1, stock: p.stock, unlimited: p.unlimited, barcode: p.barcode });
  };

  const updateQty = (key: string, q: number) => setLines((cur) => q <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, qty: Math.round(q * 1000) / 1000 } : l)));
  const removeLine = (key: string) => setLines((cur) => { const i = cur.findIndex((l) => l.key === key); const next = cur.filter((l) => l.key !== key); setSelected(next[Math.max(0, i - 1)]?.key ?? null); return next; });
  const reset = () => { setLines([]); setCustomer(null); setKind('SIMPLIFIED'); setDisc({ discount: null, coupon: '', points: 0 }); setNotes(''); setEmployeeSale(false); setHeldId(null); setSelected(null); searchRef.current?.focus(); };

  // إصدار الفاتورة
  const issue = useMutation({
    mutationFn: (payments: PayLine[]) => api<{ id: number; number: string; total: number; change: number } & Record<string, unknown>>('/invoices', { body: { ...payload, payments, notes: notes || null } }),
    onSuccess: async (inv) => {
      setModal(null);
      if (heldId) api(`/pos/held/${heldId}`, { method: 'DELETE' }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['shift'] }); qc.invalidateQueries({ queryKey: ['pos-products'] });
      const dev = deviceStore.get();
      if (dev.autoPrint) printer.print(inv as never).catch(toast.error);
      else if (dev.openDrawer && payload.lines.length) printer.openDrawer().catch(() => undefined);
      if (dev.skipSuccess) toast.success(`تم إصدار الفاتورة ${inv.number}${inv.change ? ` — الباقي ${money(inv.change)}` : ''}.`);
      else setSuccess({ id: inv.id, number: inv.number, total: inv.total, change: inv.change });
      reset();
    },
    onError: toast.error,
  });
  const quickPay = (method: 'CASH' | 'CARD') => { if (!lines.length) return; if (posSettings?.requireCustomer && !customer) { setModal('customer'); return; } issue.mutate([{ method, amount: total }]); };
  const openPay = () => {
    if (!lines.length) return toast.error('السلة فارغة. أضف منتجاً واحداً على الأقل.');
    if (previewError) return toast.error(previewError);
    if ((posSettings?.requireCustomer || kind === 'STANDARD') && !customer) { toast.error('اختر العميل قبل إصدار الفاتورة.'); setModal('customer'); return; }
    setModal('pay');
  };

  const hold = useMutation({
    mutationFn: () => api('/pos/held', { body: { branchId, label: customer?.name ?? null, data: { lines, customer, disc, notes, kind } } }),
    onSuccess: () => { toast.success('تم تعليق الفاتورة.'); reset(); qc.invalidateQueries({ queryKey: ['held'] }); }, onError: toast.error,
  });
  const issueInternal = useMutation({
    mutationFn: (v: { reason: string; recipient: string; notes: string }) => api<{ number: string }>('/pos/issue', { body: { branchId, ...v, lines: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty })) } }),
    onSuccess: (r) => { toast.success(`تم الصرف الداخلي ${r.number}.`); setModal(null); reset(); }, onError: toast.error,
  });

  // اختصارات لوحة المفاتيح وقارئ الباركود
  const buffer = useRef({ text: '', last: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role=dialog]')) return;
      const keyMap: Record<string, () => void> = {
        F2: () => setModal('price'), F3: () => selected && removeLine(selected), F4: openPay, F6: () => setModal('manual'),
        F7: () => setModal('discount'), F8: () => quickPay('CASH'), F9: () => quickPay('CARD'), F10: () => lines.length && hold.mutate(),
      };
      if (keyMap[e.key]) { e.preventDefault(); keyMap[e.key](); return; }
      const target = e.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      if (target === searchRef.current) {
        if (e.key === 'Escape') { setSearch(''); return; }
      } else if (!inField) {
        // قارئ الباركود يكتب بسرعة عالية ثم Enter
        const now = Date.now();
        if (e.key.length === 1) { buffer.current.text = now - buffer.current.last > 60 ? e.key : buffer.current.text + e.key; buffer.current.last = now; }
        if (e.key === 'Enter' && buffer.current.text.length >= 4 && now - buffer.current.last < 100) { e.preventDefault(); scan(buffer.current.text); buffer.current.text = ''; return; }
      }
      if (inField && target !== searchRef.current) return;
      const idx = lines.findIndex((l) => l.key === selected);
      if (e.key === 'ArrowDown' && lines.length) { e.preventDefault(); setSelected(lines[Math.min(lines.length - 1, idx + 1)].key); }
      if (e.key === 'ArrowUp' && lines.length) { e.preventDefault(); setSelected(lines[Math.max(0, idx - 1)].key); }
      if ((e.key === '+' || e.key === '-') && selected && !search) { e.preventDefault(); const l = lines[idx]; if (l) updateQty(l.key, l.qty + (e.key === '+' ? 1 : -1)); }
      if (e.key === 'Delete' && selected && !search) { e.preventDefault(); removeLine(selected); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // يُعاد التسجيل عند كل تحديث للحصول على أحدث الحالة

  useEffect(() => { searchRef.current?.focus(); }, []);
  const rootCats = (categories ?? []).filter((c) => c.active && !c.parentId);
  const lineInfo = (i: number) => preview?.lines[i];

  if (!me) return null;
  return (
    <div className="h-screen flex flex-col bg-ink-100 overflow-hidden">
      {/* الشريط العلوي */}
      <header className="h-14 shrink-0 bg-white border-b border-ink-200 flex items-center gap-2 px-3">
        <IconButton label="رجوع للوحة التحكم" onClick={() => nav('/')}><ArrowRight className="size-5" /></IconButton>
        <h1 className="font-extrabold text-lg whitespace-nowrap">نقطة البيع</h1>
        <span className="hidden md:inline text-sm text-ink-500">{me.branches.find((b) => b.id === branchId)?.name}</span>
        <button onClick={() => setModal('shift')} className={clsx('ms-2 inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-sm font-medium whitespace-nowrap', shift ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
          <span className={clsx('size-2 rounded-full', shift ? 'bg-emerald-500' : 'bg-amber-500')} />{shift ? 'الوردية مفتوحة' : 'لا توجد وردية'}
        </button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setModal('price')}><Tag className="size-4" /><span className="hidden lg:inline">فحص السعر</span><kbd className="hidden lg:inline text-xs text-ink-400">F2</kbd></Button>
        <IconButton label="الفواتير المعلّقة" onClick={() => setModal('held')}><ListRestart className="size-5" /></IconButton>
        <IconButton label="آخر الفواتير" onClick={() => setModal('recent')}><History className="size-5" /></IconButton>
        <IconButton label="إعدادات الطباعة" onClick={() => setModal('printer')}><Settings2 className="size-5" /></IconButton>
      </header>

      {!shift && shift !== undefined && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-2 flex items-center justify-between gap-3">
          <span>لا توجد وردية مفتوحة لحسابك: النقد في هذه الفاتورة لن يدخل أي درج. الأفضل فتح وردية.</span>
          <Button size="sm" onClick={() => setModal('shift')}>فتح وردية</Button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* المنتجات */}
        <section className="flex-1 flex flex-col min-w-0 p-3 gap-3" aria-label="المنتجات">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute top-1/2 -translate-y-1/2 start-3 size-5 text-ink-400 pointer-events-none" />
              <input ref={searchRef} type="search" className="input !h-12 !text-base ps-11" placeholder="ابحث بالاسم أو امسح الباركود…" aria-label="بحث المنتجات أو مسح الباركود"
                value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (/^\d{4,}$/.test(search.trim())) scan(search); else if (products?.length === 1) { clickProduct(products[0]); setSearch(''); } else scan(search); } }} />
            </div>
            <Button variant="secondary" className="!h-12" onClick={() => setModal('customer')} aria-label="اختيار عميل">
              {customer ? <UserRound className="size-5 text-brand-700" /> : <UserPlus className="size-5" />}<span className="hidden sm:inline max-w-[140px] truncate">{customer?.name ?? 'عميل'}</span>
            </Button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="التصنيفات">
            <button role="tab" aria-selected={category === null} onClick={() => setCategory(null)} className={clsx('shrink-0 rounded-lg px-4 h-9 text-sm font-medium border', category === null ? 'bg-brand-700 text-white border-brand-700' : 'bg-white border-ink-200 hover:bg-ink-50')}>الكل</button>
            {rootCats.map((c) => (
              <button key={c.id} role="tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)} className={clsx('shrink-0 rounded-lg px-4 h-9 text-sm font-medium border', category === c.id ? 'bg-brand-700 text-white border-brand-700' : 'bg-white border-ink-200 hover:bg-ink-50')}>{c.name}</button>
            ))}
          </div>
          {offers && offers.length > 0 && <div className="flex gap-2 flex-wrap text-sm"><Gift className="size-4 text-brand-700" />{offers.map((o) => <Badge key={o.id} tone="brand">{o.badge || o.name}</Badge>)}</div>}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 content-start pb-20 lg:pb-2">
            {products?.map((p) => {
              const out = !p.unlimited && !p.isComposite && p.type !== 'SERVICE' && p.stock <= 0;
              return (
                <button key={p.id} onClick={() => clickProduct(p)} className="group relative bg-white rounded-xl border border-ink-200 p-2 text-start hover:border-brand-500 hover:shadow-card transition flex flex-col">
                  <div className="aspect-[4/3] rounded-lg bg-ink-50 flex items-center justify-center overflow-hidden mb-2">
                    {p.image ? <img src={p.image} alt="" className="size-full object-cover" loading="lazy" /> : <span className="text-3xl font-extrabold text-ink-300">{p.name.slice(0, 1)}</span>}
                  </div>
                  {out && <span className="absolute top-3 end-3"><Badge tone="red">نفدت الكمية</Badge></span>}
                  {p.unitsCount > 0 && <span className="absolute top-3 start-3"><Badge tone="blue">وحدات</Badge></span>}
                  <span className="text-[14px] leading-snug line-clamp-2 min-h-[2.6em]">{p.name}</span>
                  <span className="flex items-center justify-between mt-1">
                    <span className="font-extrabold num text-brand-800">{money(p.isWeighted ? p.pricePerWeight ?? p.price : p.price)}{p.isWeighted && <small className="text-ink-500 font-normal"> /كجم</small>}</span>
                    {!p.unlimited && p.type !== 'SERVICE' && !p.isComposite && <span className="text-xs text-ink-500 num">{fqty(p.stock)}</span>}
                  </span>
                </button>
              );
            })}
            {products && !products.length && <div className="col-span-full text-center text-ink-500 py-16"><PackageOpen className="size-10 mx-auto mb-2 text-ink-300" />لا توجد منتجات مطابقة</div>}
          </div>
        </section>

        {/* السلة */}
        <aside className={clsx('w-full lg:w-[420px] shrink-0 bg-white border-s border-ink-200 flex-col', mobileCart ? 'fixed inset-0 z-30 flex' : 'hidden lg:flex')} aria-label="السلة">
          <div className="flex items-center justify-between px-4 h-12 border-b border-ink-100">
            <div className="flex items-center gap-2"><h2 className="font-bold">السلة</h2><span className="text-sm text-ink-500 num">({lines.length})</span></div>
            <div className="flex items-center gap-1">
              <Segmented value={kind} onChange={(v) => { setKind(v); if (v === 'STANDARD' && !customer) setModal('customer'); }} items={[{ value: 'SIMPLIFIED', label: 'مبسطة' }, { value: 'STANDARD', label: 'ضريبية' }]} />
              {lines.length > 0 && <IconButton label="تفريغ السلة" onClick={reset}><Trash2 className="size-4" /></IconButton>}
              <IconButton label="إغلاق السلة" className="lg:hidden" onClick={() => setMobileCart(false)}><X className="size-5" /></IconButton>
            </div>
          </div>
          {customer && (
            <div className="mx-3 mt-2 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm">
              <span><UserRound className="inline size-4 me-1 text-brand-700" />{customer.name}{customer.vatNumber && <span className="text-ink-500 num"> · {customer.vatNumber}</span>}</span>
              <button aria-label="إزالة العميل" onClick={() => { setCustomer(null); setKind('SIMPLIFIED'); }}><X className="size-4" /></button>
            </div>
          )}
          <ul className="flex-1 overflow-y-auto px-2 py-2" role="listbox" aria-label="بنود السلة">
            {lines.map((l, i) => {
              const info = lineInfo(i);
              return (
                <li key={l.key} role="option" aria-selected={selected === l.key} onClick={() => setSelected(l.key)}
                  className={clsx('rounded-lg px-2 py-2 mb-1 border cursor-pointer', selected === l.key ? 'border-brand-500 bg-brand-50/50' : 'border-transparent hover:bg-ink-50')}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[14px] font-medium leading-snug">{l.name}</span>
                    <button aria-label={`حذف ${l.name}`} className="text-ink-400 hover:text-red-600 shrink-0" onClick={(e) => { e.stopPropagation(); removeLine(l.key); }}><X className="size-4" /></button>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center gap-1">
                      <button aria-label="إنقاص الكمية" className="size-8 rounded-lg border border-ink-200 flex items-center justify-center hover:bg-ink-100" onClick={(e) => { e.stopPropagation(); updateQty(l.key, l.qty - (l.isWeighted ? 0.1 : 1)); }}><Minus className="size-4" /></button>
                      <input aria-label="الكمية" inputMode="decimal" className="w-16 h-8 text-center rounded-lg border border-ink-200 num" value={l.qty} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, '')); if (!isNaN(v)) updateQty(l.key, v || 0.001); }} />
                      <button aria-label="زيادة الكمية" className="size-8 rounded-lg border border-ink-200 flex items-center justify-center hover:bg-ink-100" onClick={(e) => { e.stopPropagation(); updateQty(l.key, l.qty + (l.isWeighted ? 0.1 : 1)); }}><Plus className="size-4" /></button>
                      <span className="text-xs text-ink-500 ms-1">× {can('pos.price_override') ? (
                        <input aria-label="السعر" className="w-16 h-7 text-center rounded border border-ink-200 num" defaultValue={l.price} onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => { const v = Number(e.target.value); if (v >= 0 && v !== l.price) setLines((cur) => cur.map((x) => x.key === l.key ? { ...x, price: v, priceOverride: true } : x)); }} />
                      ) : <span className="num">{money(l.price)}</span>}</span>
                    </div>
                    <div className="text-end">
                      {info && info.offerDiscount > 0 && <div className="text-xs text-emerald-700 line-through num">{money(l.qty * l.price)}</div>}
                      <span className="font-bold num">{money(info?.total ?? l.qty * l.price)}</span>
                    </div>
                  </div>
                  {info?.offerName && <div className="text-xs text-emerald-700 mt-1"><Gift className="inline size-3" /> {info.offerName}</div>}
                </li>
              );
            })}
            {!lines.length && <li className="text-center text-ink-400 py-16"><ScanLine className="size-10 mx-auto mb-2" />امسح باركود منتج أو اختره من القائمة</li>}
          </ul>

          <div className="border-t border-ink-200 p-3 space-y-2">
            <div className="grid grid-cols-4 gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => setModal('discount')} disabled={!lines.length}><Percent className="size-4" />خصم</Button>
              <Button variant="secondary" size="sm" onClick={() => setModal('manual')}><PenLine className="size-4" />بند</Button>
              <Button variant="secondary" size="sm" onClick={() => hold.mutate()} disabled={!lines.length}><PauseCircle className="size-4" />تعليق</Button>
              <Button variant="secondary" size="sm" onClick={() => setModal('more')}><MoreHorizontal className="size-4" />المزيد</Button>
            </div>
            {previewError && <p className="text-sm text-red-600" role="alert">{(previewError as Error).message}</p>}
            <dl className="text-[14px] space-y-1">
              <div className="flex justify-between"><dt className="text-ink-600">قبل الضريبة</dt><dd className="num">{money(preview && lines.length ? preview.subtotal : 0)}</dd></div>
              {preview && preview.discount > 0 && lines.length > 0 && <div className="flex justify-between text-emerald-700"><dt>الخصومات والعروض</dt><dd className="num">−{money(preview.discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-600">الضريبة</dt><dd className="num">{money(preview && lines.length ? preview.taxTotal : 0)}</dd></div>
            </dl>
            <div className="flex items-center justify-between pt-1"><span className="font-bold text-lg">الإجمالي</span><span className="text-3xl font-extrabold num">{money(total)}</span></div>
            <div className="grid grid-cols-[1fr_1fr_2fr] gap-2">
              <Button variant="secondary" className="!h-12" onClick={() => quickPay('CASH')} disabled={!lines.length || issue.isPending} title="F8">نقدي</Button>
              <Button variant="secondary" className="!h-12" onClick={() => quickPay('CARD')} disabled={!lines.length || issue.isPending} title="F9">شبكة</Button>
              <Button className="!h-12 !text-lg" onClick={openPay} loading={issue.isPending} disabled={!lines.length}><Wallet className="size-5" />الدفع <kbd className="text-xs opacity-70">F4</kbd></Button>
            </div>
            <p className="hidden xl:block text-[11.5px] text-ink-400 text-center">F2 فحص السعر · F3 حذف · F4 الدفع · F6 بند يدوي · F7 الخصم · F8 نقدي · F9 شبكة · F10 تعليق · ↑↓ تنقّل · +/− كمية</p>
          </div>
        </aside>
      </div>

      {/* زر السلة للجوال */}
      {!mobileCart && (
        <button className="lg:hidden fixed bottom-3 inset-x-3 z-20 btn-primary !h-14 !text-lg shadow-pop" onClick={() => setMobileCart(true)}>
          السلة ({lines.length}) — <span className="num">{money(total)}</span>
        </button>
      )}

      <PaymentModal open={modal === 'pay'} onClose={() => setModal(null)} total={total} hasCustomer={!!customer} loading={issue.isPending} onPay={(p) => issue.mutate(p)} />
      <CustomerModal open={modal === 'customer'} onClose={() => setModal(null)} onSelect={setCustomer} />
      <DiscountModal open={modal === 'discount'} onClose={() => setModal(null)} value={disc} onApply={setDisc} customer={customer} loyaltyEnabled={!!posSettings?.loyalty?.enabled} />
      <ManualItemModal open={modal === 'manual'} onClose={() => setModal(null)} onAdd={(v) => addLine({ productId: null, unitId: null, name: v.name, price: v.price, qty: v.qty, manual: { taxable: v.taxable } })} />
      <PriceCheckModal open={modal === 'price'} onClose={() => setModal(null)} branchId={branchId} />
      <HeldModal open={modal === 'held'} onClose={() => setModal(null)} branchId={branchId} onResume={(d, id) => {
        const data = d as { lines: CartLine[]; customer: Customer | null; disc: Disc; notes: string; kind: 'SIMPLIFIED' | 'STANDARD' };
        setLines(data.lines.map((l) => ({ ...l, key: newKey() }))); setCustomer(data.customer); setDisc(data.disc ?? { discount: null, coupon: '', points: 0 }); setNotes(data.notes ?? ''); setKind(data.kind ?? 'SIMPLIFIED'); setHeldId(id);
      }} />
      <RecentModal open={modal === 'recent'} onClose={() => setModal(null)} onOpen={(id) => { setModal(null); setViewInvoice(id); }} />
      <ShiftModal open={modal === 'shift'} onClose={() => setModal(null)} branchId={branchId} shift={shift} />
      <PrinterSettingsModal open={modal === 'printer'} onClose={() => setModal(null)} />
      <IssueModal open={modal === 'issue'} onClose={() => setModal(null)} loading={issueInternal.isPending} onSubmit={(v) => issueInternal.mutate(v)} />
      <UnitsModal productId={unitsFor} onClose={() => setUnitsFor(null)} onPick={(u) => addLine({ productId: unitsFor, unitId: u.unitId, name: u.name, price: u.price, qty: 1, barcode: u.barcode })} />
      <WeightModal product={weightFor} onClose={() => setWeightFor(null)} onAdd={(w) => weightFor && addLine({ productId: weightFor.id, unitId: null, name: weightFor.name, price: weightFor.price, qty: w, isWeighted: true })} />
      <DuplicateModal matches={dupes} onClose={() => setDupes([])} onPick={addLookup} />
      <InvoiceDrawer id={viewInvoice} onClose={() => setViewInvoice(null)} />

      <Modal open={modal === 'notes'} onClose={() => setModal(null)} title="ملاحظة تُطبع على الفاتورة" size="sm" footer={<Button onClick={() => setModal(null)}>حفظ</Button>}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Modal>
      <Modal open={modal === 'more'} onClose={() => setModal(null)} title="خيارات إضافية" size="sm">
        <div className="grid gap-2">
          <Button variant="secondary" onClick={() => setModal('notes')}><PenLine className="size-4" />ملاحظة على الفاتورة{notes && ' ✓'}</Button>
          <Button variant="secondary" onClick={() => { setEmployeeSale((v) => !v); setModal(null); }}>{employeeSale ? 'إلغاء بيع الموظف' : 'بيع لموظف بسعر التكلفة (المادة 38)'}</Button>
          {can('pos.issue', 'inventory.adjust') && <Button variant="secondary" disabled={!lines.length} onClick={() => setModal('issue')}>صرف السلة داخلياً</Button>}
          <Button variant="secondary" onClick={() => printer.openDrawer().then(() => toast.success('تم فتح الدرج.')).catch(toast.error)}>فتح درج النقود</Button>
          <Button variant="secondary" onClick={() => setModal('shift')}>الوردية والصندوق</Button>
          <Link to="/invoices" className="btn-secondary">كل الفواتير</Link>
        </div>
      </Modal>
      {employeeSale && <div className="fixed top-16 start-1/2 -translate-x-1/2 z-20"><Badge tone="amber">بيع موظف: البنود بسعر التكلفة</Badge></div>}

      <Modal open={!!success} onClose={() => { setSuccess(null); searchRef.current?.focus(); }} title="تم إصدار الفاتورة" size="sm"
        footer={<><Button variant="secondary" onClick={() => { const id = success!.id; setSuccess(null); api(`/invoices/${id}`).then((inv) => printer.print(inv as never)).catch(toast.error); }}><Printer className="size-4" />طباعة</Button><Button data-autofocus onClick={() => { setSuccess(null); searchRef.current?.focus(); }}>فاتورة جديدة</Button></>}>
        {success && (
          <div className="text-center py-2">
            <CheckCircle2 className="size-14 text-emerald-600 mx-auto mb-2" />
            <div className="text-ink-600">رقم الفاتورة <b className="num">{success.number}</b></div>
            <div className="text-3xl font-extrabold num my-2">{money(success.total)}</div>
            {success.change > 0 && <div className="rounded-xl bg-emerald-50 p-3 mt-2"><div className="text-sm text-emerald-700">الباقي للعميل</div><div className="text-3xl font-extrabold num text-emerald-800">{money(success.change)}</div></div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
