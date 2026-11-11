import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { money, date, INVOICE_STATUS } from '../../lib/format';
import { Badge, Button, Card, Confirm, Drawer, Empty, Modal, PageHeader, Pager, SearchInput, Select, Spinner, Stat, Tabs, useDebounced, useToast } from '../../components/ui';
import { CustomerForm, type CustomerFull } from './CustomerForm';
import { InvoiceDrawer } from '../invoices/InvoiceDrawer';

const TYPES: Record<string, string> = { INDIVIDUAL: 'فرد', COMPANY: 'شركة', GOVERNMENT: 'حكومي', NGO: 'جمعية' };
interface Row { id: number; name: string; phone: string | null; type: string; invoices: number; lastPurchase: string | null; due: number; vatNumber: string | null; active: boolean }

export default function CustomersPage() {
  const qc = useQueryClient(); const toast = useToast(); const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState(''); const [type, setType] = useState(''); const [sort, setSort] = useState('');
  const [search, setSearch] = useState(''); const ds = useDebounced(search); const [page, setPage] = useState(1);
  const [form, setForm] = useState<Partial<CustomerFull> | null>(null); const [view, setView] = useState<number | null>(null); const [inv, setInv] = useState<number | null>(null); const [del, setDel] = useState<number | null>(null);
  useEffect(() => { if (params.get('new')) { setForm({}); setParams({}); } }, [params, setParams]);
  const query = { filter, type, sort, search: ds, page, limit: 25 };
  const { data, isLoading } = useQuery({ queryKey: ['customers', query], queryFn: () => api<{ rows: Row[]; total: number; stats: { total: number; newThisMonth: number; withDue: number; totalDue: number } }>('/customers', { query }) });
  const { data: c } = useQuery({ queryKey: ['customer', view], queryFn: () => api<CustomerFull & { due: number; invoicesCount: number; lastPurchase: string | null; createdAt: string; loyaltyPoints: number; totals: { total: number; paid: number }; invoices: Array<{ id: number; number: string; total: number; due: number; status: string; type: string; createdAt: string }> }>(`/customers/${view}`), enabled: !!view });
  const remove = useMutation({ mutationFn: () => api(`/customers/${del}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setDel(null); setView(null); toast.success('تم الحذف.'); }, onError: toast.error });
  return (
    <>
      <PageHeader title="العملاء" actions={<Button onClick={() => setForm({})}><Plus className="size-4" />إضافة عميل</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="العملاء" value={data?.stats.total ?? 0} /><Stat label="جدد هذا الشهر" value={data?.stats.newThisMonth ?? 0} />
        <Stat label="عليهم مستحقات" value={data?.stats.withDue ?? 0} /><Stat label="المستحق على العملاء" value={money(data?.stats.totalDue)} sub="ر.س" />
      </div>
      <Card bodyClass="!p-0">
        <div className="px-4 pt-3"><Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} items={[{ value: '', label: 'الكل' }, { value: 'due', label: 'عليهم مستحقات' }, { value: 'inactive', label: 'موقوفون' }]} /></div>
        <div className="px-4 pb-4 grid sm:grid-cols-4 gap-2">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="الاسم أو الجوال أو الرقم الضريبي" className="sm:col-span-2" />
          <Select aria-label="النوع" value={type} onChange={(e) => setType(e.target.value)}><option value="">كل الأنواع</option>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="الترتيب" value={sort} onChange={(e) => setSort(e.target.value)}><option value="">الأحدث</option><option value="due">الأعلى مستحقاً</option><option value="last">آخر شراء</option><option value="invoices">الأكثر فواتير</option><option value="name">الاسم (أ-ي)</option><option value="oldest">الأقدم</option></Select>
        </div>
        {isLoading ? <Spinner /> : !data?.rows.length ? <Empty title="لا عملاء" /> : (
          <div className="overflow-x-auto"><table className="table w-full">
            <thead><tr><th>العميل</th><th>الجوال</th><th>النوع</th><th>الفواتير</th><th>آخر شراء</th><th>المستحق</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.id} className="cursor-pointer" onClick={() => setView(r.id)}><td className="font-medium">{r.name}{!r.active && <Badge>موقوف</Badge>}</td><td className="num">{r.phone ?? '—'}</td><td>{TYPES[r.type]}</td><td className="num">{r.invoices}</td><td className="text-sm">{date(r.lastPurchase)}</td><td className={r.due > 0 ? 'num text-amber-700 font-bold' : 'num'}>{money(r.due)}</td></tr>)}</tbody>
          </table></div>
        )}
        <Pager page={page} total={data?.total ?? 0} limit={25} onPage={setPage} />
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل العميل' : 'إضافة عميل'} size="lg">
        {form && <CustomerForm initial={form} onSaved={() => { setForm(null); qc.invalidateQueries({ queryKey: ['customer'] }); }} onCancel={() => setForm(null)} />}
      </Modal>
      <Drawer open={!!view} onClose={() => setView(null)} title={c?.name ?? 'تفاصيل العميل'}
        footer={c && <><Button variant="secondary" onClick={() => setForm(c)}><Pencil className="size-4" />تعديل</Button>{!c.invoicesCount && <Button variant="ghost" onClick={() => setDel(c.id)}><Trash2 className="size-4" />حذف</Button>}</>}>
        {!c ? <Spinner /> : <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Stat label="إجمالي الفواتير" value={money(c.totals.total)} /><Stat label="المحصّل" value={money(c.totals.paid)} /><Stat label="المستحق" value={money(c.due)} /><Stat label="نقاط الولاء" value={money(c.loyaltyPoints, 0)} /></div>
          <dl className="grid grid-cols-2 gap-3 text-[14px]">
            {[['الجوال', c.phone], ['البريد', c.email], ['الرقم الضريبي', c.vatNumber], ['السجل التجاري', c.crNumber], ['العنوان', [c.buildingNo, c.street, c.district, c.city, c.postalCode].filter(Boolean).join('، ')], ['تاريخ الإنشاء', date(c.createdAt)]].map(([k, v]) => <div key={k}><dt className="text-ink-500">{k}</dt><dd>{v || '—'}</dd></div>)}
          </dl>
          <section><h3 className="font-bold mb-2">الفواتير</h3>
            {!c.invoices.length ? <Empty title="لا فواتير" /> : <table className="table w-full"><thead><tr><th>الرقم</th><th>الإجمالي</th><th>المستحق</th><th>الحالة</th><th>التاريخ</th></tr></thead>
              <tbody>{c.invoices.map((i) => <tr key={i.id} className="cursor-pointer" onClick={() => setInv(i.id)}><td className="num">{i.number}</td><td className="num">{money(i.total)}</td><td className="num">{money(i.due)}</td><td><Badge tone={INVOICE_STATUS[i.status]?.tone}>{i.type === 'CREDIT_NOTE' ? 'مرتجع' : INVOICE_STATUS[i.status]?.label}</Badge></td><td className="text-sm">{date(i.createdAt)}</td></tr>)}</tbody></table>}
          </section>
        </div>}
      </Drawer>
      <InvoiceDrawer id={inv} onClose={() => setInv(null)} onOpen={setInv} />
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger title="حذف العميل" message="هل تريد حذف هذا العميل؟ لا يمكن التراجع عن الحذف." confirmText="حذف" />
    </>
  );
}
