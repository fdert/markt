// محرّر المنتج: أساسي، الوحدات، الوصفة (منتج مركب)، المخزون وبطاقة الصنف
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, qty, dateTime } from '../../lib/format';
import { Badge, Button, Drawer, Empty, Input, Modal, NumberInput, Segmented, Select, Spinner, Tabs, Textarea, Toggle, useDebounced, useToast } from '../../components/ui';

export interface ProductForm {
  id?: number; type: string; name: string; nameEn?: string | null; sku?: string | null; barcode?: string | null; categoryId?: number | null; brandId?: number | null; unitName: string;
  price: number | null; cost: number | null; taxIncluded: boolean; taxable: boolean; isWeighted: boolean; pricePerWeight?: number | null; unlimited: boolean; expiryDate?: string | null;
  posEnabled: boolean; onlineEnabled: boolean; requiresShipping: boolean; nonReturnable: boolean; lowStockAlert?: number | null; isComposite: boolean;
  rentalRate?: number | null; rentalUnit?: string | null; depositAmount?: number | null; description?: string | null; image?: string | null; active: boolean; avgCost?: number;
  units: Array<{ id?: number; name: string; factor: number; price: number; barcode?: string | null; active: boolean }>;
  recipe: Array<{ componentId: number; qty: number; name?: string; cost?: number; unitName?: string }>;
  stocks?: Array<{ branchId: number; branchName: string; branchType: string; isDefault: boolean; qty: number | null; counted: boolean | null; alertLevel: number | null }>;
}

const blank = (type = 'SIMPLE'): ProductForm => ({ type, name: '', unitName: 'حبة', price: null, cost: 0, taxIncluded: true, taxable: true, isWeighted: false, unlimited: type === 'SERVICE' || type === 'DIGITAL', posEnabled: true, onlineEnabled: true, requiresShipping: type === 'SIMPLE' || type === 'PRO', nonReturnable: false, isComposite: false, active: true, units: [], recipe: [], rentalUnit: 'DAY' });

const PRESETS: Record<string, Array<{ name: string; factor: number }>> = {
  'بقالة ومشروبات': [{ name: 'علبة', factor: 6 }, { name: 'كرتون', factor: 24 }],
  'ملابس — مقاسات': ['S', 'M', 'L', 'XL'].map((n) => ({ name: n, factor: 1 })),
  'بالوزن — قهوة وبهارات': [{ name: '250 جم', factor: 0.25 }, { name: '500 جم', factor: 0.5 }, { name: '1 كجم', factor: 1 }],
  'عطور': [{ name: '50 مل', factor: 1 }, { name: '100 مل', factor: 1 }],
  'مطاعم ومقاهي': [{ name: 'صغير', factor: 1 }, { name: 'وسط', factor: 1 }, { name: 'كبير', factor: 1 }],
};

export function ProductEditor({ id, type, onClose }: { id: number | 'new' | null; type?: string; onClose: () => void }) {
  const { branchId, me, can } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const [tab, setTab] = useState<'basic' | 'units' | 'recipe' | 'stock'>('basic');
  const [f, setF] = useState<ProductForm>(blank(type));
  const [opening, setOpening] = useState<number | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['product', id], queryFn: () => api<ProductForm>(`/products/${id}`), enabled: typeof id === 'number' });
  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: number; name: string }>>('/categories') });
  useEffect(() => { setTab('basic'); setOpening(null); if (id === 'new') setF(blank(type)); }, [id, type]);
  useEffect(() => { if (data) setF({ ...blank(), ...data, expiryDate: data.expiryDate?.slice(0, 10) ?? null, units: data.units ?? [], recipe: data.recipe ?? [] }); }, [data]);
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: () => api<{ product: { id: number }; warnings: string[] }>(typeof id === 'number' ? `/products/${id}` : '/products', {
      method: typeof id === 'number' ? 'PUT' : 'POST',
      body: { ...f, stocks: undefined, avgCost: undefined, price: f.price ?? 0, cost: f.cost ?? 0, recipe: f.isComposite ? f.recipe.map((r) => ({ componentId: r.componentId, qty: r.qty })) : [], openingStock: id === 'new' && opening ? [{ branchId, qty: opening }] : undefined },
    }),
    onSuccess: (r) => { r.warnings.forEach((w) => toast.error(w)); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['product'] }); toast.success('تم الحفظ.'); onClose(); },
    onError: toast.error,
  });
  const margin = f.price && f.cost ? ((f.price / (f.taxIncluded ? 1.15 : 1) - f.cost) / (f.price / (f.taxIncluded ? 1.15 : 1))) * 100 : null;
  const recipeCost = f.recipe.reduce((s, r) => s + (r.cost ?? 0) * r.qty, 0);
  const typeLabel = { SIMPLE: 'بسيط', PRO: 'احترافي', SERVICE: 'خدمة', RENTAL: 'إيجار', DIGITAL: 'رقمي' }[f.type];
  return (
    <Drawer open={id !== null} onClose={onClose} width="max-w-3xl" title={id === 'new' ? `إضافة منتج ${typeLabel}` : 'تعديل المنتج'}
      footer={<><Button loading={save.isPending} onClick={() => save.mutate()} disabled={!can('products.manage')}>حفظ</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      {isLoading ? <Spinner /> : (
        <>
          <Tabs value={tab} onChange={setTab} items={[{ value: 'basic', label: 'أساسي' }, { value: 'units', label: 'الوحدات', count: f.units.length || undefined }, { value: 'recipe', label: 'تكوين المنتج (الوصفة)' }, ...(typeof id === 'number' ? [{ value: 'stock' as const, label: 'المخزون' }] : [])]} />
          {tab === 'basic' && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-3">
                <Input label="اسم المنتج" required value={f.name} onChange={(e) => set('name', e.target.value)} />
                <Input label="الاسم بالإنجليزية" dir="ltr" value={f.nameEn ?? ''} onChange={(e) => set('nameEn', e.target.value)} hint="اختياري — إن تُرك فارغاً يُعرض الاسم العربي." />
                <div className="flex gap-2 items-end">
                  <Input label="الباركود" dir="ltr" value={f.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} className="flex-1" />
                  <Button variant="secondary" aria-label="توليد باركود" title="توليد باركود" onClick={() => set('barcode', '2' + String(Date.now()).slice(-11))}><Wand2 className="size-4" /></Button>
                </div>
                <Input label="رمز الصنف (SKU)" dir="ltr" value={f.sku ?? ''} onChange={(e) => set('sku', e.target.value)} />
                <Select label="التصنيف" value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">بلا تصنيف</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Input label="وحدة القياس" value={f.unitName} onChange={(e) => set('unitName', e.target.value)} />
              </div>
              <fieldset className="grid sm:grid-cols-3 gap-3">
                <legend className="font-bold mb-2">التسعير</legend>
                <NumberInput label={f.type === 'RENTAL' ? 'السعر الأساسي' : 'سعر البيع'} suffix="ر.س" value={f.price} onChange={(v) => set('price', v)} required />
                <NumberInput label="سعر التكلفة" suffix="ر.س" value={f.cost} onChange={(v) => set('cost', v)} hint={margin != null ? `هامش الربح: ${margin.toFixed(1)}%` : undefined} />
                {typeof id === 'number' && <Input label="متوسط التكلفة" value={money(f.avgCost)} disabled hint="يُحدَّث آلياً من المشتريات." />}
              </fieldset>
              <div className="grid sm:grid-cols-2 gap-x-6">
                <Toggle checked={f.taxIncluded} onChange={(v) => set('taxIncluded', v)} label="السعر شامل الضريبة" />
                <Toggle checked={f.taxable} onChange={(v) => set('taxable', v)} label="خاضع لضريبة القيمة المضافة" hint="أطفئه للسلع المعفاة أو الصفرية." />
                <Toggle checked={f.posEnabled} onChange={(v) => set('posEnabled', v)} label="متاح في نقاط البيع" />
                <Toggle checked={f.onlineEnabled} onChange={(v) => set('onlineEnabled', v)} label="متاح في المتجر الإلكتروني" />
                <Toggle checked={f.unlimited} onChange={(v) => set('unlimited', v)} label="كمية غير محدودة" hint="لا يُتابَع مخزونه (خدمات ومنتجات تُحضَّر)." />
                <Toggle checked={f.nonReturnable} onChange={(v) => set('nonReturnable', v)} label="غير قابل للإرجاع" hint="يمنع المرتجع لهذا المنتج (مثل الأطعمة المحضّرة)." />
                <Toggle checked={f.requiresShipping} onChange={(v) => set('requiresShipping', v)} label="المنتج يتطلب شحناً" />
                <Toggle checked={f.active} onChange={(v) => set('active', v)} label="المنتج مفعّل" />
              </div>
              <fieldset className="space-y-3">
                <legend className="font-bold mb-1">المنتج الموزون</legend>
                <Toggle checked={f.isWeighted} onChange={(v) => set('isWeighted', v)} label="منتج موزون (يُباع بالوزن)" hint="عند البيع يُدخَل الوزن رقماً عشرياً فيُحسب السعر = الوزن × سعر الوزن. يقبل باركود الميزان تلقائياً." />
                {f.isWeighted && <NumberInput label="السعر لكل كيلو" suffix="ر.س" value={f.pricePerWeight ?? null} onChange={(v) => set('pricePerWeight', v)} hint="رمز الصنف في باركود الميزان = الباركود المسجّل هنا (5 أرقام)." />}
              </fieldset>
              {f.type === 'RENTAL' && (
                <fieldset className="grid sm:grid-cols-3 gap-3">
                  <legend className="font-bold mb-2">الإيجار</legend>
                  <NumberInput label="سعر الإيجار" suffix="ر.س" value={f.rentalRate ?? null} onChange={(v) => set('rentalRate', v)} />
                  <Select label="وحدة الإيجار" value={f.rentalUnit ?? 'DAY'} onChange={(e) => set('rentalUnit', e.target.value)}><option value="HOUR">ساعة</option><option value="DAY">يوم</option><option value="WEEK">أسبوع</option><option value="MONTH">شهر</option></Select>
                  <NumberInput label="مبلغ التأمين" suffix="ر.س" value={f.depositAmount ?? null} onChange={(v) => set('depositAmount', v)} />
                </fieldset>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <Input label="تاريخ الصلاحية" type="date" value={f.expiryDate ?? ''} onChange={(e) => set('expiryDate', e.target.value || null)} />
                <NumberInput label="حد تنبيه نقص الكمية" value={f.lowStockAlert ?? null} onChange={(v) => set('lowStockAlert', v)} hint="يتجاوز الحد العام في خيارات المتجر." />
                {id === 'new' && !f.unlimited && <NumberInput label={`الكمية الافتتاحية (${me?.branches.find((b) => b.id === branchId)?.name ?? ''})`} value={opening} onChange={setOpening} />}
                <Input label="رابط صورة المنتج" dir="ltr" value={f.image ?? ''} onChange={(e) => set('image', e.target.value || null)} hint="أو ارفع صورة:" />
              </div>
              <input type="file" accept="image/*" aria-label="رفع صورة المنتج" className="text-sm" onChange={(e) => {
                const file = e.target.files?.[0]; if (!file) return;
                if (file.size > 2_000_000) { toast.error('حجم الصورة أكبر من 2 ميجابايت.'); return; }
                const rd = new FileReader(); rd.onload = () => set('image', String(rd.result)); rd.readAsDataURL(file);
              }} />
              {f.image && <img src={f.image} alt="صورة المنتج" className="size-24 rounded-lg object-cover border border-ink-200" />}
              <Textarea label="وصف المنتج" value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} />
            </div>
          )}
          {tab === 'units' && <UnitsTab f={f} setUnits={(u) => set('units', u)} />}
          {tab === 'recipe' && <RecipeTab f={f} set={set} recipeCost={recipeCost} />}
          {tab === 'stock' && typeof id === 'number' && <StockTab id={id} f={f} />}
        </>
      )}
    </Drawer>
  );
}

function UnitsTab({ f, setUnits }: { f: ProductForm; setUnits: (u: ProductForm['units']) => void }) {
  const [presets, setPresets] = useState(false);
  const upd = (i: number, k: string, v: unknown) => setUnits(f.units.map((u, j) => (j === i ? { ...u, [k]: v } : u)));
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">الوحدة شكل لبيع المنتج نفسه بسعر وباركود مستقلين. مثال: حليب يُباع بالحبة (2 ريال) وبالعلبة = 6 حبات (10 ريال) وبالكرتون = 24 حبة (36 ريال). يُخصم من المخزون بعدد الحبات.</p>
      <div className="flex gap-2"><Button variant="secondary" onClick={() => setUnits([...f.units, { name: '', factor: 1, price: 0, barcode: '', active: true }])}><Plus className="size-4" />أضف وحدة</Button><Button variant="ghost" onClick={() => setPresets(true)}>أمثلة جاهزة</Button></div>
      {!f.units.length ? <Empty title="لا وحدات لهذا المنتج" hint="المنتج يُباع بشكله الأساسي. أضف وحدة فقط إن كان يُباع بأكثر من شكل." /> : (
        <div className="space-y-2">{f.units.map((u, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto] gap-2 items-end border border-ink-200 rounded-xl p-3">
            <Input label="الاسم" value={u.name} onChange={(e) => upd(i, 'name', e.target.value)} />
            <NumberInput label="عدد الحبات" value={u.factor} onChange={(v) => upd(i, 'factor', v ?? 1)} />
            <NumberInput label="السعر" value={u.price} onChange={(v) => upd(i, 'price', v ?? 0)} />
            <Input label="الباركود" dir="ltr" value={u.barcode ?? ''} onChange={(e) => upd(i, 'barcode', e.target.value)} />
            <Button variant="ghost" aria-label="حذف الوحدة" onClick={() => setUnits(f.units.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            {u.price === 0 && u.active && <p className="col-span-full text-xs text-amber-700">وحدة مفعّلة بسعر صفر: ستُباع بـ 0.00</p>}
          </div>
        ))}</div>
      )}
      <Modal open={presets} onClose={() => setPresets(false)} title="أمثلة جاهزة للوحدات" size="sm">
        <p className="text-sm text-ink-600 mb-3">اختر الأقرب لنشاطك فتُضاف الأسماء، وتكمل أنت الأسعار والباركود.</p>
        <div className="grid gap-2">{Object.entries(PRESETS).map(([k, list]) => (
          <button key={k} className="text-start rounded-xl border border-ink-200 p-3 hover:bg-brand-50" onClick={() => { setUnits([...f.units, ...list.filter((x) => !f.units.some((u) => u.name === x.name)).map((x) => ({ ...x, price: 0, barcode: '', active: true }))]); setPresets(false); }}>
            <b>{k}</b><span className="block text-sm text-ink-500">{list.map((x) => x.name).join(' · ')}</span>
          </button>
        ))}</div>
      </Modal>
    </div>
  );
}

function RecipeTab({ f, set, recipeCost }: { f: ProductForm; set: <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => void; recipeCost: number }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const { data } = useQuery({ queryKey: ['products', 'recipe', dq], queryFn: () => api<{ rows: Array<{ id: number; name: string; avgCost: number; cost: number; unitName: string }> }>('/products', { query: { search: dq, limit: 8 } }), enabled: dq.length > 1 });
  const net = f.price ? f.price / (f.taxIncluded ? 1.15 : 1) : 0;
  return (
    <div className="space-y-4">
      <Toggle checked={f.isComposite} onChange={(v) => set('isComposite', v)} label="تفعيل التكوين من مكوّنات" hint="يُصنع المنتج لحظة البيع من مكوّنات مخزونك، وتُخصم المكوّنات عند البيع. مثال: كابتشينو = بن 18 جم + حليب 150 مل + كوب." />
      {f.isComposite && (
        <>
          <div className="relative">
            <input className="input" placeholder="ابحث وأضف مكوّناً" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث المكونات" />
            {data && dq.length > 1 && (
              <ul className="absolute z-10 inset-x-0 mt-1 card p-1 max-h-60 overflow-auto">{data.rows.filter((r) => r.id !== f.id).map((r) => (
                <li key={r.id}><button className="w-full text-start px-3 py-2 rounded hover:bg-ink-50" onClick={() => { set('recipe', [...f.recipe, { componentId: r.id, qty: 1, name: r.name, cost: r.avgCost || r.cost, unitName: r.unitName }]); setQ(''); }}>{r.name}</button></li>
              ))}</ul>
            )}
          </div>
          {!f.recipe.length ? <Empty title="كوّن منتجك من مكوّنات المخزون" hint="ابحث أعلاه وأضف أول مكوّن." /> : (
            <table className="table w-full"><thead><tr><th>المكوّن</th><th>الكمية المطلوبة</th><th>تكلفة السطر</th><th /></tr></thead>
              <tbody>{f.recipe.map((r, i) => (
                <tr key={i}><td>{r.name}</td><td className="w-36"><NumberInput aria-label="الكمية" value={r.qty} onChange={(v) => set('recipe', f.recipe.map((x, j) => j === i ? { ...x, qty: v ?? 0 } : x))} suffix={r.unitName} /></td>
                  <td className="num">{money((r.cost ?? 0) * r.qty)}</td><td><Button variant="ghost" aria-label="حذف" onClick={() => set('recipe', f.recipe.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button></td></tr>
              ))}</tbody></table>
          )}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-ink-50 p-3"><div className="text-sm text-ink-500">تكلفة الوصفة</div><div className="font-bold num">{money(recipeCost)}</div></div>
            <div className="rounded-xl bg-ink-50 p-3"><div className="text-sm text-ink-500">الربح</div><div className="font-bold num">{money(net - recipeCost)}</div></div>
            <div className="rounded-xl bg-ink-50 p-3"><div className="text-sm text-ink-500">الهامش</div><div className="font-bold num">{net ? (((net - recipeCost) / net) * 100).toFixed(1) : 0}%</div></div>
          </div>
          {recipeCost > net && net > 0 && <p className="text-red-600 text-sm">تبيع بخسارة: تكلفة الوصفة تتجاوز سعر البيع.</p>}
        </>
      )}
    </div>
  );
}

function StockTab({ id, f }: { id: number; f: ProductForm }) {
  const toast = useToast(); const qc = useQueryClient(); const { can } = useAuth();
  const [adj, setAdj] = useState<{ branchId: number; name: string; current: number } | null>(null);
  const [mode, setMode] = useState<'ADD' | 'SUBTRACT' | 'COUNT'>('COUNT'); const [n, setN] = useState<number | null>(null); const [reason, setReason] = useState('');
  const { data: moves } = useQuery({ queryKey: ['product', id, 'moves'], queryFn: () => api<Array<{ id: number; type: string; qty: number; balanceAfter: number; createdAt: string; branch: string; user: string | null; note: string | null }>>(`/products/${id}/movements`) });
  const m = useMutation({ mutationFn: () => api(`/products/${id}/adjust`, { body: { branchId: adj!.branchId, mode, qty: n ?? 0, reason } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['product'] }); qc.invalidateQueries({ queryKey: ['products'] }); setAdj(null); toast.success('تم حفظ الكمية الجديدة.'); }, onError: toast.error });
  const TYPES: Record<string, string> = { OPENING: 'رصيد افتتاحي', SALE: 'بيع', RETURN: 'مرتجع', PURCHASE: 'شراء', PURCHASE_RETURN: 'مرتجع مشتريات', ADJUST: 'تسوية', TRANSFER_IN: 'تحويل وارد', TRANSFER_OUT: 'تحويل صادر', ISSUE: 'صرف داخلي', RENTAL_OUT: 'تأجير', RENTAL_IN: 'إرجاع إيجار' };
  if (f.unlimited) return <Empty title="كمية غير محدودة" hint="هذا المنتج لا يُتابَع مخزونه." />;
  return (
    <div className="space-y-5">
      <table className="table w-full"><thead><tr><th>الفرع</th><th>الكمية</th><th>الحالة</th><th /></tr></thead>
        <tbody>{f.stocks?.map((s) => (
          <tr key={s.branchId}><td>{s.branchName} {s.branchType === 'WAREHOUSE' && <Badge>مستودع</Badge>} {s.isDefault && <Badge tone="brand">افتراضي</Badge>}</td>
            <td className="num font-bold">{qty(s.qty)}</td><td>{s.counted ? <Badge tone="green">مجرود</Badge> : <Badge tone="amber">غير مجرود</Badge>}</td>
            <td>{can('inventory.adjust') && <Button size="sm" variant="secondary" onClick={() => { setAdj({ branchId: s.branchId, name: s.branchName, current: s.qty ?? 0 }); setN(null); setReason(''); }}>تسوية</Button>}</td></tr>
        ))}</tbody></table>
      <section>
        <h3 className="font-bold mb-2">بطاقة الصنف — آخر الحركات</h3>
        {!moves?.length ? <Empty title="لا حركات مسجلة بعد" /> : (
          <table className="table w-full"><thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>الرصيد بعدها</th><th>الفرع</th><th>بواسطة</th></tr></thead>
            <tbody>{moves.map((mv) => (
              <tr key={mv.id}><td className="text-sm whitespace-nowrap">{dateTime(mv.createdAt)}</td><td>{TYPES[mv.type] ?? mv.type}{mv.note && <span className="block text-xs text-ink-500">{mv.note}</span>}</td>
                <td className={mv.qty < 0 ? 'num text-red-600' : 'num text-emerald-700'}>{mv.qty > 0 ? '+' : ''}{qty(mv.qty)}</td><td className="num">{qty(mv.balanceAfter)}</td><td className="text-sm">{mv.branch}</td><td className="text-sm">{mv.user ?? '—'}</td></tr>
            ))}</tbody></table>
        )}
      </section>
      <Modal open={!!adj} onClose={() => setAdj(null)} title={`تعديل كمية الفرع: ${adj?.name ?? ''}`} size="sm" footer={<Button loading={m.isPending} onClick={() => m.mutate()}>حفظ الكمية الجديدة</Button>}>
        <p className="text-sm text-ink-600 mb-3">الكمية الحالية: <b className="num">{qty(adj?.current)}</b></p>
        <Segmented value={mode} onChange={setMode} items={[{ value: 'ADD', label: '＋ زيادة' }, { value: 'SUBTRACT', label: '－ نقص' }, { value: 'COUNT', label: '＝ عد فعلي' }]} />
        <div className="space-y-3 mt-3">
          <NumberInput label={mode === 'COUNT' ? 'الكمية الفعلية بعد العد' : mode === 'ADD' ? 'كم تريد أن تضيف؟' : 'كم تريد أن تنقص؟'} value={n} onChange={setN} />
          <Input label="سبب التعديل" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="جرد، تلف، تصحيح…" />
          <p className="text-[13px] text-ink-500">لزيادة المخزون من توريد جديد، الأفضل تسجيله عبر فاتورة شراء ليُحسب سعر التكلفة تلقائياً.</p>
        </div>
      </Modal>
    </div>
  );
}
