// الأدوات التسويقية: الكوبونات والعروض والتخفيضات
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Copy } from 'lucide-react';
import { api } from '../lib/api';
import { money, date, isoDate } from '../lib/format';
import { Badge, Button, Card, Empty, Input, Modal, NumberInput, PageHeader, Segmented, Select, Spinner, Stat, Tabs, Toggle, useToast } from '../components/ui';

const STATUS: Record<string, { l: string; t: 'green' | 'blue' | 'gray' | 'red' | 'amber' }> = { ACTIVE: { l: 'سارية', t: 'green' }, SCHEDULED: { l: 'مجدولة', t: 'blue' }, EXHAUSTED: { l: 'مستنفدة', t: 'amber' }, EXPIRED: { l: 'منتهية', t: 'gray' }, PAUSED: { l: 'موقوفة', t: 'red' } };
const plusDays = (n: number) => isoDate(new Date(Date.now() + n * 86400000));

interface Coupon { id?: number; name: string; code: string; type: 'AMOUNT' | 'PERCENT'; value: number | null; maxDiscount?: number | null; freeShipping: boolean; channel: string; minOrder?: number | null; usageLimit?: number | null; perCustomer?: number | null; startsAt: string; endsAt: string; active: boolean; status?: string; usedCount?: number; totalGranted?: number }

export function CouponsPage() {
  const qc = useQueryClient(); const toast = useToast(); const [tab, setTab] = useState(''); const [edit, setEdit] = useState<Coupon | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['coupons'], queryFn: () => api<Coupon[]>('/marketing/coupons') });
  const save = useMutation({ mutationFn: () => api(edit!.id ? `/marketing/coupons/${edit!.id}` : '/marketing/coupons', { method: edit!.id ? 'PUT' : 'POST', body: { ...edit, status: undefined, usedCount: undefined, totalGranted: undefined, id: undefined, startsAt: new Date(edit!.startsAt).toISOString(), endsAt: new Date(edit!.endsAt + 'T23:59:59').toISOString() } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['coupons'] }); setEdit(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const del = useMutation({ mutationFn: (id: number) => api(`/marketing/coupons/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['coupons'] }); toast.success('تم الحذف.'); }, onError: toast.error });
  const list = data?.filter((c) => !tab || c.status === tab) ?? [];
  const blank: Coupon = { name: '', code: '', type: 'PERCENT', value: null, freeShipping: false, channel: 'ALL', startsAt: isoDate(), endsAt: plusDays(30), active: true };
  const set = <K extends keyof Coupon>(k: K, v: Coupon[K]) => setEdit((e) => e && { ...e, [k]: v });
  return (
    <>
      <PageHeader title="الكوبونات" subtitle="كود يكتبه العميل عند الشراء فيحصل على خصم." actions={<Button onClick={() => setEdit(blank)}><Plus className="size-4" />كوبون جديد</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Stat label="إجمالي الكوبونات" value={data?.length ?? 0} /><Stat label="سارية الآن" value={data?.filter((c) => c.status === 'ACTIVE').length ?? 0} /><Stat label="مرات الاستخدام" value={data?.reduce((s, c) => s + (c.usedCount ?? 0), 0) ?? 0} /><Stat label="الخصم الممنوح" value={money(data?.reduce((s, c) => s + (c.totalGranted ?? 0), 0))} /></div>
      <Card bodyClass="!p-0">
        <div className="px-4 pt-3"><Tabs value={tab} onChange={setTab} items={[{ value: '', label: 'الكل' }, ...Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v.l }))]} /></div>
        {isLoading ? <Spinner /> : !list.length ? <Empty title="لم تنشئ أي كوبون بعد" action={<Button onClick={() => setEdit(blank)}>كوبون جديد</Button>} /> : (
          <table className="table w-full"><thead><tr><th>الكوبون</th><th>الخصم</th><th>القناة</th><th>الاستخدام</th><th>الصلاحية</th><th>الحالة</th><th /></tr></thead>
            <tbody>{list.map((c) => <tr key={c.id}><td><b>{c.name}</b><span className="block num text-sm text-brand-700">{c.code}</span></td><td>{c.type === 'PERCENT' ? `${c.value}%` : `${money(c.value)} ر.س`}</td><td>{{ ALL: 'الكل', POS: 'نقاط البيع', ONLINE: 'المتجر الإلكتروني' }[c.channel]}</td><td className="num">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</td><td className="text-sm">{date(c.startsAt)} — {date(c.endsAt)}</td><td><Badge tone={STATUS[c.status!].t}>{STATUS[c.status!].l}</Badge></td>
              <td className="whitespace-nowrap"><Button size="sm" variant="ghost" aria-label="تعديل" onClick={() => setEdit({ ...c, startsAt: c.startsAt.slice(0, 10), endsAt: c.endsAt.slice(0, 10) })}><Pencil className="size-4" /></Button><Button size="sm" variant="ghost" aria-label="نسخة منه" onClick={() => setEdit({ ...c, id: undefined, code: `${c.code}-2`, startsAt: isoDate(), endsAt: plusDays(30) })}><Copy className="size-4" /></Button>{!c.usedCount && <Button size="sm" variant="ghost" aria-label="حذف" onClick={() => del.mutate(c.id!)}><Trash2 className="size-4" /></Button>}</td></tr>)}</tbody></table>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل الكوبون' : 'كوبون جديد'} size="lg" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>إلغاء</Button><Button loading={save.isPending} onClick={() => save.mutate()}>حفظ</Button></>}>
        {edit && <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-3"><Input label="اسم الكوبون" required hint="للتمييز داخل لوحة التحكم، ولا يراه العميل." value={edit.name} onChange={(e) => set('name', e.target.value)} /><Input label="كود الخصم" required dir="ltr" hint="حروف إنجليزية وأرقام وشرطة فقط." value={edit.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} /></div>
          <div className="space-y-3"><Segmented value={edit.type} onChange={(v) => set('type', v)} items={[{ value: 'PERCENT', label: 'نسبة مئوية' }, { value: 'AMOUNT', label: 'مبلغ ثابت' }]} />
            <div className="grid sm:grid-cols-2 gap-3"><NumberInput label="قيمة الخصم" suffix={edit.type === 'PERCENT' ? '%' : 'ر.س'} value={edit.value} onChange={(v) => set('value', v)} />{edit.type === 'PERCENT' && <NumberInput label="أقصى خصم" suffix="ر.س" hint="اتركه فارغاً إن لم يكن له سقف." value={edit.maxDiscount ?? null} onChange={(v) => set('maxDiscount', v)} />}</div></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Select label="أين يعمل الكوبون؟" value={edit.channel} onChange={(e) => set('channel', e.target.value)}><option value="ALL">المتجر الإلكتروني ونقاط البيع</option><option value="POS">نقاط البيع فقط</option><option value="ONLINE">المتجر الإلكتروني فقط</option></Select>
            <NumberInput label="الحد الأدنى للطلب" suffix="ر.س" value={edit.minOrder ?? null} onChange={(v) => set('minOrder', v)} />
            <NumberInput label="إجمالي مرات الاستخدام" hint="اتركه فارغاً لاستخدام غير محدود." value={edit.usageLimit ?? null} onChange={(v) => set('usageLimit', v)} />
            <NumberInput label="مرات لكل عميل" value={edit.perCustomer ?? null} onChange={(v) => set('perCustomer', v)} />
            <Input label="تاريخ البدء" type="date" value={edit.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
            <Input label="تاريخ الانتهاء" type="date" value={edit.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
          </div>
          <div className="flex gap-2 text-sm">مدة سريعة: {[7, 30, 90].map((d) => <Button key={d} size="sm" variant="secondary" onClick={() => set('endsAt', isoDate(new Date(new Date(edit.startsAt).getTime() + d * 86400000)))}>{d === 7 ? 'أسبوع' : d === 30 ? 'شهر' : '3 أشهر'}</Button>)}</div>
          <Toggle checked={edit.freeShipping} onChange={(v) => set('freeShipping', v)} label="شحن مجاني مع الكوبون" />
          <Toggle checked={edit.active} onChange={(v) => set('active', v)} label="الكوبون مفعّل" hint="أوقفه مؤقتاً دون حذفه." />
        </div>}
      </Modal>
    </>
  );
}

interface Offer { id?: number; name: string; badge?: string | null; type: string; value: number | null; buyQty?: number | null; getQty?: number | null; scope: string; categoryIds: number[]; productIds: number[]; excludedIds: number[]; channel: string; startsAt?: string | null; endsAt?: string | null; active: boolean; stackCoupons: boolean; status?: string }
const TEMPLATES: Array<{ name: string; desc: string; o: Partial<Offer>; days?: number }> = [
  { name: 'اشترِ 1 واحصل على الثاني مجاناً', desc: 'أي قطعتين من منتجات العرض، والأرخص مجاناً.', o: { type: 'BUNDLE', buyQty: 1, getQty: 1 } },
  { name: '2 + 1 مجاناً', desc: 'القطعة المجانية من المنتج نفسه.', o: { type: 'BXGY', buyQty: 2, getQty: 1 } },
  { name: 'خصم 20% لنهاية الأسبوع', desc: 'نسبة على السعر لمدة 3 أيام.', o: { type: 'PERCENT', value: 20 }, days: 3 },
  { name: 'تصفية الموسم 30%', desc: 'نسبة أكبر لمدة أسبوعين لتصريف المخزون.', o: { type: 'PERCENT', value: 30 }, days: 14 },
];

export function OffersPage() {
  const qc = useQueryClient(); const toast = useToast(); const [edit, setEdit] = useState<Offer | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['offers'], queryFn: () => api<Offer[]>('/marketing/offers') });
  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: number; name: string }>>('/categories') });
  const { data: prods } = useQuery({ queryKey: ['products', 'all-offer'], queryFn: () => api<{ rows: Array<{ id: number; name: string }> }>('/products', { query: { limit: 500 } }), enabled: !!edit && edit.scope === 'PRODUCTS' });
  const save = useMutation({ mutationFn: () => api(edit!.id ? `/marketing/offers/${edit!.id}` : '/marketing/offers', { method: edit!.id ? 'PUT' : 'POST', body: { ...edit, id: undefined, status: undefined, value: edit!.value ?? 0, startsAt: edit!.startsAt || null, endsAt: edit!.endsAt ? new Date(edit!.endsAt + 'T23:59:59').toISOString() : null } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['offers'] }); setEdit(null); toast.success('تم حفظ العرض.'); }, onError: toast.error });
  const del = useMutation({ mutationFn: (id: number) => api(`/marketing/offers/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['offers'] }) });
  const blank: Offer = { name: '', type: 'PERCENT', value: null, scope: 'ALL', categoryIds: [], productIds: [], excludedIds: [], channel: 'ALL', active: true, stackCoupons: true };
  const set = <K extends keyof Offer>(k: K, v: Offer[K]) => setEdit((e) => e && { ...e, [k]: v });
  const label = (o: Offer) => o.type === 'PERCENT' ? `${o.value}%` : o.type === 'AMOUNT' ? `${money(o.value)} ر.س` : `اشترِ ${o.buyQty} واحصل على ${o.getQty}`;
  return (
    <>
      <PageHeader title="العروض والتخفيضات" subtitle="خصم على منتجات أو تصنيفات أو كل المتجر لفترة محددة، ويظهر السعر الجديد في الكاشير." actions={<Button onClick={() => setEdit(blank)}><Plus className="size-4" />عرض جديد</Button>} />
      <Card bodyClass="!p-0">{isLoading ? <Spinner /> : !data?.length ? <Empty title="لا توجد عروض بعد" action={<Button onClick={() => setEdit(blank)}>عرض جديد</Button>} /> : (
        <table className="table w-full"><thead><tr><th>العرض</th><th>الخصم</th><th>يشمل</th><th>أين يطبق</th><th>الفترة</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.map((o) => <tr key={o.id}><td className="font-medium">{o.name}</td><td>{label(o)}</td><td>{{ ALL: 'كل المنتجات', CATEGORIES: `${o.categoryIds.length} تصنيف`, PRODUCTS: `${o.productIds.length} منتج` }[o.scope]}</td><td>{{ ALL: 'المتجر والكاشير', POS: 'الكاشير', ONLINE: 'المتجر الإلكتروني' }[o.channel]}</td><td className="text-sm">{date(o.startsAt)} — {o.endsAt ? date(o.endsAt) : 'بلا انتهاء'}</td><td><Badge tone={STATUS[o.status!]?.t}>{STATUS[o.status!]?.l}</Badge></td>
            <td><Button size="sm" variant="ghost" aria-label="تعديل" onClick={() => setEdit({ ...o, startsAt: o.startsAt?.slice(0, 10), endsAt: o.endsAt?.slice(0, 10) })}><Pencil className="size-4" /></Button><Button size="sm" variant="ghost" aria-label="حذف" onClick={() => del.mutate(o.id!)}><Trash2 className="size-4" /></Button></td></tr>)}</tbody></table>
      )}</Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل العرض' : 'عرض جديد'} size="lg" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>إلغاء</Button><Button loading={save.isPending} onClick={() => save.mutate()}>حفظ العرض</Button></>}>
        {edit && <div className="space-y-5">
          {!edit.id && <div><p className="label">ابدأ من نموذج جاهز</p><div className="grid sm:grid-cols-2 gap-2">{TEMPLATES.map((t) => <button key={t.name} className="text-start rounded-xl border border-ink-200 p-3 hover:bg-brand-50" onClick={() => setEdit({ ...edit, ...t.o, name: t.name, endsAt: t.days ? plusDays(t.days) : edit.endsAt } as Offer)}><b className="text-[14px]">{t.name}</b><span className="block text-xs text-ink-500">{t.desc}</span></button>)}</div></div>}
          <div className="grid sm:grid-cols-2 gap-3"><Input label="اسم العرض" required value={edit.name} onChange={(e) => set('name', e.target.value)} /><Input label="نص الشارة" hint="اتركه فارغاً لتظهر نسبة الخصم." value={edit.badge ?? ''} onChange={(e) => set('badge', e.target.value)} /></div>
          <Select label="نوع الخصم" value={edit.type} onChange={(e) => set('type', e.target.value)}><option value="PERCENT">نسبة مئوية من سعر كل منتج</option><option value="AMOUNT">مبلغ ثابت من سعر كل منتج</option><option value="BXGY">اشترِ واحصل مجاناً (المنتج نفسه)</option><option value="BUNDLE">تشكيلة: أي منتجات من العرض والأرخص مجاناً</option></Select>
          {edit.type === 'PERCENT' || edit.type === 'AMOUNT' ? <NumberInput label="قيمة الخصم" suffix={edit.type === 'PERCENT' ? '%' : 'ر.س'} value={edit.value} onChange={(v) => set('value', v)} /> : (
            <div className="grid grid-cols-2 gap-3"><NumberInput label="يشتري العميل (قطعة)" value={edit.buyQty ?? null} onChange={(v) => set('buyQty', v)} /><NumberInput label="ويحصل مجاناً على (قطعة)" value={edit.getQty ?? null} onChange={(v) => set('getQty', v)} /></div>
          )}
          <Select label="المنتجات المشمولة" value={edit.scope} onChange={(e) => set('scope', e.target.value)}><option value="ALL">كل المنتجات</option><option value="CATEGORIES">تصنيفات تختارها</option><option value="PRODUCTS">منتجات محددة</option></Select>
          {edit.scope === 'CATEGORIES' && <fieldset><legend className="label">التصنيفات</legend><div className="flex flex-wrap gap-2">{cats?.map((c) => <label key={c.id} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm"><input type="checkbox" className="accent-brand-700" checked={edit.categoryIds.includes(c.id)} onChange={(e) => set('categoryIds', e.target.checked ? [...edit.categoryIds, c.id] : edit.categoryIds.filter((x) => x !== c.id))} />{c.name}</label>)}</div></fieldset>}
          {edit.scope === 'PRODUCTS' && <fieldset><legend className="label">المنتجات</legend><div className="max-h-48 overflow-auto border border-ink-200 rounded-lg p-2 space-y-1">{prods?.rows.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={edit.productIds.includes(p.id)} onChange={(e) => set('productIds', e.target.checked ? [...edit.productIds, p.id] : edit.productIds.filter((x) => x !== p.id))} />{p.name}</label>)}</div></fieldset>}
          <div className="grid sm:grid-cols-3 gap-3">
            <Select label="أين يطبق" value={edit.channel} onChange={(e) => set('channel', e.target.value)}><option value="ALL">المتجر والكاشير</option><option value="POS">الكاشير فقط</option><option value="ONLINE">المتجر الإلكتروني فقط</option></Select>
            <Input label="يبدأ" type="date" value={edit.startsAt ?? ''} onChange={(e) => set('startsAt', e.target.value)} hint="فارغ = فور الحفظ" />
            <Input label="ينتهي" type="date" value={edit.endsAt ?? ''} onChange={(e) => set('endsAt', e.target.value)} hint="فارغ = بلا تاريخ انتهاء" />
          </div>
          <Toggle checked={edit.active} onChange={(v) => set('active', v)} label="العرض مفعّل" hint="إن أوقفته يبقى محفوظاً ولا يخفض أي سعر." />
          <Toggle checked={edit.stackCoupons} onChange={(v) => set('stackCoupons', v)} label="يجتمع مع الكوبونات" hint="إن أوقفته لا يخصم الكوبون من منتجات هذا العرض." />
        </div>}
      </Modal>
    </>
  );
}
