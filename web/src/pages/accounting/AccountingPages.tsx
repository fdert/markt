// صفحات المحاسبة: نظرة عامة، دليل الحسابات والقيود، القوائم المالية، الضريبة والإقفال، الصناديق
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, CheckCircle2, AlertTriangle, Lock, Unlock, Printer } from 'lucide-react';
import { api } from '../../lib/api';
import { money, dateTime, date, isoDate } from '../../lib/format';
import { Badge, Button, Card, Empty, Input, Modal, NumberInput, PageHeader, Select, Spinner, Stat, Tabs, clsx, useToast } from '../../components/ui';

const TYPE_LABEL: Record<string, string> = { ASSET: 'أصول', LIABILITY: 'خصوم', EQUITY: 'حقوق ملكية', REVENUE: 'إيرادات', EXPENSE: 'مصروفات' };
const monthStart = () => isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

function RangeBar({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return <div className="flex flex-wrap gap-2 items-end mb-4"><Input label="من" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><Input label="إلى" type="date" value={to} onChange={(e) => setTo(e.target.value)} /><Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" />طباعة</Button></div>;
}

export function AccountingOverview() {
  const { data: h } = useQuery({ queryKey: ['acc-health'], queryFn: () => api<{ products_without_cost: number; uncounted_stocks: number; zatca_pending: number; ledger_diff: number; shifts_with_diff: number }>('/accounting/health') });
  const { data: is } = useQuery({ queryKey: ['income', 'month'], queryFn: () => api<{ totalRevenue: number; grossProfit: number; netProfit: number; totalExpenses: number }>('/accounting/income-statement', { query: { from: monthStart() } }) });
  const checks = h ? [
    { ok: Math.abs(h.ledger_diff) < 0.01, text: 'دفتر الأستاذ متوازن (المدين = الدائن)' },
    { ok: !h.products_without_cost, text: h.products_without_cost ? `${h.products_without_cost} منتجاً بلا تكلفة — جاهزية تكلفة البضاعة (COGS) ناقصة` : 'كل المنتجات لها تكلفة', to: '/products' },
    { ok: !h.uncounted_stocks, text: h.uncounted_stocks ? `${h.uncounted_stocks} رصيد مخزون غير مجرود` : 'كل الأرصدة مجرودة', to: '/products' },
    { ok: !h.zatca_pending, text: h.zatca_pending ? `${h.zatca_pending} فاتورة بانتظار الإبلاغ للهيئة` : 'لا فواتير بانتظار الإبلاغ', to: '/invoices' },
    { ok: !h.shifts_with_diff, text: h.shifts_with_diff ? `${h.shifts_with_diff} صندوق بفروقات تحتاج مراجعة` : 'لا فروقات صناديق', to: '/accounting/shifts' },
  ] : [];
  return (
    <>
      <PageHeader title="المحاسبة — نظرة عامة" subtitle="قيود آلية لكل بيع وشراء ومصروف ومرتجع وفق القيد المزدوج." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Stat label="إيرادات الشهر" value={money(is?.totalRevenue)} /><Stat label="مجمل الربح" value={money(is?.grossProfit)} /><Stat label="المصروفات" value={money(is?.totalExpenses)} /><Stat label="صافي الربح" value={money(is?.netProfit)} tone={(is?.netProfit ?? 0) >= 0 ? 'up' : 'down'} sub="هذا الشهر" /></div>
      <Card title="صحّة الحسابات">{!h ? <Spinner /> : <ul className="divide-y divide-ink-100">{checks.map((c) => (
        <li key={c.text} className="flex items-center gap-3 py-2.5">{c.ok ? <CheckCircle2 className="size-5 text-emerald-600" /> : <AlertTriangle className="size-5 text-amber-600" />}<span className="flex-1">{c.text}</span>{!c.ok && c.to && <Link to={c.to} className="text-sm text-brand-700">معالجة ←</Link>}</li>
      ))}</ul>}</Card>
    </>
  );
}

export function AccountsPage() {
  const qc = useQueryClient(); const toast = useToast();
  const [tab, setTab] = useState<'accounts' | 'entries'>('accounts'); const [acc, setAcc] = useState<{ code: string; name: string; type: string } | null>(null);
  const [entry, setEntry] = useState<{ description: string; date: string; lines: Array<{ accountId: string; debit: number | null; credit: number | null }> } | null>(null);
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api<Array<{ id: number; code: string; name: string; type: string; is_group: boolean; parent_id: number | null; debit: number; credit: number; balance: number }>>('/accounting/accounts') });
  const { data: entries } = useQuery({ queryKey: ['entries'], queryFn: () => api<Array<{ id: number; number: string; date: string; description: string; user_name: string | null; ref_type: string | null; lines: Array<{ account: string; debit: number; credit: number }> }>>('/accounting/entries', { query: { limit: 100 } }), enabled: tab === 'entries' });
  const saveAcc = useMutation({ mutationFn: () => api('/accounting/accounts', { body: acc }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); setAcc(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const saveEntry = useMutation({ mutationFn: () => api('/accounting/entries', { body: { description: entry!.description, date: entry!.date || undefined, lines: entry!.lines.filter((l) => l.accountId).map((l) => ({ accountId: Number(l.accountId), debit: l.debit ?? 0, credit: l.credit ?? 0 })) } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['entries'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); setEntry(null); toast.success('تم ترحيل القيد.'); }, onError: toast.error });
  const leaf = accounts?.filter((a) => !a.is_group) ?? [];
  const dr = entry?.lines.reduce((s, l) => s + (l.debit ?? 0), 0) ?? 0; const cr = entry?.lines.reduce((s, l) => s + (l.credit ?? 0), 0) ?? 0;
  return (
    <>
      <PageHeader title="الحسابات والقيود" actions={<><Button variant="secondary" onClick={() => setAcc({ code: '', name: '', type: 'EXPENSE' })}>حساب جديد</Button><Button onClick={() => setEntry({ description: '', date: '', lines: [{ accountId: '', debit: null, credit: null }, { accountId: '', debit: null, credit: null }] })}><Plus className="size-4" />قيد يدوي</Button></>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'accounts', label: 'دليل الحسابات' }, { value: 'entries', label: 'قيود اليومية' }]} />
      {tab === 'accounts' ? (
        <Card bodyClass="!p-0">{!accounts ? <Spinner /> : (
          <table className="table w-full"><thead><tr><th>الرقم</th><th>الحساب</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
            <tbody>{accounts.map((a) => <tr key={a.id} className={a.is_group ? 'bg-ink-50 font-bold' : ''}><td className="num">{a.code}</td><td className={a.parent_id ? 'ps-8' : ''}>{a.name}</td><td>{TYPE_LABEL[a.type]}</td><td className="num">{a.is_group ? '' : money(a.debit)}</td><td className="num">{a.is_group ? '' : money(a.credit)}</td><td className="num">{a.is_group ? '' : money(a.balance)}</td></tr>)}</tbody></table>
        )}</Card>
      ) : (
        <div className="space-y-3">{!entries ? <Spinner /> : !entries.length ? <Empty /> : entries.map((e) => (
          <Card key={e.id} bodyClass="!pt-3">
            <div className="flex flex-wrap justify-between gap-2 mb-2"><div><span className="num font-bold">{e.number}</span> — {e.description}</div><span className="text-sm text-ink-500">{dateTime(e.date)} · {e.user_name ?? 'النظام'}</span></div>
            <table className="w-full text-[14px]"><tbody>{e.lines.map((l, i) => <tr key={i} className="border-t border-ink-100"><td className={clsx('py-1', l.credit > 0 && 'ps-8')}>{l.account}</td><td className="num w-28">{l.debit ? money(l.debit) : ''}</td><td className="num w-28">{l.credit ? money(l.credit) : ''}</td></tr>)}</tbody></table>
          </Card>
        ))}</div>
      )}
      <Modal open={!!acc} onClose={() => setAcc(null)} title="حساب جديد" size="sm" footer={<Button loading={saveAcc.isPending} onClick={() => saveAcc.mutate()}>حفظ</Button>}>
        {acc && <div className="space-y-3"><Input label="رقم الحساب" dir="ltr" value={acc.code} onChange={(e) => setAcc({ ...acc, code: e.target.value })} /><Input label="اسم الحساب" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} /><Select label="النوع" value={acc.type} onChange={(e) => setAcc({ ...acc, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>}
      </Modal>
      <Modal open={!!entry} onClose={() => setEntry(null)} title="قيد يدوي" size="lg" footer={<Button disabled={dr !== cr || dr === 0} loading={saveEntry.isPending} onClick={() => saveEntry.mutate()}>ترحيل القيد</Button>}>
        {entry && <div className="space-y-3">
          <div className="grid sm:grid-cols-[2fr_1fr] gap-3"><Input label="البيان" value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} /><Input label="التاريخ" type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></div>
          {entry.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
              <Select aria-label="الحساب" value={l.accountId} onChange={(e) => setEntry({ ...entry, lines: entry.lines.map((x, j) => j === i ? { ...x, accountId: e.target.value } : x) })}><option value="">اختر الحساب</option>{leaf.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}</Select>
              <NumberInput aria-label="مدين" placeholder="مدين" value={l.debit} onChange={(v) => setEntry({ ...entry, lines: entry.lines.map((x, j) => j === i ? { ...x, debit: v } : x) })} />
              <NumberInput aria-label="دائن" placeholder="دائن" value={l.credit} onChange={(v) => setEntry({ ...entry, lines: entry.lines.map((x, j) => j === i ? { ...x, credit: v } : x) })} />
              <Button variant="ghost" aria-label="حذف السطر" onClick={() => setEntry({ ...entry, lines: entry.lines.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setEntry({ ...entry, lines: [...entry.lines, { accountId: '', debit: null, credit: null }] })}>إضافة سطر</Button>
          <p className={clsx('font-bold', dr === cr ? 'text-emerald-700' : 'text-red-600')}>مدين <span className="num">{money(dr)}</span> — دائن <span className="num">{money(cr)}</span></p>
        </div>}
      </Modal>
    </>
  );
}

export function StatementsPage() {
  const [tab, setTab] = useState<'income' | 'balance' | 'trial'>('income');
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(isoDate());
  const { data: inc } = useQuery({ queryKey: ['income', from, to], queryFn: () => api<{ revenue: Array<{ code: string; name: string; amount: number }>; expenses: Array<{ code: string; name: string; amount: number }>; totalRevenue: number; cogs: number; grossProfit: number; totalExpenses: number; netProfit: number }>('/accounting/income-statement', { query: { from, to } }), enabled: tab === 'income' });
  const { data: bs } = useQuery({ queryKey: ['balance', to], queryFn: () => api<{ assets: Array<{ code: string; name: string; amount: number }>; liabilities: Array<{ code: string; name: string; amount: number }>; equity: Array<{ code: string; name: string; amount: number }>; currentProfit: number; totalAssets: number; totalLiabilities: number; totalEquity: number }>('/accounting/balance-sheet', { query: { to } }), enabled: tab === 'balance' });
  const { data: tb } = useQuery({ queryKey: ['trial', from, to], queryFn: () => api<Array<{ code: string; name: string; debit: number; credit: number; closing_debit: number; closing_credit: number }>>('/accounting/trial-balance', { query: { from, to } }), enabled: tab === 'trial' });
  const Section = ({ title, rows, total }: { title: string; rows: Array<{ code: string; name: string; amount: number }>; total: number }) => (
    <><tr className="bg-ink-50"><td colSpan={2} className="font-bold">{title}</td></tr>{rows.map((r) => <tr key={r.code}><td className="ps-8">{r.code} — {r.name}</td><td className="num">{money(r.amount)}</td></tr>)}<tr><td className="font-bold">إجمالي {title}</td><td className="num font-bold">{money(total)}</td></tr></>
  );
  return (
    <>
      <PageHeader title="القوائم المالية" />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'income', label: 'قائمة الدخل' }, { value: 'balance', label: 'الميزانية العمومية' }, { value: 'trial', label: 'ميزان المراجعة' }]} />
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <Card bodyClass="!p-0">
        {tab === 'income' && (!inc ? <Spinner /> : <table className="table w-full"><tbody>
          <Section title="الإيرادات" rows={inc.revenue} total={inc.totalRevenue} />
          <tr><td>تكلفة البضاعة المباعة</td><td className="num">({money(inc.cogs)})</td></tr>
          <tr className="bg-brand-50"><td className="font-bold">مجمل الربح</td><td className="num font-bold">{money(inc.grossProfit)}</td></tr>
          <Section title="المصروفات" rows={inc.expenses.filter((e) => e.code !== '5100')} total={inc.totalExpenses - inc.cogs} />
          <tr className="bg-brand-100"><td className="font-extrabold text-lg">صافي الربح</td><td className="num font-extrabold text-lg">{money(inc.netProfit)}</td></tr>
        </tbody></table>)}
        {tab === 'balance' && (!bs ? <Spinner /> : <table className="table w-full"><tbody>
          <Section title="الأصول" rows={bs.assets} total={bs.totalAssets} />
          <Section title="الخصوم" rows={bs.liabilities} total={bs.totalLiabilities} />
          <Section title="حقوق الملكية" rows={[...bs.equity, { code: '—', name: 'أرباح الفترة الجارية', amount: bs.currentProfit }]} total={bs.totalEquity} />
          <tr className={clsx(Math.abs(bs.totalAssets - bs.totalLiabilities - bs.totalEquity) < 0.01 ? 'bg-emerald-50' : 'bg-red-50')}><td className="font-bold">الخصوم + حقوق الملكية</td><td className="num font-bold">{money(bs.totalLiabilities + bs.totalEquity)}</td></tr>
        </tbody></table>)}
        {tab === 'trial' && (!tb ? <Spinner /> : <table className="table w-full"><thead><tr><th>الحساب</th><th>حركة مدينة</th><th>حركة دائنة</th><th>رصيد مدين</th><th>رصيد دائن</th></tr></thead>
          <tbody>{tb.map((r) => <tr key={r.code}><td>{r.code} — {r.name}</td><td className="num">{money(r.debit)}</td><td className="num">{money(r.credit)}</td><td className="num">{money(r.closing_debit)}</td><td className="num">{money(r.closing_credit)}</td></tr>)}
            <tr className="bg-ink-50 font-bold"><td>الإجمالي</td><td className="num">{money(tb.reduce((s, r) => s + r.debit, 0))}</td><td className="num">{money(tb.reduce((s, r) => s + r.credit, 0))}</td><td className="num">{money(tb.reduce((s, r) => s + r.closing_debit, 0))}</td><td className="num">{money(tb.reduce((s, r) => s + r.closing_credit, 0))}</td></tr></tbody></table>)}
      </Card>
    </>
  );
}

export function VatPage() {
  const qc = useQueryClient(); const toast = useToast();
  const q = new Date(); const qs = new Date(q.getFullYear(), Math.floor(q.getMonth() / 3) * 3, 1);
  const [from, setFrom] = useState(isoDate(qs)); const [to, setTo] = useState(isoDate());
  const [period, setPeriod] = useState<{ name: string; startDate: string; endDate: string } | null>(null);
  const { data: v } = useQuery({ queryKey: ['vat', from, to], queryFn: () => api<{ sales: { standard: number; standardVat: number; zeroRated: number; returns: number; returnsVat: number }; purchases: { standard: number; vat: number; purchases: number; expenses: number }; outputVat: number; inputVat: number; netVat: number }>('/accounting/vat-return', { query: { from, to } }) });
  const { data: periods } = useQuery({ queryKey: ['periods'], queryFn: () => api<Array<{ id: number; name: string; startDate: string; endDate: string; closed: boolean }>>('/accounting/periods') });
  const create = useMutation({ mutationFn: () => api('/accounting/periods', { body: period }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['periods'] }); setPeriod(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const toggle = useMutation({ mutationFn: (p: { id: number; closed: boolean }) => api(`/accounting/periods/${p.id}/${p.closed ? 'open' : 'close'}`, { body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['periods'] }); toast.success('تم التحديث.'); }, onError: toast.error });
  return (
    <>
      <PageHeader title="الإقفال والضريبة" subtitle="إقرار ضريبة القيمة المضافة وفق نموذج الهيئة، وإقفال الفترات المحاسبية." />
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {!v ? <Spinner /> : (
        <div className="grid lg:grid-cols-3 gap-5 mb-5">
          <Card title="ضريبة المخرجات (المبيعات)" className="lg:col-span-2">
            <table className="table w-full"><thead><tr><th>البند</th><th>المبلغ</th><th>التعديلات</th><th>الضريبة</th></tr></thead><tbody>
              <tr><td>1. المبيعات الخاضعة للنسبة الأساسية</td><td className="num">{money(v.sales.standard + v.sales.returns)}</td><td className="num">({money(v.sales.returns)})</td><td className="num">{money(v.outputVat)}</td></tr>
              <tr><td>4. المبيعات الخاضعة للنسبة الصفرية</td><td className="num">{money(v.sales.zeroRated)}</td><td>—</td><td className="num">0.00</td></tr>
              <tr><td colSpan={4} className="bg-ink-50 font-bold">ضريبة المدخلات (المشتريات)</td></tr>
              <tr><td>7. المشتريات الخاضعة للنسبة الأساسية</td><td className="num">{money(v.purchases.standard)}</td><td>—</td><td className="num">{money(v.inputVat)}</td></tr>
            </tbody></table>
          </Card>
          <div className="space-y-3"><Stat label="ضريبة المخرجات" value={money(v.outputVat)} /><Stat label="ضريبة المدخلات" value={money(v.inputVat)} /><Stat label="صافي الضريبة المستحقة" value={money(v.netVat)} sub={v.netVat >= 0 ? 'مستحقة الدفع للهيئة' : 'رصيد مسترد'} /></div>
        </div>
      )}
      <Card title="الفترات المحاسبية" actions={<Button size="sm" onClick={() => setPeriod({ name: '', startDate: from, endDate: to })}><Plus className="size-4" />فترة جديدة</Button>}>
        {!periods?.length ? <Empty title="لا فترات بعد" hint="أقفل الفترة بعد تقديم الإقرار حتى لا تُسجَّل فيها قيود جديدة." /> : (
          <table className="table w-full"><thead><tr><th>الفترة</th><th>من</th><th>إلى</th><th>الحالة</th><th /></tr></thead>
            <tbody>{periods.map((p) => <tr key={p.id}><td>{p.name}</td><td>{date(p.startDate)}</td><td>{date(p.endDate)}</td><td>{p.closed ? <Badge tone="red">مقفلة</Badge> : <Badge tone="green">مفتوحة</Badge>}</td><td><Button size="sm" variant="secondary" onClick={() => toggle.mutate(p)}>{p.closed ? <><Unlock className="size-4" />فتح</> : <><Lock className="size-4" />إقفال</>}</Button></td></tr>)}</tbody></table>
        )}
      </Card>
      <Modal open={!!period} onClose={() => setPeriod(null)} title="فترة جديدة" size="sm" footer={<Button loading={create.isPending} onClick={() => create.mutate()}>حفظ</Button>}>
        {period && <div className="space-y-3"><Input label="اسم الفترة" placeholder="الربع الرابع 2026" value={period.name} onChange={(e) => setPeriod({ ...period, name: e.target.value })} /><Input label="من" type="date" value={period.startDate} onChange={(e) => setPeriod({ ...period, startDate: e.target.value })} /><Input label="إلى" type="date" value={period.endDate} onChange={(e) => setPeriod({ ...period, endDate: e.target.value })} /></div>}
      </Modal>
    </>
  );
}

interface ShiftRow { id: number; status: string; user_name: string; branch_name: string; opened_at: string; closed_at: string | null; sales_total: number; expected_cash: number; counted_cash: string | null; difference: string | null; invoices_count: number }
export function ShiftsPage() {
  const qc = useQueryClient(); const toast = useToast(); const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['shifts', status], queryFn: () => api<ShiftRow[]>('/pos/shifts', { query: { status } }) });
  const act = useMutation({ mutationFn: (p: { id: number; a: string }) => api(`/pos/shift/${p.id}/${p.a}`, { body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); toast.success('تم التحديث.'); }, onError: toast.error });
  const open = data?.filter((s) => s.status === 'OPEN') ?? [];
  const ST: Record<string, { l: string; t: 'green' | 'amber' | 'gray' }> = { OPEN: { l: 'مفتوحة', t: 'green' }, CLOSED: { l: 'بانتظار المراجعة', t: 'amber' }, REVIEWED: { l: 'تمت المراجعة', t: 'gray' } };
  return (
    <>
      <PageHeader title="الصندوق والتسويات" subtitle="النقد المتوقع هو رصيد الدرج؛ والفرق = المعدود − المتوقع." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Stat label="صناديق مفتوحة" value={open.length} /><Stat label="النقد الحي المتوقع" value={money(open.reduce((s, x) => s + x.expected_cash, 0))} /><Stat label="بانتظار المراجعة" value={data?.filter((s) => s.status === 'CLOSED').length ?? 0} /><Stat label="صناديق بفروقات" value={data?.filter((s) => Number(s.difference)).length ?? 0} /></div>
      <Card bodyClass="!p-0">
        <div className="px-4 pt-3"><Tabs value={status} onChange={setStatus} items={[{ value: '', label: 'كل الصناديق' }, { value: 'OPEN', label: 'مفتوحة' }, { value: 'CLOSED', label: 'بانتظار المراجعة' }, { value: 'REVIEWED', label: 'تمت المراجعة' }]} /></div>
        {isLoading ? <Spinner /> : !data?.length ? <Empty title="تظهر الصناديق هنا بعد فتح وردية من نقطة البيع." /> : (
          <div className="overflow-x-auto"><table className="table w-full"><thead><tr><th>الصندوق والكاشير</th><th>الافتتاح والإغلاق</th><th>المبيعات</th><th>النقد المتوقّع</th><th>المعدود</th><th>الفرق</th><th>الحالة</th><th /></tr></thead>
            <tbody>{data.map((s) => <tr key={s.id}><td>#{s.id} · {s.user_name}<span className="block text-xs text-ink-500">{s.branch_name}</span></td><td className="text-sm">{dateTime(s.opened_at)}<span className="block text-ink-500">{s.closed_at ? dateTime(s.closed_at) : '—'}</span></td>
              <td className="num">{money(s.sales_total)}<span className="block text-xs text-ink-500">{s.invoices_count} فاتورة</span></td><td className="num">{money(s.expected_cash)}</td><td className="num">{s.counted_cash != null ? money(s.counted_cash) : '—'}</td>
              <td className={clsx('num', Number(s.difference) < 0 ? 'text-red-600' : Number(s.difference) > 0 ? 'text-emerald-700' : '')}>{s.difference != null ? money(s.difference) : '—'}</td><td><Badge tone={ST[s.status].t}>{ST[s.status].l}</Badge></td>
              <td className="whitespace-nowrap">{s.status === 'CLOSED' && <><Button size="sm" variant="secondary" onClick={() => act.mutate({ id: s.id, a: 'review' })}>اعتماد المراجعة</Button> <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: s.id, a: 'reopen' })}>إعادة فتح</Button></>}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </>
  );
}
