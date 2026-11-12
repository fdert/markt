import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, Package, Layers, Wrench, KeyRound, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, qty, date } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Empty, PageHeader, Pager, SearchInput, Select, Spinner, Stat, useDebounced, useToast } from '../../components/ui';
import { ProductEditor } from './ProductEditor';

interface Row { id: number; type: string; name: string; barcode: string | null; category: string | null; price: number; stock: number; unlimited: boolean; active: boolean; image: string | null; isWeighted: boolean; pricePerWeight: number | null; expiryDate: string | null; lowStockAlert: number | null; isComposite: boolean }

export default function ProductsPage() {
  const { can } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const [search, setSearch] = useState(''); const ds = useDebounced(search);
  const [filters, setFilters] = useState({ categoryId: '', type: '', status: '', stock: '', expiry: '', sort: '' });
  const [page, setPage] = useState(1); const [open, setOpen] = useState<number | 'new' | null>(null); const [newType, setNewType] = useState('SIMPLE');
  const [sel, setSel] = useState<number[]>([]); const [menu, setMenu] = useState(false);
  const query = { search: ds, ...filters, page, limit: 30 };
  const { data, isLoading } = useQuery({ queryKey: ['products', query], queryFn: () => api<{ rows: Row[]; total: number; stats: Record<string, number> }>('/products', { query }) });
  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: number; name: string }>>('/categories') });
  const bulk = useMutation({ mutationFn: (action: string) => api('/products/bulk', { body: { ids: sel, action } }), onSuccess: () => { setSel([]); qc.invalidateQueries({ queryKey: ['products'] }); toast.success('تم التحديث.'); }, onError: toast.error });
  const f = (k: keyof typeof filters) => ({ value: filters[k], onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); } });
  const st = data?.stats;
  const types = [{ v: 'SIMPLE', l: 'بسيط', d: 'المنتجات البسيطة والقابلة للشحن', i: <Package /> }, { v: 'PRO', l: 'احترافي', d: 'وحدات متعددة، ألوان، أحجام', i: <Layers /> }, { v: 'SERVICE', l: 'خدمة', d: 'تصميم، طباعة، استشارة…', i: <Wrench /> }, { v: 'RENTAL', l: 'إيجار', d: 'تأجير معدّات بسعر زمني + تأمين', i: <KeyRound /> }];
  return (
    <>
      <PageHeader title="المنتجات" actions={can('products.manage') && <>
        <Link to="/settings/import" className="btn-secondary"><Upload className="size-4" />استيراد البيانات</Link>
        <div className="relative">
          <Button onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}><Plus className="size-4" />إضافة منتج<ChevronDown className="size-4" /></Button>
          {menu && <><div className="fixed inset-0 z-10" onClick={() => setMenu(false)} /><div role="menu" className="absolute end-0 mt-2 w-72 z-20 card p-1.5 shadow-pop">{types.map((t) => (
            <button key={t.v} role="menuitem" className="w-full flex gap-3 items-start text-start px-3 py-2.5 rounded-lg hover:bg-ink-50 [&>svg]:size-5 [&>svg]:text-brand-700 [&>svg]:mt-0.5" onClick={() => { setNewType(t.v); setOpen('new'); setMenu(false); }}>{t.i}<span><b>{t.l}</b><span className="block text-sm text-ink-500">{t.d}</span></span></button>
          ))}</div></>}
        </div>
      </>} />
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <Stat label="الإجمالي" value={st?.total ?? 0} /><Stat label="مفعّلة" value={st?.active ?? 0} /><Stat label="مخفية" value={st?.hidden ?? 0} />
        <Stat label="مخزون منخفض" value={st?.low ?? 0} /><Stat label="نفدت الكمية" value={st?.out ?? 0} /><Stat label="منتهية الصلاحية" value={st?.expired ?? 0} sub={st?.expiringSoon ? `${st.expiringSoon} يقارب انتهاؤها` : undefined} />
      </div>
      <Card bodyClass="!p-0">
        <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-6 gap-2">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="ابحث بالاسم أو الباركود" className="lg:col-span-2" />
          <Select aria-label="التصنيف" {...f('categoryId')}><option value="">كل التصنيفات</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select aria-label="النوع" {...f('type')}><option value="">كل الأنواع</option><option value="SIMPLE">بسيط</option><option value="PRO">احترافي</option><option value="SERVICE">خدمة</option><option value="RENTAL">إيجار</option></Select>
          <Select aria-label="المخزون" {...f('stock')}><option value="">كل الكميات</option><option value="low">مخزون منخفض</option><option value="out">نفدت الكمية</option></Select>
          <Select aria-label="الترتيب" {...f('sort')}><option value="">الأحدث</option><option value="oldest">الأقدم</option><option value="price_asc">السعر ↑</option><option value="price_desc">السعر ↓</option><option value="name">الاسم (أ-ي)</option></Select>
        </div>
        {sel.length > 0 && (
          <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm">
            <span>محدّدة: <b className="num">{sel.length}</b></span>
            <Button size="sm" variant="secondary" onClick={() => bulk.mutate('activate')}>تفعيل</Button><Button size="sm" variant="secondary" onClick={() => bulk.mutate('hide')}>إخفاء</Button><Button size="sm" variant="secondary" onClick={() => bulk.mutate('favorite')}>إضافة للمفضلة</Button><Button size="sm" variant="secondary" onClick={() => bulk.mutate('unfavorite')}>إزالة من المفضلة</Button>
            <Button size="sm" variant="ghost" onClick={() => setSel([])}>إلغاء التحديد</Button>
          </div>
        )}
        {isLoading ? <Spinner /> : !data?.rows.length ? <Empty title="لا توجد منتجات" hint="جرّب تغيير البحث أو الفلاتر." /> : (
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead><tr><th><Checkbox label={<span className="sr-only">تحديد الكل</span>} checked={sel.length === data.rows.length} onChange={(v) => setSel(v ? data.rows.map((r) => r.id) : [])} /></th><th>المنتج</th><th>التصنيف</th><th>الباركود</th><th>سعر البيع</th><th>الكمية</th><th>الحالة</th></tr></thead>
              <tbody>{data.rows.map((r) => {
                const low = !r.unlimited && r.stock > 0 && r.stock <= (r.lowStockAlert ?? 5);
                return (
                  <tr key={r.id}>
                    <td><Checkbox label={<span className="sr-only">تحديد {r.name}</span>} checked={sel.includes(r.id)} onChange={(v) => setSel((s) => v ? [...s, r.id] : s.filter((x) => x !== r.id))} /></td>
                    <td><button className="flex items-center gap-3 text-start hover:text-brand-700" onClick={() => setOpen(r.id)}>
                      <span className="size-10 shrink-0 rounded-lg bg-ink-100 overflow-hidden flex items-center justify-center text-ink-400 font-bold">{r.image ? <img src={r.image} alt="" className="size-full object-cover" /> : r.name.slice(0, 1)}</span>
                      <span><span className="font-medium">{r.name}</span><span className="block text-xs text-ink-500">{r.isWeighted && 'موزون · '}{r.isComposite && 'مركّب · '}{r.type === 'SERVICE' ? 'خدمة' : r.type === 'RENTAL' ? 'إيجار' : ''}{r.expiryDate && ` ينتهي ${date(r.expiryDate)}`}</span></span>
                    </button></td>
                    <td className="text-sm">{r.category ?? <span className="text-ink-400">بلا تصنيف</span>}</td>
                    <td className="num text-sm">{r.barcode ?? '—'}</td>
                    <td className="num">{money(r.isWeighted ? r.pricePerWeight ?? r.price : r.price)}</td>
                    <td>{r.unlimited || r.isComposite ? <span className="text-ink-400">∞</span> : r.stock <= 0 ? <Badge tone="red">نفد</Badge> : <span className={low ? 'num text-amber-700 font-bold' : 'num'}>{qty(r.stock)}</span>}</td>
                    <td>{r.active ? <Badge tone="green">مفعّل</Badge> : <Badge>مخفي</Badge>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <Pager page={page} total={data?.total ?? 0} limit={30} onPage={setPage} />
      </Card>
      <ProductEditor id={open} type={newType} onClose={() => setOpen(null)} />
    </>
  );
}
