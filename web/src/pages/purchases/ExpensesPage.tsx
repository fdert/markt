import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, date, PAYMENT_LABELS } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Empty, Input, Modal, NumberInput, PageHeader, Select, Spinner, Stat, Textarea, useToast } from '../../components/ui';

export default function ExpensesPage() {
  const { branchId, me } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [open, setOpen] = useState(false); const [newCat, setNewCat] = useState('');
  const [f, setF] = useState({ categoryId: '', branchId: String(branchId), amount: null as number | null, taxable: false, vendorName: '', vendorVat: '', paymentMethod: 'CASH', date: '', notes: '', recurring: '' });
  const { data, isLoading } = useQuery({ queryKey: ['expenses'], queryFn: () => api<{ rows: Array<{ id: number; number: string; category: string; branch: string; total: number; taxAmount: number; date: string; paymentMethod: string; notes: string | null; recurring: string | null; vendorName: string | null }>; stats: { total: number; tax: number; count: number } }>('/expenses') });
  const { data: cats } = useQuery({ queryKey: ['expense-cats'], queryFn: () => api<Array<{ id: number; name: string }>>('/expense-categories') });
  const save = useMutation({ mutationFn: () => api('/expenses', { body: { ...f, categoryId: Number(f.categoryId), branchId: Number(f.branchId), date: f.date || null, recurring: f.recurring || null } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); setOpen(false); toast.success('تم تسجيل المصروف.'); }, onError: toast.error });
  const addCat = useMutation({ mutationFn: () => api<{ id: number }>('/expense-categories', { body: { name: newCat } }), onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['expense-cats'] }); setF({ ...f, categoryId: String(c.id) }); setNewCat(''); }, onError: toast.error });
  return (
    <>
      <PageHeader title="المصروفات" actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" />إضافة مصروف</Button>} />
      <div className="grid grid-cols-3 gap-3 mb-5"><Stat label="إجمالي المصروفات" value={money(data?.stats.total)} /><Stat label="ضريبة المدخلات" value={money(data?.stats.tax)} /><Stat label="عدد العمليات" value={data?.stats.count ?? 0} /></div>
      <Card bodyClass="!p-0">{isLoading ? <Spinner /> : !data?.rows.length ? <Empty title="لا مصروفات" /> : (
        <table className="table w-full"><thead><tr><th>الرقم</th><th>التصنيف</th><th>الفرع</th><th>المبلغ</th><th>الضريبة</th><th>الدفع</th><th>التاريخ</th></tr></thead>
          <tbody>{data.rows.map((r) => <tr key={r.id}><td className="num">{r.number}{r.recurring && <Badge tone="blue">متكرر</Badge>}</td><td>{r.category}{r.notes && <span className="block text-xs text-ink-500">{r.notes}</span>}</td><td>{r.branch}</td><td className="num">{money(r.total)}</td><td className="num">{money(r.taxAmount)}</td><td>{PAYMENT_LABELS[r.paymentMethod]}</td><td className="text-sm">{date(r.date)}</td></tr>)}</tbody></table>
      )}</Card>
      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل مصروف" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>تسجيل المصروف</Button>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Select label="التصنيف" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">اختر التصنيف</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <div className="flex gap-2 items-end"><Input label="تصنيف جديد" value={newCat} onChange={(e) => setNewCat(e.target.value)} /><Button variant="secondary" disabled={newCat.length < 2} onClick={() => addCat.mutate()}>إضافة</Button></div>
          <NumberInput label="المبلغ قبل الضريبة" suffix="ر.س" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          <Select label="الفرع" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          <Select label="طريقة الدفع" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}><option value="CASH">نقدي</option><option value="CARD">شبكة</option><option value="BANK_TRANSFER">تحويل بنكي</option></Select>
          <Input label="التاريخ" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <Input label="اسم المورد" value={f.vendorName} onChange={(e) => setF({ ...f, vendorName: e.target.value })} />
          <Input label="الرقم الضريبي للمورد" dir="ltr" value={f.vendorVat} onChange={(e) => setF({ ...f, vendorVat: e.target.value })} />
          <Select label="التكرار" value={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.value })}><option value="">مرة واحدة</option><option value="MONTHLY">شهري</option><option value="WEEKLY">أسبوعي</option></Select>
          <div className="flex items-end pb-2"><Checkbox checked={f.taxable} onChange={(v) => setF({ ...f, taxable: v })} label="خاضع للضريبة (15%)" /></div>
          <div className="sm:col-span-2"><Textarea label="ملاحظات" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
      </Modal>
    </>
  );
}
