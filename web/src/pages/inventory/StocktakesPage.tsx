// جلسات الجرد: فترة لكل فرع، عدّ بالباركود، مراجعة الفروقات، ثم الاعتماد
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ScanLine, CheckCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, qty, date, isoDate } from '../../lib/format';
import { normalizeScan } from '../../lib/scan';
import { Badge, Button, Card, Confirm, Drawer, Empty, Input, Modal, NumberInput, PageHeader, Segmented, Select, Spinner, clsx, useToast } from '../../components/ui';

interface St { id: number; number: string; name: string; branch: string; startDate: string; endDate: string; status: string; items: number; counted: number }
interface Item { id: number; productId: number; name: string; barcode: string | null; systemQty: number; countedQty: number | null; unitCost: number }
const ST: Record<string, { l: string; t: 'green' | 'amber' | 'gray' }> = { OPEN: { l: 'مفتوح', t: 'amber' }, APPROVED: { l: 'معتمد', t: 'green' }, CANCELLED: { l: 'ملغى', t: 'gray' } };

export default function StocktakesPage() {
  const { me, branchId } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [creating, setCreating] = useState(false); const [open, setOpen] = useState<number | null>(null);
  const [f, setF] = useState({ name: '', branchId: String(branchId), startDate: isoDate(), endDate: isoDate(new Date(Date.now() + 7 * 86400000)), categoryId: '' });
  const { data } = useQuery({ queryKey: ['stocktakes'], queryFn: () => api<St[]>('/stocktakes') });
  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: number; name: string }>>('/categories') });
  const create = useMutation({ mutationFn: () => api<{ id: number }>('/stocktakes', { body: { ...f, branchId: Number(f.branchId), categoryId: f.categoryId ? Number(f.categoryId) : null } }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['stocktakes'] }); setCreating(false); setOpen(r.id); }, onError: toast.error });
  return (
    <>
      <PageHeader title="جرد المخزون" subtitle="افتح فترة جرد لكل فرع، امسح الأصناف بالباركود، راجع الفروقات ثم اعتمد." actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" />جرد جديد</Button>} />
      <Card bodyClass="!p-0">{!data ? <Spinner /> : !data.length ? <Empty title="لا جرد بعد" /> : (
        <table className="table w-full"><thead><tr><th>الجرد</th><th>الفرع</th><th>الفترة</th><th>التقدم</th><th>الحالة</th></tr></thead>
          <tbody>{data.map((s) => <tr key={s.id} className="cursor-pointer" onClick={() => setOpen(s.id)}><td><b>{s.name}</b><span className="block text-xs text-ink-500 num">{s.number}</span></td><td>{s.branch}</td><td className="text-sm">{date(s.startDate)} — {date(s.endDate)}</td>
            <td><div className="w-32 h-2 rounded-full bg-ink-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${s.items ? (s.counted / s.items) * 100 : 0}%` }} /></div><span className="text-xs text-ink-500 num">{s.counted} / {s.items}</span></td>
            <td><Badge tone={ST[s.status].t}>{ST[s.status].l}</Badge></td></tr>)}</tbody></table>
      )}</Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="جرد جديد" footer={<Button loading={create.isPending} onClick={() => create.mutate()}>بدء الجرد</Button>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="اسم الجرد" placeholder="جرد نهاية الشهر" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select label="الفرع" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          <Input label="من" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          <Input label="إلى" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          <Select label="التصنيف (اختياري)" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">كل المنتجات</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </div>
        <p className="text-[13px] text-ink-500 mt-3">تُحفظ الكميات الحالية لحظة البدء، ويُحسب الفرق = المعدود − الكمية المحفوظة.</p>
      </Modal>
      <StocktakeDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function StocktakeDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [code, setCode] = useState(''); const [mode, setMode] = useState<'ADD' | 'SET'>('ADD'); const [filter, setFilter] = useState<'all' | 'diff' | 'pending'>('all');
  const [confirm, setConfirm] = useState(false); const scanRef = useRef<HTMLInputElement>(null);
  const { data } = useQuery({ queryKey: ['stocktake', id], queryFn: () => api<St & { items: Item[]; branchId: number }>(`/stocktakes/${id}`), enabled: !!id });
  const count = useMutation({ mutationFn: (b: { code?: string; productId?: number; qty: number; mode: string }) => api(`/stocktakes/${id}/count`, { body: b }), onSuccess: () => qc.invalidateQueries({ queryKey: ['stocktake', id] }), onError: toast.error });
  const approve = useMutation({ mutationFn: () => api<{ adjusted: number; value: number }>(`/stocktakes/${id}/approve`, { body: {} }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['stocktakes'] }); qc.invalidateQueries({ queryKey: ['stocktake'] }); setConfirm(false); toast.success(`تم اعتماد الجرد: ${r.adjusted} صنف بفروقات بقيمة ${money(r.value)}.`); }, onError: toast.error });
  const open = data?.status === 'OPEN';
  const items = (data?.items ?? []).filter((i) => filter === 'all' || (filter === 'pending' ? i.countedQty == null : i.countedQty != null && i.countedQty !== i.systemQty));
  const diffValue = (data?.items ?? []).reduce((s, i) => s + (i.countedQty != null ? (i.countedQty - i.systemQty) * i.unitCost : 0), 0);
  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-4xl" title={data ? `${data.name} · ${data.number}` : 'الجرد'} footer={open && <Button onClick={() => setConfirm(true)}><CheckCheck className="size-4" />اعتماد الجرد</Button>}>
      {!data ? <Spinner /> : <div className="space-y-4">
        {open && <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (!code.trim()) return; count.mutate({ code: normalizeScan(code), qty: 1, mode: 'ADD' }); setCode(''); scanRef.current?.focus(); }}>
          <div className="relative flex-1"><ScanLine className="absolute top-1/2 -translate-y-1/2 start-3 size-5 text-ink-400" /><input ref={scanRef} autoFocus className="input ps-10 !h-12" placeholder="امسح الباركود: كل مسحة تضيف 1" value={code} onChange={(e) => setCode(e.target.value)} aria-label="مسح الباركود للجرد" /></div>
          <Button type="submit" className="!h-12">إضافة</Button>
        </form>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented value={filter} onChange={setFilter} items={[{ value: 'all', label: 'الكل' }, { value: 'pending', label: 'لم يُعدّ' }, { value: 'diff', label: 'بفروقات' }]} />
          <span className="text-sm">قيمة الفروقات: <b className={clsx('num', diffValue < 0 ? 'text-red-600' : 'text-emerald-700')}>{money(diffValue)}</b></span>
        </div>
        {open && <Segmented value={mode} onChange={setMode} items={[{ value: 'ADD', label: 'إضافة للمعدود' }, { value: 'SET', label: 'استبدال المعدود' }]} />}
        <table className="table w-full"><thead><tr><th>الصنف</th><th>الكمية المحفوظة</th><th>المعدود</th><th>الفرق</th></tr></thead>
          <tbody>{items.map((i) => { const d = i.countedQty != null ? i.countedQty - i.systemQty : null; return (
            <tr key={i.id}><td>{i.name}<span className="block text-xs text-ink-500 num">{i.barcode}</span></td><td className="num">{qty(i.systemQty)}</td>
              <td className="w-36">{open ? <NumberInput aria-label={`المعدود من ${i.name}`} value={i.countedQty} onChange={() => undefined} onBlur={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && v !== i.countedQty) count.mutate({ productId: i.productId, qty: v, mode: 'SET' }); }} /> : <span className="num">{i.countedQty != null ? qty(i.countedQty) : '—'}</span>}</td>
              <td className={clsx('num font-bold', d == null ? 'text-ink-400' : d < 0 ? 'text-red-600' : d > 0 ? 'text-emerald-700' : '')}>{d == null ? '—' : `${d > 0 ? '+' : ''}${qty(d)}`}</td></tr>
          ); })}</tbody></table>
      </div>}
      <Confirm open={confirm} onClose={() => setConfirm(false)} onConfirm={() => approve.mutate()} loading={approve.isPending} title="اعتماد الجرد" message="ستُعدَّل كميات الأصناف المعدودة حسب الفروقات ويُسجَّل قيد محاسبي. الأصناف غير المعدودة لا تتغير. لا يمكن التراجع." confirmText="اعتماد" />
    </Drawer>
  );
}
