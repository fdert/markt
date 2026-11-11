import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, date, qty } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Drawer, Empty, Input, Modal, NumberInput, PageHeader, Select, Spinner, Stat, Textarea, useDebounced, useToast } from '../../components/ui';

interface Row { id: number; number: string; isReturn: boolean; date: string; status: string; total: number; paid: number; taxTotal: number; supplier: string | null; branch: string; supplierInvoiceNo: string | null }

export default function PurchasesPage() {
  const qc = useQueryClient(); const toast = useToast();
  const [creating, setCreating] = useState<null | 'purchase' | 'return'>(null); const [view, setView] = useState<number | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['purchases'], queryFn: () => api<{ rows: Row[]; stats: { total: number; tax: number; due: number; drafts: number } }>('/purchases') });
  const { data: d } = useQuery({ queryKey: ['purchase', view], queryFn: () => api<Row & { notes: string | null; subtotal: number; items: Array<{ id: number; name: string; qty: number; unitCost: number; taxAmount: number; total: number }> }>(`/purchases/${view}`), enabled: !!view });
  const approve = useMutation({ mutationFn: () => api(`/purchases/${view}/approve`, { body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['purchase'] }); toast.success('تم الاعتماد.'); }, onError: toast.error });
  const pay = useMutation({ mutationFn: (amount: number) => api(`/purchases/${view}/pay`, { body: { amount, method: 'CASH' } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['purchase'] }); toast.success('تم تسجيل السداد.'); }, onError: toast.error });
  return (
    <>
      <PageHeader title="المشتريات" actions={<><Button variant="secondary" onClick={() => setCreating('return')}>مرتجع مشتريات</Button><Button onClick={() => setCreating('purchase')}><Plus className="size-4" />فاتورة شراء جديدة</Button></>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Stat label="إجمالي المشتريات" value={money(data?.stats.total)} /><Stat label="ضريبة المدخلات" value={money(data?.stats.tax)} /><Stat label="مستحق للموردين" value={money(data?.stats.due)} /><Stat label="مسودات" value={data?.stats.drafts ?? 0} /></div>
      <Card bodyClass="!p-0">{isLoading ? <Spinner /> : !data?.rows.length ? <Empty title="لا فواتير شراء بعد" hint="سجّل مشترياتك ليُحدَّث المخزون ومتوسط التكلفة وضريبة المدخلات تلقائياً." /> : (
        <div className="overflow-x-auto"><table className="table w-full"><thead><tr><th>الرقم</th><th>المورد</th><th>الفرع</th><th>الإجمالي</th><th>المدفوع</th><th>الحالة</th><th>التاريخ</th></tr></thead>
          <tbody>{data.rows.map((r) => <tr key={r.id} className="cursor-pointer" onClick={() => setView(r.id)}><td className="num font-medium">{r.number}{r.isReturn && <Badge tone="red">مرتجع</Badge>}</td><td>{r.supplier ?? '—'}</td><td>{r.branch}</td><td className="num">{money(r.total)}</td><td className="num">{money(r.paid)}</td><td><Badge tone={r.status === 'APPROVED' ? 'green' : r.status === 'DRAFT' ? 'gray' : 'red'}>{r.status === 'APPROVED' ? 'معتمدة' : r.status === 'DRAFT' ? 'مسودة' : 'ملغاة'}</Badge></td><td className="text-sm">{date(r.date)}</td></tr>)}</tbody></table></div>
      )}</Card>
      <NewPurchase mode={creating} onClose={() => setCreating(null)} />
      <Drawer open={!!view} onClose={() => setView(null)} title={`فاتورة الشراء ${d?.number ?? ''}`} footer={d && <>{d.status === 'DRAFT' && <Button loading={approve.isPending} onClick={() => approve.mutate()}>اعتماد</Button>}{d.status === 'APPROVED' && d.total > d.paid && <Button variant="secondary" loading={pay.isPending} onClick={() => pay.mutate(d.total - d.paid)}>سداد المتبقي نقداً (<span className="num">{money(d.total - d.paid)}</span>)</Button>}</>}>
        {!d ? <Spinner /> : <div className="space-y-4">
          <table className="table w-full"><thead><tr><th>الصنف</th><th>الكمية</th><th>التكلفة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>{d.items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="num">{qty(i.qty)}</td><td className="num">{money(i.unitCost)}</td><td className="num">{money(i.taxAmount)}</td><td className="num">{money(i.total)}</td></tr>)}</tbody></table>
          <dl className="max-w-xs ms-auto space-y-1"><div className="flex justify-between"><dt>قبل الضريبة</dt><dd className="num">{money(d.subtotal)}</dd></div><div className="flex justify-between"><dt>الضريبة</dt><dd className="num">{money(d.taxTotal)}</dd></div><div className="flex justify-between font-bold"><dt>الإجمالي</dt><dd className="num">{money(d.total)}</dd></div></dl>
        </div>}
      </Drawer>
    </>
  );
}

function NewPurchase({ mode, onClose }: { mode: null | 'purchase' | 'return'; onClose: () => void }) {
  const { me, branchId } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [h, setH] = useState({ supplierId: '', branchId: String(branchId), supplierInvoiceNo: '', date: '', paymentMethod: 'CASH', notes: '', pricesIncludeTax: false });
  const [items, setItems] = useState<Array<{ productId: number; name: string; qty: number; unitCost: number; expiryDate?: string }>>([]);
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const { data: sups } = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Array<{ id: number; name: string }>>('/suppliers'), enabled: !!mode });
  const { data: found } = useQuery({ queryKey: ['products', 'pur', dq], queryFn: () => api<{ rows: Array<{ id: number; name: string; cost: number }> }>('/products', { query: { search: dq, limit: 8 } }), enabled: dq.length > 1 });
  const save = useMutation({ mutationFn: (approve: boolean) => api('/purchases', { body: { ...h, supplierId: h.supplierId ? Number(h.supplierId) : null, branchId: Number(h.branchId), date: h.date || null, isReturn: mode === 'return', approve, items: items.map(({ productId, qty, unitCost, expiryDate }) => ({ productId, qty, unitCost, expiryDate: expiryDate || null })) } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); setItems([]); toast.success('تم الحفظ.'); onClose(); }, onError: toast.error });
  const sub = items.reduce((s, i) => s + i.qty * i.unitCost, 0);
  return (
    <Modal open={!!mode} onClose={onClose} title={mode === 'return' ? 'مرتجع مشتريات' : 'فاتورة شراء جديدة'} size="xl" footer={<><Button variant="secondary" loading={save.isPending} onClick={() => save.mutate(false)}>حفظ كمسودة</Button><Button loading={save.isPending} onClick={() => save.mutate(true)}>حفظ واعتماد</Button></>}>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Select label="المورد" value={h.supplierId} onChange={(e) => setH({ ...h, supplierId: e.target.value })}><option value="">بلا مورد</option>{sups?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select label="الفرع / المستودع" value={h.branchId} onChange={(e) => setH({ ...h, branchId: e.target.value })}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        <Input label="رقم فاتورة المورد" dir="ltr" value={h.supplierInvoiceNo} onChange={(e) => setH({ ...h, supplierInvoiceNo: e.target.value })} />
        <Input label="التاريخ" type="date" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} />
        <Select label="طريقة الدفع" value={h.paymentMethod} onChange={(e) => setH({ ...h, paymentMethod: e.target.value })}><option value="CASH">نقدي</option><option value="CARD">شبكة</option><option value="BANK_TRANSFER">تحويل بنكي</option><option value="CREDIT">آجل</option></Select>
        <div className="flex items-end pb-2"><Checkbox checked={h.pricesIncludeTax} onChange={(v) => setH({ ...h, pricesIncludeTax: v })} label="التكاليف شاملة الضريبة" /></div>
      </div>
      <div className="relative mb-3">
        <input className="input" placeholder="ابحث بالاسم أو الباركود لإضافة صنف" value={q} onChange={(e) => setQ(e.target.value)} aria-label="إضافة صنف" />
        {found && dq.length > 1 && <ul className="absolute z-10 inset-x-0 mt-1 card p-1 max-h-56 overflow-auto">{found.rows.map((r) => <li key={r.id}><button className="w-full text-start px-3 py-2 rounded hover:bg-ink-50" onClick={() => { setItems([...items, { productId: r.id, name: r.name, qty: 1, unitCost: r.cost }]); setQ(''); }}>{r.name}</button></li>)}</ul>}
      </div>
      {!items.length ? <Empty title="أضف الأصناف المشتراة" /> : (
        <table className="table w-full"><thead><tr><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الصلاحية</th><th>الإجمالي</th><th /></tr></thead>
          <tbody>{items.map((i, idx) => <tr key={idx}><td>{i.name}</td>
            <td className="w-28"><NumberInput aria-label="الكمية" value={i.qty} onChange={(v) => setItems(items.map((x, j) => j === idx ? { ...x, qty: v ?? 0 } : x))} /></td>
            <td className="w-32"><NumberInput aria-label="التكلفة" value={i.unitCost} onChange={(v) => setItems(items.map((x, j) => j === idx ? { ...x, unitCost: v ?? 0 } : x))} /></td>
            <td className="w-40"><Input type="date" aria-label="الصلاحية" value={i.expiryDate ?? ''} onChange={(e) => setItems(items.map((x, j) => j === idx ? { ...x, expiryDate: e.target.value } : x))} /></td>
            <td className="num">{money(i.qty * i.unitCost)}</td><td><Button variant="ghost" aria-label="حذف" onClick={() => setItems(items.filter((_, j) => j !== idx))}><Trash2 className="size-4" /></Button></td></tr>)}</tbody></table>
      )}
      <p className="text-end mt-3">المجموع: <b className="num">{money(sub)}</b> {h.pricesIncludeTax ? '(شامل الضريبة)' : '+ الضريبة'}</p>
      <Textarea label="ملاحظات" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
    </Modal>
  );
}
