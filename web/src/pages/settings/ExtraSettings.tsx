// إعدادات إضافية: المطاعم والمطبخ، طرق الدفع، مجموعات الأسعار، المنيو الذكي، اختصارات لوحة المفاتيح
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Plus, Pencil, Trash2, Download, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, keyString, shortcutStore, type ShortcutAction } from '../../lib/shortcuts';
import { Badge, Button, Card, Checkbox, Empty, Input, Modal, NumberInput, Select, Spinner, Toggle, useDebounced, useToast } from '../../components/ui';
import { useSettings } from '../../features/print/usePrinter';

type PosCfg = { orderTypes: { enabled: boolean; default: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' }; tablesEnabled: boolean; kitchen: { enabled: boolean; sendOn: 'CREATE' | 'HOLD' | 'BOTH' } };

function useSaveKey(key: string) {
  const qc = useQueryClient(); const toast = useToast();
  return useMutation({ mutationFn: (v: object) => api(`/settings/${key}`, { method: 'PUT', body: v }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('تم الحفظ.'); }, onError: toast.error });
}

// ===== المطاعم والطلبات =====
export function RestaurantSettings() {
  const { data } = useSettings(); const save = useSaveKey('pos'); const { me, branchId } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [v, setV] = useState<PosCfg | null>(null);
  useEffect(() => { if (data) setV(data.pos as unknown as PosCfg); }, [data]);
  const [tb, setTb] = useState(String(branchId));
  const { data: tables } = useQuery({ queryKey: ['tables', 'settings', tb], queryFn: () => api<Array<{ id: number; name: string; area: string | null; seats: number; active: boolean }>>('/tables', { query: { branchId: tb } }) });
  const { data: stations } = useQuery({ queryKey: ['stations'], queryFn: () => api<Array<{ id: number; name: string; categoryIds: number[]; printer: string | null; showOnScreen: boolean; active: boolean }>>('/kitchen/stations') });
  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: number; name: string; parentId: number | null }>>('/categories') });
  const [bulk, setBulk] = useState<{ from: number | null; to: number | null; area: string; seats: number | null } | null>(null);
  const [st, setSt] = useState<{ id?: number; name: string; categoryIds: number[]; printer: string; showOnScreen: boolean; active: boolean } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tables'] }); qc.invalidateQueries({ queryKey: ['stations'] }); };
  const addBulk = useMutation({ mutationFn: () => api('/tables/bulk', { body: { branchId: Number(tb), from: bulk!.from, to: bulk!.to, area: bulk!.area || null, seats: bulk!.seats ?? 4 } }), onSuccess: () => { refresh(); setBulk(null); toast.success('تمت إضافة الطاولات.'); }, onError: toast.error });
  const delTable = useMutation({ mutationFn: (id: number) => api(`/tables/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const saveSt = useMutation({ mutationFn: () => api(st!.id ? `/kitchen/stations/${st!.id}` : '/kitchen/stations', { method: st!.id ? 'PUT' : 'POST', body: { ...st, id: undefined, printer: st!.printer || null } }), onSuccess: () => { refresh(); setSt(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const delSt = useMutation({ mutationFn: (id: number) => api(`/kitchen/stations/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  if (!v) return <Spinner />;
  return (
    <div className="space-y-5 max-w-4xl">
      <Card title="أنواع الطلبات">
        <Toggle checked={v.orderTypes.enabled} onChange={(x) => setV({ ...v, orderTypes: { ...v.orderTypes, enabled: x } })} label="إظهار نوع الطلب في الكاشير (محلي / سفري / توصيل)" hint="يظهر على الإيصال ويُفصَّل في التقرير اليومي." />
        <div className="max-w-xs mt-2"><Select label="النوع الافتراضي" value={v.orderTypes.default} onChange={(e) => setV({ ...v, orderTypes: { ...v.orderTypes, default: e.target.value as 'TAKEAWAY' } })}><option value="TAKEAWAY">سفري</option><option value="DINE_IN">محلي</option><option value="DELIVERY">توصيل</option></Select></div>
        <Toggle checked={v.tablesEnabled} onChange={(x) => setV({ ...v, tablesEnabled: x })} label="تفعيل الطاولات" hint="اختيار الطاولة في الكاشير، وتبقى سلة الطاولة معلّقة حتى الدفع." />
      </Card>
      <Card title="شاشة المطبخ وطابعات الطلبات">
        <Toggle checked={v.kitchen.enabled} onChange={(x) => setV({ ...v, kitchen: { ...v.kitchen, enabled: x } })} label="إرسال الطلبات إلى المطبخ" hint="تظهر في شاشة المطبخ وتُطبع تذكرة لكل قسم على طابعته." />
        <div className="max-w-xs mt-2"><Select label="متى يُرسل الطلب؟" value={v.kitchen.sendOn} onChange={(e) => setV({ ...v, kitchen: { ...v.kitchen, sendOn: e.target.value as 'BOTH' } })}><option value="BOTH">عند التعليق وعند إنشاء الفاتورة</option><option value="CREATE">عند إنشاء الفاتورة فقط</option><option value="HOLD">عند تعليق الفاتورة فقط</option></Select></div>
        <p className="text-[13px] text-ink-500 mt-2">يُرسَل الجديد فقط عند تعديل الطلب، فلا تتكرر الأصناف في المطبخ.</p>
      </Card>
      <Button loading={save.isPending} onClick={() => save.mutate(v)}>حفظ الإعدادات</Button>

      <Card title="أقسام المطبخ" actions={<Button size="sm" onClick={() => setSt({ name: '', categoryIds: [], printer: '', showOnScreen: true, active: true })}><Plus className="size-4" />قسم جديد</Button>}>
        {!stations?.length ? <Empty title="لا أقسام بعد" hint="مثال: المطبخ الرئيسي، ركن العصيرات، الحلويات. القسم بلا تصنيفات يستقبل كل ما لا يخص غيره." /> : (
          <table className="table w-full"><thead><tr><th>القسم</th><th>التصنيفات</th><th>الطابعة</th><th>الحالة</th><th /></tr></thead>
            <tbody>{stations.map((s) => <tr key={s.id}><td className="font-medium">{s.name}</td><td className="text-sm">{s.categoryIds.length ? s.categoryIds.map((id) => cats?.find((c) => c.id === id)?.name).filter(Boolean).join('، ') : 'كل التصنيفات'}</td><td className="num text-sm">{s.printer ?? '—'}</td><td>{s.active ? <Badge tone="green">مفعّل</Badge> : <Badge>موقوف</Badge>}</td>
              <td className="whitespace-nowrap"><Button size="sm" variant="ghost" aria-label="تعديل" onClick={() => setSt({ ...s, printer: s.printer ?? '' })}><Pencil className="size-4" /></Button><Button size="sm" variant="ghost" aria-label="حذف" onClick={() => delSt.mutate(s.id)}><Trash2 className="size-4" /></Button></td></tr>)}</tbody></table>
        )}
        <a href="/kitchen" target="_blank" className="inline-flex items-center gap-1 text-sm text-brand-700 mt-3">فتح شاشة المطبخ <ExternalLink className="size-3.5" /></a>
      </Card>

      <Card title="الطاولات" actions={<div className="flex gap-2"><Select aria-label="الفرع" value={tb} onChange={(e) => setTb(e.target.value)} className="!h-8 !w-auto">{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select><Button size="sm" onClick={() => setBulk({ from: (tables?.length ?? 0) + 1, to: (tables?.length ?? 0) + 10, area: 'الصالة', seats: 4 })}><Plus className="size-4" />إضافة طاولات</Button></div>}>
        {!tables?.length ? <Empty title="لا طاولات لهذا الفرع" /> : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">{tables.map((t) => (
            <div key={t.id} className="rounded-lg border border-ink-200 p-2 text-sm flex items-center justify-between"><span><b>{t.name}</b><span className="block text-xs text-ink-500">{t.area ?? 'عام'} · {t.seats}</span></span><button aria-label={`حذف ${t.name}`} className="text-ink-400 hover:text-red-600" onClick={() => delTable.mutate(t.id)}><Trash2 className="size-4" /></button></div>
          ))}</div>
        )}
      </Card>

      <Modal open={!!bulk} onClose={() => setBulk(null)} title="إضافة طاولات" size="sm" footer={<Button loading={addBulk.isPending} onClick={() => addBulk.mutate()}>إضافة</Button>}>
        {bulk && <div className="grid grid-cols-2 gap-3"><NumberInput label="من رقم" value={bulk.from} onChange={(x) => setBulk({ ...bulk, from: x })} /><NumberInput label="إلى رقم" value={bulk.to} onChange={(x) => setBulk({ ...bulk, to: x })} /><Input label="المنطقة" value={bulk.area} onChange={(e) => setBulk({ ...bulk, area: e.target.value })} /><NumberInput label="عدد المقاعد" value={bulk.seats} onChange={(x) => setBulk({ ...bulk, seats: x })} /></div>}
      </Modal>
      <Modal open={!!st} onClose={() => setSt(null)} title={st?.id ? 'تعديل القسم' : 'قسم مطبخ جديد'} footer={<Button loading={saveSt.isPending} onClick={() => saveSt.mutate()}>حفظ</Button>}>
        {st && <div className="space-y-3">
          <Input label="اسم القسم" value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} />
          <Input label="طابعة القسم" dir="ltr" placeholder="192.168.1.50:9100 أو اسم الطابعة" value={st.printer} onChange={(e) => setST(e.target.value)} hint="تُطبع التذاكر عبر مساعد الطباعة المحلي. اتركها فارغة لعرض الطلبات على الشاشة فقط." />
          <fieldset><legend className="label">التصنيفات التي يحضّرها هذا القسم</legend><div className="flex flex-wrap gap-2">{cats?.filter((c) => !c.parentId).map((c) => <Checkbox key={c.id} checked={st.categoryIds.includes(c.id)} onChange={(x) => setSt({ ...st, categoryIds: x ? [...st.categoryIds, c.id] : st.categoryIds.filter((i) => i !== c.id) })} label={c.name} />)}</div></fieldset>
          <Toggle checked={st.showOnScreen} onChange={(x) => setSt({ ...st, showOnScreen: x })} label="إظهار في شاشة المطبخ" />
          <Toggle checked={st.active} onChange={(x) => setSt({ ...st, active: x })} label="القسم مفعّل" />
        </div>}
      </Modal>
    </div>
  );
  function setST(printer: string) { setSt((s) => s && { ...s, printer }); }
}

// ===== طرق الدفع =====
interface PM { id: number; code: string; name: string; kind: string; accountKey: string; builtIn: boolean; active: boolean; sortOrder: number; commissionPercent: number }
const KINDS: Record<string, string> = { CASH: 'نقدي', CARD: 'بطاقة', TRANSFER: 'تحويل', CREDIT: 'آجل', WALLET: 'محفظة', BNPL: 'تقسيط', DELIVERY_APP: 'تطبيق توصيل', ONLINE: 'دفع أونلاين', OTHER: 'أخرى' };
export function PaymentMethodsSettings() {
  const qc = useQueryClient(); const toast = useToast();
  const { data } = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PM[]>('/payment-methods') });
  const [edit, setEdit] = useState<Partial<PM> | null>(null);
  const toggle = useMutation({ mutationFn: (m: PM) => api(`/payment-methods/${m.id}`, { method: 'PUT', body: { active: !m.active } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-methods'] }), onError: toast.error });
  const save = useMutation({ mutationFn: () => api(edit!.id ? `/payment-methods/${edit!.id}` : '/payment-methods', { method: edit!.id ? 'PUT' : 'POST', body: { code: edit!.code, name: edit!.name, kind: edit!.kind ?? 'OTHER', accountKey: edit!.accountKey ?? 'APP_RECEIVABLE', sortOrder: edit!.sortOrder ?? 50, commissionPercent: edit!.commissionPercent ?? 0, active: edit!.active ?? true } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-methods'] }); setEdit(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-ink-600">فعّل طرق الدفع التي تستقبلها في الكاشير. مبيعات تطبيقات التوصيل والتقسيط تُسجَّل ذمماً على الشركة حتى تحصيلها، وتظهر منفصلة في التقرير اليومي.</p>
      <div className="flex justify-end"><Button onClick={() => setEdit({ kind: 'OTHER', accountKey: 'APP_RECEIVABLE', active: true })}><Plus className="size-4" />طريقة دفع جديدة</Button></div>
      <Card bodyClass="!p-0">{!data ? <Spinner /> : (
        <table className="table w-full"><thead><tr><th>الطريقة</th><th>النوع</th><th>الحساب</th><th>العمولة</th><th>مفعّلة</th><th /></tr></thead>
          <tbody>{data.map((m) => <tr key={m.id}><td className="font-medium">{m.name}<span className="block text-xs text-ink-500" dir="ltr">{m.code}</span></td><td>{KINDS[m.kind]}</td><td className="text-sm">{{ CASH: 'الصندوق', BANK: 'البنك', AR: 'ذمم العملاء', APP_RECEIVABLE: 'ذمم الشركات', CUSTOMER_WALLET: 'محافظ العملاء', LOYALTY: 'الولاء' }[m.accountKey] ?? m.accountKey}</td><td className="num">{m.commissionPercent}%</td>
            <td><input type="checkbox" className="size-5 accent-brand-700" aria-label={`تفعيل ${m.name}`} checked={m.active} disabled={m.code === 'CASH'} onChange={() => toggle.mutate(m)} /></td>
            <td><Button size="sm" variant="ghost" aria-label="تعديل" onClick={() => setEdit(m)}><Pencil className="size-4" /></Button></td></tr>)}</tbody></table>
      )}</Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل طريقة الدفع' : 'طريقة دفع جديدة'} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>حفظ</Button>}>
        {edit && <div className="grid sm:grid-cols-2 gap-3">
          <Input label="الاسم" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Input label="الرمز" dir="ltr" disabled={!!edit.id} value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} hint="مثل MRSOOL" />
          <Select label="النوع" disabled={edit.builtIn} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KINDS).filter(([k]) => !['CREDIT', 'WALLET'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Select label="يُسجَّل في حساب" disabled={edit.builtIn} value={edit.accountKey} onChange={(e) => setEdit({ ...edit, accountKey: e.target.value })}><option value="APP_RECEIVABLE">ذمم الشركات (حتى التحصيل)</option><option value="BANK">البنك</option><option value="CASH">الصندوق</option></Select>
          <NumberInput label="عمولة الشركة %" value={edit.commissionPercent ?? 0} onChange={(x) => setEdit({ ...edit, commissionPercent: x ?? 0 })} />
          <NumberInput label="الترتيب" value={edit.sortOrder ?? 50} onChange={(x) => setEdit({ ...edit, sortOrder: x ?? 50 })} />
        </div>}
      </Modal>
    </div>
  );
}

// ===== مجموعات الأسعار =====
export function PriceListsSettings() {
  const qc = useQueryClient(); const toast = useToast();
  const { data } = useQuery({ queryKey: ['price-lists'], queryFn: () => api<Array<{ id: number; name: string; adjustPercent: number; active: boolean; itemsCount: number }>>('/price-lists') });
  const [edit, setEdit] = useState<{ id?: number; name: string; adjustPercent: number; active: boolean; items: Array<{ productId: number; name: string; basePrice: number; price: number }> } | null>(null);
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const { data: found } = useQuery({ queryKey: ['products', 'pl', dq], queryFn: () => api<{ rows: Array<{ id: number; name: string; price: number }> }>('/products', { query: { search: dq, limit: 8 } }), enabled: dq.length > 1 });
  const openEdit = async (id?: number) => {
    if (!id) return setEdit({ name: '', adjustPercent: 0, active: true, items: [] });
    const d = await api<{ id: number; name: string; adjustPercent: number; active: boolean; items: Array<{ productId: number; name: string; basePrice: number; price: number }> }>(`/price-lists/${id}`);
    setEdit(d);
  };
  const save = useMutation({ mutationFn: () => api(edit!.id ? `/price-lists/${edit!.id}` : '/price-lists', { method: edit!.id ? 'PUT' : 'POST', body: { name: edit!.name, adjustPercent: edit!.adjustPercent, active: edit!.active, items: edit!.items.map((i) => ({ productId: i.productId, price: i.price })) } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-lists'] }); setEdit(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const del = useMutation({ mutationFn: (id: number) => api(`/price-lists/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['price-lists'] }) });
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-ink-600">مجموعات أسعار مثل الجملة أو الموظفين أو كبار العملاء: نسبة تعديل عامة، وأسعار خاصة لأصناف محددة. تُختار في الكاشير أو تُربط بالعميل.</p>
      <div className="flex justify-end"><Button onClick={() => openEdit()}><Plus className="size-4" />مجموعة جديدة</Button></div>
      <Card bodyClass="!p-0">{!data ? <Spinner /> : !data.length ? <Empty title="لا مجموعات أسعار" /> : (
        <table className="table w-full"><thead><tr><th>المجموعة</th><th>التعديل العام</th><th>أسعار خاصة</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.map((p) => <tr key={p.id}><td className="font-medium">{p.name}</td><td className="num">{p.adjustPercent > 0 ? '+' : ''}{p.adjustPercent}%</td><td className="num">{p.itemsCount}</td><td>{p.active ? <Badge tone="green">مفعّلة</Badge> : <Badge>موقوفة</Badge>}</td>
            <td className="whitespace-nowrap"><Button size="sm" variant="ghost" aria-label="تعديل" onClick={() => openEdit(p.id)}><Pencil className="size-4" /></Button><Button size="sm" variant="ghost" aria-label="حذف" onClick={() => del.mutate(p.id)}><Trash2 className="size-4" /></Button></td></tr>)}</tbody></table>
      )}</Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل مجموعة الأسعار' : 'مجموعة أسعار جديدة'} size="lg" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>حفظ</Button>}>
        {edit && <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3"><Input label="اسم المجموعة" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /><NumberInput label="تعديل عام على كل المنتجات %" value={edit.adjustPercent} onChange={(x) => setEdit({ ...edit, adjustPercent: x ?? 0 })} hint="سالب للخصم، مثل −10" /></div>
          <Toggle checked={edit.active} onChange={(x) => setEdit({ ...edit, active: x })} label="المجموعة مفعّلة" />
          <div className="relative"><Input label="أسعار خاصة لأصناف محددة" placeholder="ابحث عن منتج لإضافته" value={q} onChange={(e) => setQ(e.target.value)} />
            {found && dq.length > 1 && <ul className="absolute z-10 inset-x-0 mt-1 card p-1 max-h-48 overflow-auto">{found.rows.map((r) => <li key={r.id}><button className="w-full text-start px-3 py-2 rounded hover:bg-ink-50" onClick={() => { if (!edit.items.some((i) => i.productId === r.id)) setEdit({ ...edit, items: [...edit.items, { productId: r.id, name: r.name, basePrice: r.price, price: r.price }] }); setQ(''); }}>{r.name} — <span className="num">{money(r.price)}</span></button></li>)}</ul>}</div>
          {edit.items.length > 0 && <table className="table w-full"><thead><tr><th>المنتج</th><th>السعر الأساسي</th><th>سعر المجموعة</th><th /></tr></thead>
            <tbody>{edit.items.map((i, idx) => <tr key={i.productId}><td>{i.name}</td><td className="num">{money(i.basePrice)}</td><td className="w-36"><NumberInput aria-label="سعر المجموعة" value={i.price} onChange={(x) => setEdit({ ...edit, items: edit.items.map((y, j) => j === idx ? { ...y, price: x ?? 0 } : y) })} /></td><td><Button variant="ghost" size="sm" aria-label="حذف" onClick={() => setEdit({ ...edit, items: edit.items.filter((_, j) => j !== idx) })}><Trash2 className="size-4" /></Button></td></tr>)}</tbody></table>}
        </div>}
      </Modal>
    </div>
  );
}

// ===== المنيو الذكي =====
export function MenuSettings() {
  const { data } = useSettings(); const save = useSaveKey('menu');
  const [v, setV] = useState<{ enabled: boolean; title: string; subtitle: string; showPrices: boolean; whatsapp: string; showOutOfStock: boolean } | null>(null);
  const [qr, setQr] = useState('');
  useEffect(() => { if (data) setV((data as unknown as { menu: NonNullable<typeof v> }).menu); }, [data]);
  const url = `${location.origin}/menu`;
  useEffect(() => { QRCode.toDataURL(url, { width: 480, margin: 1 }).then(setQr); }, [url]);
  if (!v) return <Spinner />;
  return (
    <div className="grid lg:grid-cols-2 gap-5 max-w-5xl">
      <Card title="المنيو الذكي">
        <Toggle checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label="تفعيل المنيو العام" hint="صفحة يفتحها الزبون بمسح رمز QR وتعرض منتجات نقطة البيع بأسعارها." />
        <div className="space-y-3 mt-3">
          <Input label="عنوان المنيو" placeholder="اسم المتجر" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          <Input label="وصف مختصر" value={v.subtitle} onChange={(e) => setV({ ...v, subtitle: e.target.value })} />
          <Input label="رقم واتساب للطلب" dir="ltr" value={v.whatsapp} onChange={(e) => setV({ ...v, whatsapp: e.target.value })} />
          <Toggle checked={v.showPrices} onChange={(x) => setV({ ...v, showPrices: x })} label="إظهار الأسعار" />
          <Toggle checked={v.showOutOfStock} onChange={(x) => setV({ ...v, showOutOfStock: x })} label="إظهار الأصناف النافدة (معلَّمة غير متوفرة)" />
        </div>
        <div className="mt-4"><Button loading={save.isPending} onClick={() => save.mutate(v)}>حفظ</Button></div>
      </Card>
      <Card title="رمز QR للطاولات">
        {qr && <img src={qr} alt="رمز QR للمنيو" className="w-56 mx-auto" />}
        <p className="text-center text-sm text-ink-500 mt-2 break-all" dir="ltr">{url}</p>
        <div className="flex justify-center gap-2 mt-3"><a className="btn-secondary" href={qr} download="menu-qr.png"><Download className="size-4" />تنزيل الرمز</a><a className="btn-secondary" href="/menu" target="_blank" rel="noopener"><ExternalLink className="size-4" />معاينة</a></div>
      </Card>
    </div>
  );
}

// ===== اختصارات لوحة المفاتيح =====
export function ShortcutsSettings() {
  const toast = useToast();
  const [v, setV] = useState(shortcutStore.get());
  const [rec, setRec] = useState<ShortcutAction | null>(null);
  useEffect(() => {
    if (!rec) return;
    const h = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { setRec(null); return; } const k = keyString(e); if (!k || ['Ctrl', 'Alt', 'Shift'].includes(k)) return; setV((s) => ({ ...s, [rec]: k })); setRec(null); };
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true);
  }, [rec]);
  const dupes = Object.values(v).filter((k, i, a) => k && a.indexOf(k) !== i);
  return (
    <Card title="اختصارات نقطة البيع" className="max-w-3xl">
      <p className="text-sm text-ink-500 mb-3">تُحفظ لهذا الجهاز. اضغط «تسجيل» ثم الزر أو المجموعة التي تريدها (Esc للإلغاء).</p>
      <ul className="divide-y divide-ink-100">{(Object.keys(SHORTCUT_ACTIONS) as ShortcutAction[]).map((a) => (
        <li key={a} className="flex items-center justify-between py-2.5 gap-3">
          <span>{SHORTCUT_ACTIONS[a]}</span>
          <span className="flex items-center gap-2">
            <kbd className={`min-w-[80px] text-center rounded-md border px-2 py-1 text-sm ${dupes.includes(v[a]) ? 'border-red-400 text-red-700' : 'border-ink-300'}`} dir="ltr">{rec === a ? '…اضغط الآن' : v[a] || 'غير محدد'}</kbd>
            <Button size="sm" variant="secondary" onClick={() => setRec(a)}>تسجيل</Button>
            <Button size="sm" variant="ghost" onClick={() => setV({ ...v, [a]: '' })}>مسح</Button>
          </span>
        </li>
      ))}</ul>
      {dupes.length > 0 && <p className="text-sm text-red-600 mt-2">يوجد اختصار مكرر. غيّره قبل الحفظ.</p>}
      <div className="flex gap-2 mt-4"><Button disabled={dupes.length > 0} onClick={() => { shortcutStore.set(v); toast.success('تم الحفظ. أعد فتح نقطة البيع لتطبيقه.'); }}>حفظ</Button><Button variant="secondary" onClick={() => setV(DEFAULT_SHORTCUTS)}>استعادة الافتراضي</Button></div>
    </Card>
  );
}

