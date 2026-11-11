// لوحة التحكم: أداء المتجر اللحظي
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ShoppingCart, FilePlus2, Wallet, UserPlus, AlertTriangle, Target } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, pct, shortDate, time, dateTime, PAYMENT_LABELS } from '../lib/format';
import { Badge, Card, Empty, Modal, NumberInput, Button, Segmented, Spinner, Stat, clsx, useToast } from '../components/ui';

interface Dash {
  current: { sales: number; net: number; invoices: number; avg: number; discounts: number; tax: number; returns: number; profit: number; cost: number; net_ex_tax: number };
  change: { sales: number; invoices: number }; expenses: number; newCustomers: number;
  trend: Array<{ bucket: string; sales: number; profit: number; orders: number; returns: number }>;
  byCategory: Array<{ name: string; total: number }>; top: Array<{ product_id: number; name: string; qty: number; total: number }>;
  payments: Array<{ method: string; total: number; count: number }>; branches: Array<{ id: number; name: string; total: number }>;
  latest: Array<{ id: number; number: string; total: number; type: string; created_at: string; customer: string | null }>;
  heat: Array<{ dow: number; hour: number; total: number; count: number }>; activity: Array<{ summary: string; created_at: string; user_name: string }>;
  low: Array<{ id: number; name: string; price: number; stock: number; sold: number }>; dormant: Array<{ id: number; name: string; price: number; stock: number; last_sold: string | null }>;
  coupons: Array<{ id: number; name: string; code: string; ends_at: string }>; returning: { customers: number; returning: number };
  health: { no_cost: number; uncounted: number; zatca_pending: number }; target: { value: number; achieved: number };
}

const DAYS = ['', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];

function BarList({ rows, format = money }: { rows: Array<{ label: string; value: number; sub?: string }>; format?: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <Empty />;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <div className="flex justify-between text-[14px] mb-1"><span className="truncate">{r.label}</span><span className="num text-ink-700">{format(r.value)}</span></div>
          <div className="h-2 rounded-full bg-ink-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          {r.sub && <div className="text-xs text-ink-500 mt-0.5">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { me, can } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const [range, setRange] = useState<'day' | 'week' | 'month'>('day');
  const [branch, setBranch] = useState<number | ''>('');
  const [targetOpen, setTargetOpen] = useState(false); const [target, setTarget] = useState<number | null>(null);
  const { data: d, isLoading } = useQuery({ queryKey: ['dashboard', range, branch], queryFn: () => api<Dash>('/reports/dashboard', { query: { range, branchId: branch } }), refetchInterval: 60_000 });
  const saveTarget = useMutation({ mutationFn: () => api('/settings/pos', { method: 'PUT', body: { salesTarget: target ?? 0 } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboard'] }); setTargetOpen(false); toast.success('تم الحفظ.'); }, onError: toast.error });
  const hour = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: false, timeZone: 'Asia/Riyadh' }).format(new Date()));
  const rangeLabel = { day: 'هذا اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر' }[range];
  const heatMax = Math.max(...(d?.heat.map((h) => h.total) ?? [1]), 1);
  const attention = d ? [d.health.no_cost && { text: 'منتجات بلا تكلفة: الربح الفعلي أقل من المعروض', n: d.health.no_cost, to: '/products' }, d.health.uncounted && { text: 'أرصدة مخزون غير مجرودة', n: d.health.uncounted, to: '/products' }, d.health.zatca_pending && { text: 'فواتير بانتظار الإبلاغ للهيئة', n: d.health.zatca_pending, to: '/invoices' }].filter(Boolean) as Array<{ text: string; n: number; to: string }> : [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold">{hour < 12 ? 'صباح الخير' : 'مساء الخير'}، {me?.user.name.split(' ')[0]}</h1>
          <p className="text-ink-500 mt-1">لمحة سريعة عن أداء متجرك خلال {rangeLabel}.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Segmented value={range} onChange={setRange} items={[{ value: 'day', label: 'اليوم' }, { value: 'week', label: 'هذا الأسبوع' }, { value: 'month', label: 'هذا الشهر' }]} />
          <select className="input !h-9 !w-auto" aria-label="الفرع" value={branch} onChange={(e) => setBranch(e.target.value ? Number(e.target.value) : '')}>
            <option value="">كل الفروع</option>{me?.branches.filter((b) => b.type === 'BRANCH').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <nav aria-label="روابط سريعة" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[{ to: '/pos', icon: <ShoppingCart />, label: 'نقطة البيع' }, { to: '/pos', icon: <FilePlus2 />, label: 'فاتورة جديدة' }, { to: '/accounting/shifts', icon: <Wallet />, label: 'صندوق المبيعات' }, { to: '/customers?new=1', icon: <UserPlus />, label: 'عميل جديد' }].map((q) => (
          <Link key={q.label} to={q.to} className="card flex items-center gap-3 p-4 hover:border-brand-400 transition [&>svg]:size-5 [&>svg]:text-brand-700">{q.icon}<span className="font-medium">{q.label}</span></Link>
        ))}
      </nav>

      {isLoading || !d ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="مبيعاتي" value={money(d.current.sales)} sub={`${pct(d.change.sales)} عن الفترة السابقة`} tone={d.change.sales >= 0 ? 'up' : 'down'} />
            <Stat label="عدد الفواتير" value={d.current.invoices} sub={`متوسط الفاتورة: ${money(d.current.avg)}`} />
            <Stat label="سقف الربح" value={money(d.current.profit)} sub={d.health.no_cost ? 'لم تُحسب تكلفة بعض المنتجات' : 'بعد تكلفة البضاعة'} />
            <Stat label="المصروفات" value={money(d.expenses)} />
            <Stat label="العملاء الجدد" value={d.newCustomers} />
          </div>

          {attention.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-600" />يحتاج انتباهك</span>}>
              <ul className="divide-y divide-ink-100">{attention.map((a) => <li key={a.text}><Link to={a.to} className="flex justify-between py-2 hover:text-brand-700"><span>{a.text}</span><Badge tone="amber">{a.n}</Badge></Link></li>)}</ul>
            </Card>
          )}

          <div className="grid lg:grid-cols-3 gap-5">
            <Card title="المبيعات والأرباح" className="lg:col-span-2" actions={<span className="text-sm text-ink-500">{rangeLabel}</span>}>
              {!d.trend.length ? <Empty /> : (
                <div className="h-64" dir="ltr">
                  <ResponsiveContainer>
                    <AreaChart data={d.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d6e63" stopOpacity={0.25} /><stop offset="1" stopColor="#1d6e63" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid stroke="#efeeea" vertical={false} />
                      <XAxis dataKey="bucket" tickFormatter={(b) => range === 'day' ? b.slice(11, 16) : shortDate(b)} tick={{ fontSize: 12, fill: '#767265' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: '#767265' }} axisLine={false} tickLine={false} width={50} />
                      <Tooltip formatter={(v: number, n) => [money(v), n === 'sales' ? 'المبيعات' : 'سقف الربح']} labelFormatter={(b) => range === 'day' ? String(b).slice(11, 16) : shortDate(String(b))} contentStyle={{ fontFamily: 'Tajawal', borderRadius: 10, direction: 'rtl' }} />
                      <Area type="monotone" dataKey="sales" stroke="#1d6e63" strokeWidth={2} fill="url(#g)" />
                      <Area type="monotone" dataKey="profit" stroke="#9a968a" strokeWidth={2} strokeDasharray="4 3" fill="none" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="flex gap-4 text-sm text-ink-600 mt-2"><span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-brand-600" />المبيعات</span><span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-400" />سقف الربح</span></div>
            </Card>
            <Card title="الملخّص المالي" actions={<span className="text-sm text-ink-500">{rangeLabel}</span>}>
              <dl className="space-y-2 text-[15px]">
                {[['إجمالي المبيعات', d.current.sales], ['الخصومات', d.current.discounts], ['الضريبة', d.current.tax], ['المرتجعات', d.current.returns], ['تكلفة البضاعة', d.current.cost], ['سقف الربح', d.current.profit]].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between border-b border-ink-100 pb-1.5"><dt className="text-ink-600">{k}</dt><dd className="num font-medium">{money(v as number)}</dd></div>
                ))}
              </dl>
              <div className="mt-4 rounded-xl bg-ink-50 p-3">
                <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-medium"><Target className="size-4 text-brand-700" />هدف المبيعات الشهري</span>{can('settings.manage') && <button className="text-sm text-brand-700" onClick={() => { setTarget(d.target.value || null); setTargetOpen(true); }}>{d.target.value ? 'تعديل' : 'ضع هدفاً'}</button>}</div>
                {d.target.value ? <>
                  <div className="h-2.5 rounded-full bg-ink-200 mt-2"><div className="h-2.5 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (d.target.achieved / d.target.value) * 100)}%` }} /></div>
                  <div className="text-sm text-ink-600 mt-1"><span className="num">{money(d.target.achieved, 0)}</span> من <span className="num">{money(d.target.value, 0)}</span> ({Math.round((d.target.achieved / d.target.value) * 100)}%)</div>
                </> : <p className="text-sm text-ink-500 mt-1">ضع هدفاً لمبيعات الشهر لترى تقدّمك كل يوم.</p>}
              </div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            <Card title="الأكثر مبيعاً" actions={<Link to="/reports?r=top" className="text-sm text-brand-700">عرض الكل ←</Link>}>
              <BarList rows={d.top.map((t) => ({ label: t.name, value: t.total, sub: `${t.qty} قطعة` }))} />
            </Card>
            <Card title="المبيعات حسب التصنيف"><BarList rows={d.byCategory.map((c) => ({ label: c.name, value: c.total }))} /></Card>
            <Card title="طرق الدفع"><BarList rows={d.payments.map((p) => ({ label: PAYMENT_LABELS[p.method] ?? p.method, value: p.total, sub: `${p.count} عملية` }))} /></Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            <Card title="ساعات الذروة" className="lg:col-span-2" actions={<span className="text-sm text-ink-500">يوم × ساعة</span>}>
              {!d.heat.length ? <Empty title="لا مبيعات في هذه الفترة لرسم الذروة" /> : (
                <div className="overflow-x-auto">
                  <table className="text-[11px] border-separate border-spacing-0.5" aria-label="خريطة ساعات الذروة">
                    <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} className="font-normal text-ink-500 w-6 num">{h}</th>)}</tr></thead>
                    <tbody>{[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                      <tr key={dow}><th className="font-normal text-ink-600 pe-2 text-start whitespace-nowrap">{DAYS[dow]}</th>
                        {Array.from({ length: 24 }, (_, h) => { const c = d.heat.find((x) => x.dow === dow && x.hour === h); const v = c ? c.total / heatMax : 0;
                          return <td key={h} title={c ? `${DAYS[dow]} ${h}:00 — ${money(c.total)} (${c.count} فاتورة)` : undefined} className="size-6 rounded" style={{ background: v ? `rgba(29,110,99,${0.15 + v * 0.85})` : '#f7f7f5' }} />; })}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="مبيعات الفروع"><BarList rows={d.branches.map((b) => ({ label: b.name, value: b.total }))} /></Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="آخر الفواتير" actions={<Link to="/invoices" className="text-sm text-brand-700">عرض الكل ←</Link>}>
              {!d.latest.length ? <Empty /> : <ul className="divide-y divide-ink-100">{d.latest.map((i) => (
                <li key={i.id} className="flex justify-between py-2"><span><span className="num font-medium">{i.number}</span>{i.type === 'CREDIT_NOTE' && <Badge tone="red">مرتجع</Badge>}<span className="block text-sm text-ink-500">{i.customer ?? 'عميل نقدي'} · {time(i.created_at)}</span></span><span className="num font-bold">{money(i.total)}</span></li>
              ))}</ul>}
            </Card>
            <Card title="النشاطات الأخيرة" actions={<Link to="/activity" className="text-sm text-brand-700">عرض الكل ←</Link>}>
              {!d.activity.length ? <Empty /> : <ul className="divide-y divide-ink-100">{d.activity.map((a, i) => (
                <li key={i} className="py-2 text-[14px]"><span>{a.summary}</span><span className="block text-xs text-ink-500">{a.user_name} · {dateTime(a.created_at)}</span></li>
              ))}</ul>}
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="نفدت أو قاربت على النفاد" actions={<Link to="/inventory/reorder" className="text-sm text-brand-700">عرض الكل ←</Link>}>
              {!d.low.length ? <Empty title="كل المنتجات متوفرة." /> : (
                <table className="table w-full"><thead><tr><th>المنتج</th><th>السعر</th><th>المباع</th><th>المتبقّي</th></tr></thead>
                  <tbody>{d.low.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{money(p.price)}</td><td className="num">{p.sold}</td><td>{p.stock <= 0 ? <Badge tone="red">نفد</Badge> : <span className={clsx('num', 'text-amber-700 font-bold')}>{p.stock}</span>}</td></tr>)}</tbody></table>
              )}
            </Card>
            <Card title="المنتجات الخاملة" actions={<span className="text-sm text-ink-500">90 يوماً فأكثر</span>}>
              {!d.dormant.length ? <Empty /> : (
                <table className="table w-full"><thead><tr><th>المنتج</th><th>السعر</th><th>المتبقّي</th><th>آخر بيع</th></tr></thead>
                  <tbody>{d.dormant.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{money(p.price)}</td><td className="num">{p.stock}</td><td className="text-sm text-ink-500">{p.last_sold ? shortDate(p.last_sold) : 'لم يُبَع قطّ'}</td></tr>)}</tbody></table>
              )}
            </Card>
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="العملاء العائدون">
              {!d.returning.customers ? <Empty title="لا فواتير باسم عميل في هذه الفترة" hint="اختر العميل عند البيع في نقطة البيع لتظهر هذه الأرقام." /> : (
                <div className="grid grid-cols-2 gap-3 text-center"><div className="rounded-xl bg-ink-50 p-4"><div className="text-sm text-ink-500">عملاء اشتروا</div><div className="text-2xl font-extrabold num">{d.returning.customers}</div></div><div className="rounded-xl bg-brand-50 p-4"><div className="text-sm text-brand-700">منهم عائدون</div><div className="text-2xl font-extrabold num">{d.returning.returning}</div></div></div>
              )}
            </Card>
            <Card title="كوبونات قاربت على الانتهاء" actions={<Link to="/marketing/coupons" className="text-sm text-brand-700">عرض الكل ←</Link>}>
              {!d.coupons.length ? <Empty /> : <ul className="divide-y divide-ink-100">{d.coupons.map((c) => <li key={c.id} className="flex justify-between py-2"><span>{c.name} <span className="num text-ink-500">{c.code}</span></span><span className="text-sm">{shortDate(c.ends_at)}</span></li>)}</ul>}
            </Card>
          </div>
        </div>
      )}
      <Modal open={targetOpen} onClose={() => setTargetOpen(false)} title="هدف المبيعات الشهري" size="sm" footer={<Button loading={saveTarget.isPending} onClick={() => saveTarget.mutate()}>حفظ</Button>}>
        <NumberInput label="الهدف" suffix="ر.س" value={target} onChange={setTarget} hint="يسري الهدف على كل شهر حتى تغيّره." />
      </Modal>
    </>
  );
}
