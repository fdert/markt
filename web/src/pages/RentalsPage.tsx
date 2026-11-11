import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, dateTime } from '../lib/format';
import { Badge, Button, Card, Empty, Modal, NumberInput, PageHeader, Select, Spinner, Stat, Tabs, Textarea, useToast } from '../components/ui';

export default function RentalsPage() {
  const { branchId } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [status, setStatus] = useState(''); const [open, setOpen] = useState(false); const [ret, setRet] = useState<{ id: number; deposit: number } | null>(null); const [ded, setDed] = useState<number | null>(0);
  const [f, setF] = useState({ customerId: '', productId: '', qty: 1 as number | null, periods: 1 as number | null, paymentMethod: 'CASH', notes: '' });
  const { data, isLoading } = useQuery({ queryKey: ['rentals', status], queryFn: () => api<{ rows: Array<{ id: number; number: string; customer: string; product: string; qty: number; startAt: string; dueAt: string; deposit: number; amount: number; status: string; overdue: boolean }>; stats: { active: number; overdue: number; deposits: number; returnedMonth: number } }>('/rentals', { query: { status } }) });
  const { data: customers } = useQuery({ queryKey: ['customers', 'all'], queryFn: () => api<{ rows: Array<{ id: number; name: string }> }>('/customers', { query: { limit: 500 } }), enabled: open });
  const { data: products } = useQuery({ queryKey: ['products', 'rental'], queryFn: () => api<{ rows: Array<{ id: number; name: string }> }>('/products', { query: { type: 'RENTAL', limit: 200 } }), enabled: open });
  const create = useMutation({ mutationFn: () => api('/rentals', { body: { customerId: Number(f.customerId), productId: Number(f.productId), branchId, qty: f.qty, periods: f.periods, paymentMethod: f.paymentMethod, notes: f.notes || null } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['rentals'] }); setOpen(false); toast.success('تم إنشاء العقد وإصدار الفاتورة.'); }, onError: toast.error });
  const doReturn = useMutation({ mutationFn: () => api(`/rentals/${ret!.id}/return`, { body: { deduction: ded ?? 0 } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['rentals'] }); setRet(null); toast.success('تم الإرجاع.'); }, onError: toast.error });
  return (
    <>
      <PageHeader title="عقود الإيجار" actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" />عقد إيجار جديد</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Stat label="قيد الإيجار" value={data?.stats.active ?? 0} /><Stat label="متأخرة" value={data?.stats.overdue ?? 0} /><Stat label="تأمينات محجوزة" value={money(data?.stats.deposits)} /><Stat label="أُعيدت هذا الشهر" value={data?.stats.returnedMonth ?? 0} /></div>
      <Card bodyClass="!p-0">
        <div className="px-4 pt-3"><Tabs value={status} onChange={setStatus} items={[{ value: '', label: 'الكل' }, { value: 'ACTIVE', label: 'مؤجر' }, { value: 'RETURNED', label: 'أُعيد' }]} /></div>
        {isLoading ? <Spinner /> : !data?.rows.length ? <Empty title="لا عقود" /> : (
          <table className="table w-full"><thead><tr><th>العقد</th><th>العميل</th><th>الأصناف</th><th>مدة الإيجار</th><th>المبلغ</th><th>التأمين</th><th>الحالة</th><th /></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.id}><td className="num">{r.number}</td><td>{r.customer}</td><td>{r.product} × <span className="num">{r.qty}</span></td><td className="text-sm">{dateTime(r.startAt)}<span className="block text-ink-500">حتى {dateTime(r.dueAt)}</span></td><td className="num">{money(r.amount)}</td><td className="num">{money(r.deposit)}</td>
              <td>{r.status === 'ACTIVE' ? (r.overdue ? <Badge tone="red">متأخر</Badge> : <Badge tone="amber">مؤجر</Badge>) : <Badge tone="green">أُعيد</Badge>}</td><td>{r.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => { setRet({ id: r.id, deposit: r.deposit }); setDed(0); }}>إرجاع</Button>}</td></tr>)}</tbody></table>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="عقد إيجار جديد" footer={<Button loading={create.isPending} onClick={() => create.mutate()}>إنشاء العقد</Button>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Select label="العميل" value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">اختر العميل</option>{customers?.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select label="الصنف المؤجر" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="">اختر</option>{products?.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <NumberInput label="الكمية" value={f.qty} onChange={(v) => setF({ ...f, qty: v })} />
          <NumberInput label="المدة (بوحدة الإيجار)" value={f.periods} onChange={(v) => setF({ ...f, periods: v })} />
          <Select label="طريقة الدفع" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}><option value="CASH">نقدي</option><option value="CARD">شبكة</option><option value="BANK_TRANSFER">تحويل</option></Select>
          <div className="sm:col-span-2"><Textarea label="ملاحظات" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
      </Modal>
      <Modal open={!!ret} onClose={() => setRet(null)} title="إرجاع الأصناف المؤجرة" size="sm" footer={<Button loading={doReturn.isPending} onClick={() => doReturn.mutate()}>تأكيد الإرجاع</Button>}>
        <p className="text-sm text-ink-600 mb-3">عند التأكيد تعود الأصناف إلى مخزون الفرع ويُغلق العقد بحالة «أُعيد». التأمين: <b className="num">{money(ret?.deposit)}</b></p>
        <NumberInput label="خصم من التأمين (تلف أو تأخير)" value={ded} onChange={setDed} />
      </Modal>
    </>
  );
}
