// المخزون التالف: تسجيل الأصناف التالفة أو منتهية الصلاحية مع قيدها المحاسبي
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, qty, dateTime } from '../../lib/format';
import { Button, Card, Empty, Input, Modal, NumberInput, PageHeader, Select, Spinner, Stat, useDebounced, useToast } from '../../components/ui';

export default function DamagedPage() {
  const { me, branchId } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [f, setF] = useState<{ branchId: string; product: { id: number; name: string } | null; qty: number | null; reason: string }>({ branchId: String(branchId), product: null, qty: 1, reason: '' });
  const { data } = useQuery({ queryKey: ['damaged'], queryFn: () => api<Array<{ id: number; product: string; branch: string; qty: number; unitCost: number | null; note: string | null; user: string | null; createdAt: string }>>('/inventory/damaged') });
  const { data: found } = useQuery({ queryKey: ['products', 'dmg', dq], queryFn: () => api<{ rows: Array<{ id: number; name: string }> }>('/products', { query: { search: dq, limit: 8 } }), enabled: dq.length > 1 });
  const save = useMutation({ mutationFn: () => api('/inventory/damaged', { body: { branchId: Number(f.branchId), productId: f.product?.id, qty: f.qty, reason: f.reason } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['damaged'] }); setOpen(false); toast.success('تم تسجيل التالف.'); }, onError: toast.error });
  const total = (data ?? []).reduce((s, r) => s + Math.abs(r.qty) * (r.unitCost ?? 0), 0);
  return (
    <>
      <PageHeader title="المخزون التالف" subtitle="الأصناف التالفة والمنتهية والمصروفة داخلياً" actions={<Button onClick={() => { setOpen(true); setF({ branchId: String(branchId), product: null, qty: 1, reason: '' }); }}><Plus className="size-4" />إضافة منتج تالف</Button>} />
      <div className="grid grid-cols-2 gap-3 mb-5 max-w-lg"><Stat label="عدد الحركات" value={data?.length ?? 0} /><Stat label="قيمة التالف بالتكلفة" value={money(total)} /></div>
      <Card bodyClass="!p-0">{!data ? <Spinner /> : !data.length ? <Empty title="لا يوجد مخزون تالف" /> : (
        <table className="table w-full"><thead><tr><th>المنتج</th><th>الكمية</th><th>القيمة</th><th>السبب</th><th>الفرع</th><th>التاريخ</th></tr></thead>
          <tbody>{data.map((r) => <tr key={r.id}><td>{r.product}</td><td className="num">{qty(Math.abs(r.qty))}</td><td className="num">{money(Math.abs(r.qty) * (r.unitCost ?? 0))}</td><td className="text-sm">{r.note}</td><td>{r.branch}</td><td className="text-sm">{dateTime(r.createdAt)}<span className="block text-xs text-ink-500">{r.user}</span></td></tr>)}</tbody></table>
      )}</Card>
      <Modal open={open} onClose={() => setOpen(false)} title="إضافة منتج تالف" footer={<Button loading={save.isPending} disabled={!f.product} onClick={() => save.mutate()}>حفظ</Button>}>
        <div className="space-y-3">
          <Select label="الفرع" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          {f.product ? <div className="flex justify-between items-center rounded-lg bg-brand-50 px-3 py-2"><b>{f.product.name}</b><Button size="sm" variant="ghost" onClick={() => setF({ ...f, product: null })}>تغيير</Button></div> : (
            <div className="relative"><Input label="المنتج" placeholder="ابحث بالاسم أو الباركود" value={q} onChange={(e) => setQ(e.target.value)} />
              {found && dq.length > 1 && <ul className="absolute z-10 inset-x-0 mt-1 card p-1 max-h-48 overflow-auto">{found.rows.map((r) => <li key={r.id}><button className="w-full text-start px-3 py-2 rounded hover:bg-ink-50" onClick={() => { setF({ ...f, product: r }); setQ(''); }}>{r.name}</button></li>)}</ul>}</div>
          )}
          <NumberInput label="الكمية" value={f.qty} onChange={(v) => setF({ ...f, qty: v })} />
          <Input label="سبب التلف" placeholder="انتهاء الصلاحية، كسر، سوء تخزين…" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
