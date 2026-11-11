import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, qty } from '../../lib/format';
import { Badge, Button, Card, Drawer, Empty, Modal, NumberInput, PageHeader, Select, Spinner, Stat, Tabs, Textarea, useDebounced, useToast } from '../../components/ui';

const ST: Record<string, { l: string; t: 'gray' | 'amber' | 'green' | 'red' }> = { DRAFT: { l: 'مسودّة', t: 'gray' }, IN_TRANSIT: { l: 'قيد النقل', t: 'amber' }, RECEIVED: { l: 'مستلَم', t: 'green' }, CANCELLED: { l: 'ملغى', t: 'red' } };

export default function TransfersPage() {
  const { me } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [status, setStatus] = useState(''); const [creating, setCreating] = useState(false); const [view, setView] = useState<number | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['transfers', status], queryFn: () => api<{ rows: Array<{ id: number; number: string; status: string; fromName: string; toName: string; itemsCount: number; createdAt: string }>; stats: Record<string, number> }>('/inventory/transfers', { query: { status } }) });
  const { data: detail } = useQuery({ queryKey: ['transfer', view], queryFn: () => api<{ id: number; number: string; status: string; notes: string | null; createdAt: string; receivedAt: string | null; items: Array<{ id: number; name: string; qty: number }> }>(`/inventory/transfers/${view}`), enabled: !!view });
  const act = useMutation({ mutationFn: (a: string) => api(`/inventory/transfers/${view}/${a}`, { body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['transfers'] }); qc.invalidateQueries({ queryKey: ['transfer'] }); toast.success('تم التحديث.'); }, onError: toast.error });
  return (
    <>
      <PageHeader title="تحويلات المخزون" subtitle="نقل البضاعة بين الفروع والمستودعات" actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" />تحويل جديد</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Stat label="إجمالي التحويلات" value={data?.stats.total ?? 0} /><Stat label="بانتظار الاستلام" value={data?.stats.pending ?? 0} /><Stat label="مستلَم" value={data?.stats.received ?? 0} /><Stat label="ملغى" value={data?.stats.cancelled ?? 0} /></div>
      <Card bodyClass="!p-0">
        <div className="px-4 pt-3"><Tabs value={status} onChange={setStatus} items={[{ value: '', label: 'الكل' }, { value: 'DRAFT', label: 'مسودّة' }, { value: 'IN_TRANSIT', label: 'قيد النقل' }, { value: 'RECEIVED', label: 'مستلَم' }, { value: 'CANCELLED', label: 'ملغى' }]} /></div>
        {isLoading ? <Spinner /> : !data?.rows.length ? <Empty title="لا تحويلات" /> : (
          <table className="table w-full"><thead><tr><th>الرقم</th><th>من ← إلى</th><th>البنود</th><th>الحالة</th><th>التاريخ</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.id} className="cursor-pointer" onClick={() => setView(r.id)}><td className="num font-medium">{r.number}</td><td>{r.fromName} ← {r.toName}</td><td className="num">{r.itemsCount}</td><td><Badge tone={ST[r.status].t}>{ST[r.status].l}</Badge></td><td className="text-sm">{dateTime(r.createdAt)}</td></tr>)}</tbody></table>
        )}
      </Card>
      <NewTransfer open={creating} onClose={() => setCreating(false)} branches={me?.branches ?? []} />
      <Drawer open={!!view} onClose={() => setView(null)} title={`تفاصيل التحويل ${detail?.number ?? ''}`}
        footer={detail && <>{detail.status === 'DRAFT' && <Button onClick={() => act.mutate('send')}>إرسال</Button>}{(detail.status === 'DRAFT' || detail.status === 'IN_TRANSIT') && <><Button onClick={() => act.mutate('receive')}>استلام</Button><Button variant="danger" onClick={() => act.mutate('cancel')}>إلغاء التحويل</Button></>}</>}>
        {!detail ? <Spinner /> : <div className="space-y-4">
          <div className="flex gap-2"><Badge tone={ST[detail.status].t}>{ST[detail.status].l}</Badge></div>
          <p className="text-sm text-ink-600">أُنشئ {dateTime(detail.createdAt)} · {detail.receivedAt ? `استُلم ${dateTime(detail.receivedAt)}` : 'لم يتم الاستلام'}</p>
          <table className="table w-full"><thead><tr><th>البند</th><th>الكمية</th></tr></thead><tbody>{detail.items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="num">{qty(i.qty)}</td></tr>)}</tbody></table>
          {detail.notes && <p className="text-sm">ملاحظة: {detail.notes}</p>}
          <p className="text-[13px] text-ink-500">ينتقل المخزون بين الفرعين عند تأكيد الاستلام.</p>
        </div>}
      </Drawer>
    </>
  );
}

function NewTransfer({ open, onClose, branches }: { open: boolean; onClose: () => void; branches: Array<{ id: number; name: string }> }) {
  const qc = useQueryClient(); const toast = useToast();
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Array<{ productId: number; name: string; qty: number }>>([]);
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const { data } = useQuery({ queryKey: ['products', 'transfer', dq], queryFn: () => api<{ rows: Array<{ id: number; name: string; barcode: string | null }> }>('/products', { query: { search: dq, limit: 8 } }), enabled: dq.length > 1 });
  const save = useMutation({ mutationFn: (send: boolean) => api('/inventory/transfers', { body: { fromBranchId: Number(from), toBranchId: Number(to), notes: notes || null, send, items: items.map(({ productId, qty }) => ({ productId, qty })) } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['transfers'] }); toast.success('تم الحفظ.'); setItems([]); onClose(); }, onError: toast.error });
  return (
    <Modal open={open} onClose={onClose} title="تحويل جديد" size="lg" footer={<><Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending}>حفظ كمسودة</Button><Button onClick={() => save.mutate(true)} loading={save.isPending}>حفظ وإرسال</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <Select label="من فرع" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">اختر فرع المصدر</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        <Select label="إلى فرع" value={to} onChange={(e) => setTo(e.target.value)}><option value="">اختر فرع الوجهة</option>{branches.filter((b) => String(b.id) !== from).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
      </div>
      <div className="relative mb-3">
        <input className="input" placeholder="ابحث بالاسم أو الباركود" value={q} onChange={(e) => setQ(e.target.value)} aria-label="إضافة بند" />
        {data && dq.length > 1 && <ul className="absolute z-10 inset-x-0 mt-1 card p-1 max-h-56 overflow-auto">{data.rows.map((r) => <li key={r.id}><button className="w-full text-start px-3 py-2 rounded hover:bg-ink-50" onClick={() => { if (!items.some((i) => i.productId === r.id)) setItems([...items, { productId: r.id, name: r.name, qty: 1 }]); setQ(''); }}>{r.name}</button></li>)}</ul>}
      </div>
      {!items.length ? <Empty title="أضف الأصناف إلى التحويل" hint="ابحث بالاسم أو الباركود وحدد كمية كل صنف." /> : (
        <table className="table w-full mb-3"><thead><tr><th>البند</th><th>الكمية</th><th /></tr></thead><tbody>{items.map((i, idx) => <tr key={i.productId}><td>{i.name}</td><td className="w-36"><NumberInput aria-label="الكمية" value={i.qty} onChange={(v) => setItems(items.map((x, j) => j === idx ? { ...x, qty: v ?? 0 } : x))} /></td><td><Button variant="ghost" aria-label="حذف" onClick={() => setItems(items.filter((_, j) => j !== idx))}><Trash2 className="size-4" /></Button></td></tr>)}</tbody></table>
      )}
      <Textarea label="الملاحظة" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Modal>
  );
}
