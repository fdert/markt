import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { Button, Card, Empty, Input, Modal, PageHeader, SearchInput, Spinner, Textarea, useDebounced, useToast } from '../../components/ui';

interface Sup { id: number; name: string; phone: string | null; email: string | null; vatNumber: string | null; crNumber: string | null; city: string | null; address: string | null; notes: string | null; balance: number; purchasesTotal: number }

export default function SuppliersPage() {
  const qc = useQueryClient(); const toast = useToast();
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [edit, setEdit] = useState<Partial<Sup> | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['suppliers', dq], queryFn: () => api<Sup[]>('/suppliers', { query: { search: dq } }) });
  const save = useMutation({ mutationFn: () => api(edit!.id ? `/suppliers/${edit!.id}` : '/suppliers', { method: edit!.id ? 'PUT' : 'POST', body: { name: edit!.name, phone: edit!.phone || null, email: edit!.email || '', vatNumber: edit!.vatNumber || '', crNumber: edit!.crNumber || null, city: edit!.city || null, address: edit!.address || null, notes: edit!.notes || null } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setEdit(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const f = (k: keyof Sup) => ({ value: (edit?.[k] as string) ?? '', onChange: (e: { target: { value: string } }) => setEdit({ ...edit, [k]: e.target.value }) });
  return (
    <>
      <PageHeader title="الموردون" actions={<Button onClick={() => setEdit({})}><Plus className="size-4" />إضافة مورّد</Button>} />
      <Card bodyClass="!p-0">
        <div className="p-4 max-w-sm"><SearchInput value={q} onChange={setQ} placeholder="ابحث باسم المورد" /></div>
        {isLoading ? <Spinner /> : !data?.length ? <Empty title="لا موردين بعد" /> : (
          <table className="table w-full"><thead><tr><th>المورد</th><th>الجوال</th><th>الرقم الضريبي</th><th>إجمالي المشتريات</th><th>الرصيد المستحق</th><th /></tr></thead>
            <tbody>{data.map((s) => <tr key={s.id}><td className="font-medium">{s.name}</td><td className="num">{s.phone ?? '—'}</td><td className="num">{s.vatNumber ?? '—'}</td><td className="num">{money(s.purchasesTotal)}</td><td className={s.balance > 0 ? 'num text-amber-700 font-bold' : 'num'}>{money(s.balance)}</td><td><Button size="sm" variant="ghost" aria-label="تعديل" onClick={() => setEdit(s)}><Pencil className="size-4" /></Button></td></tr>)}</tbody></table>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل المورد' : 'إضافة مورّد'} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>حفظ</Button>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="اسم المورد" required {...f('name')} className="" /><Input label="الجوال" dir="ltr" {...f('phone')} />
          <Input label="البريد الإلكتروني" dir="ltr" {...f('email')} /><Input label="الرقم الضريبي" dir="ltr" maxLength={15} {...f('vatNumber')} />
          <Input label="السجل التجاري" dir="ltr" {...f('crNumber')} /><Input label="المدينة" {...f('city')} />
          <div className="sm:col-span-2"><Input label="العنوان" {...f('address')} /></div>
          <div className="sm:col-span-2"><Textarea label="ملاحظات" {...f('notes')} /></div>
        </div>
      </Modal>
    </>
  );
}
