import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Download } from 'lucide-react';
import { api, download } from '../../lib/api';
import { money, dateTime, INVOICE_STATUS, ZATCA_STATUS, CHANNEL_LABELS, PAYMENT_LABELS } from '../../lib/format';
import { Badge, Button, Card, Empty, Input, PageHeader, Pager, SearchInput, Select, Spinner, Stat, Tabs, useDebounced, useToast } from '../../components/ui';
import { InvoiceDrawer } from './InvoiceDrawer';

interface Row { id: number; number: string; kind: string; type: string; status: string; channel: string; total: number; due: number; createdAt: string; customer: string | null; user: string; zatcaStatus: string; paymentMethods: string | null }

export default function InvoicesPage() {
  const toast = useToast();
  const [status, setStatus] = useState(''); const [search, setSearch] = useState(''); const ds = useDebounced(search);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [channel, setChannel] = useState(''); const [userId, setUserId] = useState('');
  const [page, setPage] = useState(1); const [open, setOpen] = useState<number | null>(null);
  const query = { status, search: ds, from, to, channel, userId, page, limit: 25 };
  const { data, isLoading } = useQuery({ queryKey: ['invoices', query], queryFn: () => api<{ rows: Row[]; total: number; summary: { net: number; count: number; due: number; returns: number; returnsCount: number; tax: number } }>('/invoices', { query }) });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api<Array<{ id: number; name: string }>>('/users') });
  const s = data?.summary;
  return (
    <>
      <PageHeader title="الفواتير" subtitle="كل فواتير البيع والمرتجعات وعروض الأسعار"
        actions={<><Button variant="secondary" onClick={() => download('/invoices/export', 'invoices.xlsx', { status, search: ds, from, to, channel, userId }).catch(toast.error)}><Download className="size-4" />تصدير Excel</Button><Link to="/pos" className="btn-primary"><Plus className="size-4" />فاتورة جديدة</Link></>} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <Stat label="صافي المبيعات" value={money(s?.net)} sub="ر.س" />
        <Stat label="عدد الفواتير" value={s?.count ?? 0} />
        <Stat label="المتبقّي (ذمم)" value={money(s?.due)} sub={s?.due ? 'مستحق على العملاء' : 'لا مستحق'} />
        <Stat label="المرتجعات" value={money(s?.returns)} sub={`${s?.returnsCount ?? 0} فاتورة مرتجعة`} />
        <Stat label="الضريبة" value={money(s?.tax)} sub="بعد طرح ضريبة المرتجعات" />
      </div>
      <Card bodyClass="!p-0">
        <div className="p-4 pb-0">
          <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ value: '', label: 'الكل' }, { value: 'paid', label: 'مدفوعة' }, { value: 'credit', label: 'آجلة' }, { value: 'drafts', label: 'مسودات وعروض' }, { value: 'returns', label: 'مرتجعات' }, { value: 'zatca_pending', label: 'بانتظار الإبلاغ' }]} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2 mb-4">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="رقم الفاتورة أو اسم العميل أو جواله" className="lg:col-span-2" />
            <Input type="date" aria-label="من تاريخ" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" aria-label="إلى تاريخ" value={to} onChange={(e) => setTo(e.target.value)} />
              <Select aria-label="القناة" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">كل القنوات</option><option value="POS">نقطة البيع</option><option value="ONLINE">المتجر الإلكتروني</option><option value="ORDER">طلبات</option></Select>
              <Select aria-label="الموظف" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">كل الموظفين</option>{users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          </div>
        </div>
        {isLoading ? <Spinner /> : !data?.rows.length ? <Empty title="لا توجد فواتير مطابقة" hint="جرّب توسيع المدى الزمني أو مسح الفلاتر." /> : (
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead><tr><th>الرقم</th><th>العميل</th><th>الإجمالي</th><th>الحالة</th><th>الدفع</th><th>القناة</th><th>الفوترة</th><th>التاريخ</th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}>
                  <td><span className="num font-medium text-brand-800">{r.number}</span>{r.type === 'CREDIT_NOTE' && <span className="ms-1"><Badge tone="red">إشعار دائن</Badge></span>}{r.type === 'QUOTE' && <span className="ms-1"><Badge>عرض سعر</Badge></span>}{r.kind === 'STANDARD' && r.type === 'INVOICE' && <span className="ms-1"><Badge tone="blue">ضريبية</Badge></span>}</td>
                  <td>{r.customer ?? <span className="text-ink-400">عميل نقدي</span>}</td>
                  <td className="num font-medium">{money(r.total)}{r.due > 0 && <span className="block text-xs text-amber-700">متبقٍ {money(r.due)}</span>}</td>
                  <td><Badge tone={INVOICE_STATUS[r.status]?.tone}>{INVOICE_STATUS[r.status]?.label}</Badge></td>
                  <td className="text-sm">{r.paymentMethods?.split(',').map((m) => PAYMENT_LABELS[m]).join('، ') ?? '—'}</td>
                  <td className="text-sm">{CHANNEL_LABELS[r.channel]}</td>
                  <td><Badge tone={ZATCA_STATUS[r.zatcaStatus]?.tone}>{ZATCA_STATUS[r.zatcaStatus]?.label}</Badge></td>
                  <td className="text-sm text-ink-600 whitespace-nowrap">{dateTime(r.createdAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pager page={page} total={data?.total ?? 0} limit={25} onPage={setPage} />
      </Card>
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} onOpen={setOpen} />
    </>
  );
}
