// تفاصيل الفاتورة: البنود، المدفوعات، الطباعة، الإرجاع، التحصيل، حالة الفوترة الإلكترونية
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, RotateCcw, Wallet, FileCode2, Send, MessageCircle } from 'lucide-react';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, qty, dateTime, INVOICE_STATUS, ZATCA_STATUS, PAYMENT_LABELS, CHANNEL_LABELS } from '../../lib/format';
import { Badge, Button, Drawer, Modal, NumberInput, Select, Spinner, Segmented, Input, useToast } from '../../components/ui';
import { usePrinter } from '../../features/print/usePrinter';
import { docTitle, type PrintableInvoice } from '../../features/print/receipt';

type Detail = Omit<PrintableInvoice, 'items'> & {
  channel: string; zatcaStatus: string; zatcaResponse: unknown; icv: number | null; invoiceHash: string | null; uuid: string; couponCode: string | null; privateNote: string | null;
  items: Array<PrintableInvoice['items'][number] & { id: number; returnedQty: number }>; returns: Array<{ id: number; number: string; total: number; createdAt: string }>;
};

export function InvoiceDrawer({ id, onClose, onOpen }: { id: number | null; onClose: () => void; onOpen?: (id: number) => void }) {
  const { can } = useAuth(); const toast = useToast(); const qc = useQueryClient(); const printer = usePrinter();
  const { data: inv, isLoading } = useQuery({ queryKey: ['invoice', id], queryFn: () => api<Detail>(`/invoices/${id}`), enabled: !!id });
  const [modal, setModal] = useState<null | 'return' | 'collect' | 'print'>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['invoice'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); };
  const retry = useMutation({ mutationFn: () => api(`/invoices/${id}/zatca-retry`, { body: {} }), onSuccess: () => { refresh(); toast.success('أُرسلت الفاتورة للهيئة.'); }, onError: toast.error });
  const st = inv ? INVOICE_STATUS[inv.status] : null; const z = inv ? ZATCA_STATUS[inv.zatcaStatus] : null;
  const share = () => {
    if (!inv) return;
    const text = `${docTitle(inv)} ${inv.number}\nالإجمالي: ${money(inv.total)} ر.س\nالتاريخ: ${dateTime(inv.createdAt)}`;
    const phone = inv.customer?.phone?.replace(/^0/, '966').replace(/\D/g, '') ?? '';
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  return (
    <Drawer open={!!id} onClose={onClose} title={inv ? `${docTitle(inv)} · ${inv.number}` : 'تفاصيل الفاتورة'}
      footer={inv && <>
        <Button onClick={() => setModal('print')}><Printer className="size-4" />طباعة</Button>
        {inv.type === 'INVOICE' && inv.status !== 'DRAFT' && inv.status !== 'RETURNED' && can('invoices.return') && <Button variant="secondary" onClick={() => setModal('return')}><RotateCcw className="size-4" />إرجاع</Button>}
        {inv.due > 0 && can('invoices.collect') && <Button variant="secondary" onClick={() => setModal('collect')}><Wallet className="size-4" />تحصيل المستحق</Button>}
        {inv.status !== 'CANCELLED' && <Button variant="ghost" onClick={share}><MessageCircle className="size-4" />واتساب</Button>}
        <Button variant="ghost" onClick={() => download(`/invoices/${inv.id}/xml`, `${inv.number}.xml`).catch(toast.error)}><FileCode2 className="size-4" />XML</Button>
      </>}>
      {isLoading || !inv ? <Spinner /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {st && <Badge tone={st.tone}>{st.label}</Badge>}
            <Badge tone="blue">{CHANNEL_LABELS[inv.channel]}</Badge>
            {z && <Badge tone={z.tone}>{z.label}</Badge>}
            {inv.couponCode && <Badge tone="brand">كوبون {inv.couponCode}</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[14px]">
            <div><dt className="text-ink-500">التاريخ</dt><dd>{dateTime(inv.createdAt)}</dd></div>
            <div><dt className="text-ink-500">العميل</dt><dd>{inv.customer?.name ?? 'عميل نقدي'}{inv.customer?.vatNumber && <span className="block num text-ink-500">{inv.customer.vatNumber}</span>}</dd></div>
            <div><dt className="text-ink-500">الفرع</dt><dd>{inv.branch?.name}</dd></div>
            <div><dt className="text-ink-500">الموظف</dt><dd>{inv.user?.name}</dd></div>
            {inv.original && <div><dt className="text-ink-500">الفاتورة الأصلية</dt><dd><button className="text-brand-700 underline num" onClick={() => onOpen?.((inv as unknown as { originalId: number }).originalId)}>{inv.original.number}</button></dd></div>}
            {inv.icv != null && <div><dt className="text-ink-500">العداد (ICV)</dt><dd className="num">{inv.icv}</dd></div>}
          </dl>
          <div className="overflow-x-auto border border-ink-200 rounded-xl">
            <table className="table w-full">
              <thead><tr><th>البند</th><th>الكمية</th><th>السعر</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>{inv.items.map((it) => (
                <tr key={it.id}><td>{it.name}{it.returnedQty > 0 && <span className="block text-xs text-red-600">مرتجع: <span className="num">{qty(it.returnedQty)}</span></span>}</td>
                  <td className="num">{qty(it.qty)}</td><td className="num">{money(it.unitPrice)}</td><td className="num">{money(it.taxAmount)}</td><td className="num font-medium">{money(it.total)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <dl className="ms-auto max-w-xs space-y-1.5 text-[15px]">
            <div className="flex justify-between"><dt className="text-ink-600">الإجمالي قبل الضريبة</dt><dd className="num">{money(inv.subtotal)}</dd></div>
            {inv.discount > 0 && <div className="flex justify-between"><dt className="text-ink-600">الخصم</dt><dd className="num">{money(inv.discount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-600">الضريبة</dt><dd className="num">{money(inv.taxTotal)}</dd></div>
            <div className="flex justify-between text-lg font-extrabold border-t border-ink-200 pt-1.5"><dt>الإجمالي</dt><dd className="num">{money(inv.total)}</dd></div>
            {inv.due > 0 && <div className="flex justify-between text-amber-700 font-bold"><dt>المتبقي</dt><dd className="num">{money(inv.due)}</dd></div>}
          </dl>
          <section>
            <h3 className="font-bold mb-2">المدفوعات</h3>
            {inv.payments.length ? <ul className="divide-y divide-ink-100 text-[14px]">{inv.payments.filter((p) => p.amount !== 0).map((p, i) => (
              <li key={i} className="flex justify-between py-1.5"><span>{PAYMENT_LABELS[p.method]}{p.amount < 0 && ' (استرداد)'}</span><span className="num">{money(p.amount)}</span></li>
            ))}</ul> : <p className="text-ink-500 text-sm">لا مدفوعات.</p>}
          </section>
          {inv.returns.length > 0 && (
            <section><h3 className="font-bold mb-2">المرتجعات</h3>
              <ul className="text-[14px]">{inv.returns.map((r) => <li key={r.id}><button className="text-brand-700 underline num" onClick={() => onOpen?.(r.id)}>{r.number}</button> — <span className="num">{money(r.total)}</span> · {dateTime(r.createdAt)}</li>)}</ul></section>
          )}
          {(inv.zatcaStatus === 'PENDING' || inv.zatcaStatus === 'REJECTED') && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-2">
              <span>الفاتورة لم تُبلَّغ للهيئة بعد. المهلة النظامية للفواتير المبسّطة 24 ساعة.</span>
              <Button size="sm" loading={retry.isPending} onClick={() => retry.mutate()}><Send className="size-4" />إعادة الإرسال</Button>
            </div>
          )}
        </div>
      )}
      {inv && <ReturnModal open={modal === 'return'} inv={inv} onClose={() => setModal(null)} onDone={(cn) => { setModal(null); refresh(); toast.success('تم إصدار إشعار الدائن.'); printer.print(cn as never).catch(() => undefined); }} />}
      {inv && <CollectModal open={modal === 'collect'} inv={inv} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); toast.success('تم التحصيل.'); }} />}
      {inv && <PrintModal open={modal === 'print'} inv={inv} onClose={() => setModal(null)} />}
    </Drawer>
  );
}

function PrintModal({ open, inv, onClose }: { open: boolean; inv: Detail; onClose: () => void }) {
  const printer = usePrinter(); const toast = useToast();
  const [template, setTemplate] = useState<'RECEIPT' | 'A4' | 'COMPACT'>('RECEIPT');
  return (
    <Modal open={open} onClose={onClose} title="طباعة الفاتورة" size="sm" footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button onClick={() => printer.print(inv, { template, drawer: false }).then(onClose).catch(toast.error)}><Printer className="size-4" />طباعة</Button></>}>
      <p className="text-sm text-ink-500 mb-3">اختر قالب الورقة. يسري اختيارك على الطباعة وملف PDF (احفظ كـ PDF من نافذة الطباعة).</p>
      <Segmented value={template} onChange={setTemplate} items={[{ value: 'RECEIPT', label: 'إيصال كاشير' }, { value: 'A4', label: 'فاتورة مبيعات' }, { value: 'COMPACT', label: 'فاتورة مختصرة' }]} />
      <p className="text-[13px] text-ink-500 mt-3">لا يفتح درج النقود عند الطباعة من صفحة الفواتير.</p>
    </Modal>
  );
}

function ReturnModal({ open, inv, onClose, onDone }: { open: boolean; inv: Detail; onClose: () => void; onDone: (cn: unknown) => void }) {
  const toast = useToast();
  const [q, setQ] = useState<Record<number, number | null>>({});
  const [method, setMethod] = useState('CASH'); const [reason, setReason] = useState(''); const [restock, setRestock] = useState(true);
  useEffect(() => { if (open) { setQ({}); setReason(''); setMethod(inv.due > 0 ? 'CREDIT' : 'CASH'); } }, [open, inv.due]);
  const m = useMutation({ mutationFn: () => api(`/invoices/${inv.id}/return`, { body: { items: Object.entries(q).filter(([, v]) => v).map(([k, v]) => ({ itemId: Number(k), qty: v })), refundMethod: method, reason: reason || undefined, restock } }), onSuccess: onDone, onError: toast.error });
  const total = inv.items.reduce((s, it) => s + ((q[it.id] ?? 0) / it.qty) * it.total, 0);
  return (
    <Modal open={open} onClose={onClose} title="إرجاع أصناف" size="lg" footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button loading={m.isPending} disabled={total <= 0} onClick={() => m.mutate()}>تأكيد الإرجاع — <span className="num">{money(total)}</span></Button></>}>
      <table className="table w-full mb-4">
        <thead><tr><th>البند</th><th>المباع</th><th>المتبقي</th><th>كمية الإرجاع</th></tr></thead>
        <tbody>{inv.items.map((it) => { const left = it.qty - it.returnedQty; return (
          <tr key={it.id}><td>{it.name}</td><td className="num">{qty(it.qty)}</td><td className="num">{qty(left)}</td>
            <td className="w-40"><div className="flex gap-1"><NumberInput aria-label={`كمية إرجاع ${it.name}`} value={q[it.id] ?? null} onChange={(v) => setQ((s) => ({ ...s, [it.id]: v == null ? null : Math.min(v, left) }))} disabled={left <= 0} /><Button size="sm" variant="ghost" disabled={left <= 0} onClick={() => setQ((s) => ({ ...s, [it.id]: left }))}>الكل</Button></div></td></tr>
        ); })}</tbody>
      </table>
      <div className="grid sm:grid-cols-2 gap-3">
        <Select label="طريقة الاسترداد" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="CASH">نقدي</option><option value="CARD">شبكة</option><option value="BANK_TRANSFER">تحويل بنكي</option>{inv.customer && <option value="CREDIT">خصم من مستحقات العميل</option>}
        </Select>
        <Input label="سبب الإرجاع" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: منتج تالف" />
      </div>
      <label className="flex items-center gap-2 mt-3 text-[15px]"><input type="checkbox" className="accent-brand-700 size-4" checked={restock} onChange={(e) => setRestock(e.target.checked)} />إعادة الأصناف إلى المخزون</label>
    </Modal>
  );
}

function CollectModal({ open, inv, onClose, onDone }: { open: boolean; inv: Detail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(inv.due); const [method, setMethod] = useState('CASH'); const [note, setNote] = useState('');
  useEffect(() => { if (open) setAmount(inv.due); }, [open, inv.due]);
  const m = useMutation({ mutationFn: () => api(`/invoices/${inv.id}/collect`, { body: { amount, method, note: note || undefined } }), onSuccess: onDone, onError: toast.error });
  return (
    <Modal open={open} onClose={onClose} title="تحصيل المستحقات" size="sm" footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button loading={m.isPending} onClick={() => m.mutate()}>تأكيد التحصيل</Button></>}>
      <div className="space-y-3">
        <p className="text-ink-600">المطلوب: <b className="num">{money(inv.due)}</b> ر.س</p>
        <NumberInput label="المبلغ المُحصَّل" value={amount} onChange={setAmount} hint={`المتبقي بعد التحصيل: ${money(Math.max(0, inv.due - (amount ?? 0)))}`} />
        <Select label="طريقة الدفع" value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">نقدي</option><option value="CARD">شبكة</option><option value="BANK_TRANSFER">تحويل بنكي</option></Select>
        <Input label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
