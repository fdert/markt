// مركز التقارير: كل تقارير المتجر في مكان واحد
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Printer, Download } from 'lucide-react';
import { api } from '../lib/api';
import { money, qty, date, isoDate, PAYMENT_LABELS, pct } from '../lib/format';
import { Button, Card, Empty, Input, PageHeader, SearchInput, Spinner, Stat, clsx } from '../components/ui';

type Col = { key: string; label: string; fmt?: 'money' | 'qty' | 'date' | 'pct' | 'pay' };
interface Report { id: string; group: string; title: string; desc: string; path: string; cols?: Col[]; chart?: { x: string; y: string }; noRange?: boolean }

const REPORTS: Report[] = [
  { id: 'summary', group: 'المبيعات', title: 'ملخص المبيعات', desc: 'المبيعات والمرتجعات والصافي والضريبة وعدد الفواتير، مقارنة بالفترة السابقة، مع النقد والشبكة.', path: '/reports/sales-summary', chart: { x: 'bucket', y: 'sales' }, cols: [{ key: 'bucket', label: 'الفترة' }, { key: 'sales', label: 'المبيعات', fmt: 'money' }, { key: 'returns', label: 'المرتجعات', fmt: 'money' }, { key: 'tax', label: 'الضريبة', fmt: 'money' }, { key: 'invoices', label: 'الفواتير' }, { key: 'cash', label: 'نقدي', fmt: 'money' }, { key: 'card', label: 'شبكة', fmt: 'money' }] },
  { id: 'top', group: 'المبيعات', title: 'أفضل المنتجات مبيعاً', desc: 'ما يبيع أكثر، وكم تعتمد على قلة من المنتجات، وهل يكفي مخزون الأفضل مبيعاً.', path: '/reports/top-products', chart: { x: 'name', y: 'total' }, cols: [{ key: 'name', label: 'المنتج' }, { key: 'qty', label: 'الكمية', fmt: 'qty' }, { key: 'total', label: 'المبيعات', fmt: 'money' }, { key: 'profit', label: 'الربح', fmt: 'money' }, { key: 'share', label: 'الحصة', fmt: 'pct' }, { key: 'cumulative', label: 'التراكمي', fmt: 'pct' }, { key: 'stock', label: 'المخزون', fmt: 'qty' }] },
  { id: 'payment', group: 'المبيعات', title: 'المبيعات حسب طريقة الدفع', desc: 'كيف يدفع زبائنك، وكم بعت بالآجل، وبأي طريقة رددت المرتجعات.', path: '/reports/by-payment', cols: [{ key: 'method', label: 'الطريقة', fmt: 'pay' }, { key: 'received', label: 'المقبوض', fmt: 'money' }, { key: 'refunded', label: 'المردود', fmt: 'money' }, { key: 'count', label: 'العمليات' }] },
  { id: 'branch', group: 'المبيعات', title: 'المبيعات حسب الفرع', desc: 'أي فرع يبيع أكثر، ومتوسط الفاتورة والمرتجعات والخصومات في كل فرع.', path: '/reports/by-branch', chart: { x: 'name', y: 'sales' }, cols: [{ key: 'name', label: 'الفرع' }, { key: 'sales', label: 'المبيعات', fmt: 'money' }, { key: 'invoices', label: 'الفواتير' }, { key: 'avg', label: 'متوسط الفاتورة', fmt: 'money' }, { key: 'returns', label: 'المرتجعات', fmt: 'money' }, { key: 'discounts', label: 'الخصومات', fmt: 'money' }] },
  { id: 'category', group: 'المبيعات', title: 'المبيعات حسب التصنيف', desc: 'أي تصنيف يحمل متجرك، وكم من مبيعاتك لمنتجات بلا تصنيف.', path: '/reports/by-category', chart: { x: 'name', y: 'total' }, cols: [{ key: 'name', label: 'التصنيف' }, { key: 'qty', label: 'الكمية', fmt: 'qty' }, { key: 'total', label: 'المبيعات', fmt: 'money' }, { key: 'profit', label: 'الربح', fmt: 'money' }] },
  { id: 'cashier', group: 'المبيعات', title: 'أداء الكاشير/الموظف', desc: 'من يبيع أكثر، ومن فاتورته أصغر أو خصوماته ومرتجعاته أكبر.', path: '/reports/by-cashier', cols: [{ key: 'name', label: 'الموظف' }, { key: 'sales', label: 'المبيعات', fmt: 'money' }, { key: 'invoices', label: 'الفواتير' }, { key: 'avg', label: 'متوسط الفاتورة', fmt: 'money' }, { key: 'discounts', label: 'الخصومات', fmt: 'money' }, { key: 'returns', label: 'المرتجعات', fmt: 'money' }] },
  { id: 'returns', group: 'المبيعات', title: 'المرتجعات والاستردادات', desc: 'أي منتج يرجع أكثر وكم خرج نقداً.', path: '/reports/returns', cols: [{ key: 'name', label: 'المنتج' }, { key: 'qty', label: 'الكمية', fmt: 'qty' }, { key: 'total', label: 'القيمة', fmt: 'money' }] },
  { id: 'offers', group: 'المبيعات', title: 'مبيعات العروض والكوبونات', desc: 'كم بعت بالعروض وكم كلفتك.', path: '/reports/offers', cols: [{ key: 'name', label: 'العرض / الكوبون' }, { key: 'invoices', label: 'الفواتير' }, { key: 'sales', label: 'المبيعات', fmt: 'money' }, { key: 'discount', label: 'الخصم الممنوح', fmt: 'money' }] },
  { id: 'employee', group: 'المبيعات', title: 'مبيعات الموظفين', desc: 'ما اشتراه الموظفون بسعر التكلفة وتسوية الضريبة عليه.', path: '/reports/employee-sales', cols: [{ key: 'number', label: 'الفاتورة' }, { key: 'created_at', label: 'التاريخ', fmt: 'date' }, { key: 'cashier', label: 'الكاشير' }, { key: 'total', label: 'الإجمالي', fmt: 'money' }, { key: 'tax_total', label: 'الضريبة', fmt: 'money' }] },
  { id: 'customers', group: 'العملاء', title: 'أهم العملاء', desc: 'من أهم عملائك ومتى اشتروا آخر مرة.', path: '/reports/customers', cols: [{ key: 'name', label: 'العميل' }, { key: 'phone', label: 'الجوال' }, { key: 'invoices', label: 'الفواتير' }, { key: 'total', label: 'المشتريات', fmt: 'money' }, { key: 'last_purchase', label: 'آخر شراء', fmt: 'date' }] },
  { id: 'aging', group: 'العملاء', title: 'أعمار ذمم العملاء', desc: 'كم لك عند العملاء وكم تأخر منه.', path: '/reports/ar-aging', noRange: true, cols: [{ key: 'customer', label: 'العميل' }, { key: 'd0_30', label: '0–30 يوماً', fmt: 'money' }, { key: 'd31_60', label: '31–60', fmt: 'money' }, { key: 'd61_90', label: '61–90', fmt: 'money' }, { key: 'd90_plus', label: 'أكثر من 90', fmt: 'money' }, { key: 'total', label: 'الإجمالي', fmt: 'money' }] },
  { id: 'purchases', group: 'المشتريات والمصروفات', title: 'المشتريات حسب المورد', desc: 'الموردون والمبالغ المستحقة لهم.', path: '/reports/purchases', cols: [{ key: 'supplier', label: 'المورد' }, { key: 'count', label: 'الفواتير' }, { key: 'total', label: 'الإجمالي', fmt: 'money' }, { key: 'due', label: 'المستحق', fmt: 'money' }] },
  { id: 'expenses', group: 'المشتريات والمصروفات', title: 'التقرير العام للمصروفات', desc: 'المصروفات حسب التصنيف.', path: '/reports/expenses', chart: { x: 'category', y: 'total' }, cols: [{ key: 'category', label: 'التصنيف' }, { key: 'count', label: 'العمليات' }, { key: 'total', label: 'الإجمالي', fmt: 'money' }] },
  { id: 'inventory', group: 'المخزون', title: 'تقييم المخزون', desc: 'الكميات وقيمتها بالتكلفة لكل منتج.', path: '/reports/inventory', noRange: true, cols: [{ key: 'name', label: 'المنتج' }, { key: 'category', label: 'التصنيف' }, { key: 'qty', label: 'الكمية', fmt: 'qty' }, { key: 'cost', label: 'التكلفة', fmt: 'money' }, { key: 'value', label: 'القيمة', fmt: 'money' }, { key: 'expiry_date', label: 'الصلاحية', fmt: 'date' }] },
  { id: 'costgap', group: 'المخزون', title: 'فجوة تكلفة المنتجات', desc: 'المنتجات المباعة التي لا تكلفة لها، مرتّبة بأثرها على المبيعات.', path: '/reports/cost-gap', cols: [{ key: 'name', label: 'المنتج' }, { key: 'qty', label: 'الكمية', fmt: 'qty' }, { key: 'total', label: 'المبيعات', fmt: 'money' }] },
  { id: 'profit', group: 'الأرباح', title: 'الأرباح والخسائر', desc: 'صافي المبيعات وتكلفة البضاعة والمصروفات وصافي الربح.', path: '/reports/profit' },
  { id: 'hourly', group: 'المبيعات', title: 'المبيعات حسب الساعة (الذروة)', desc: 'متى يزدحم متجرك يوماً وساعة.', path: '/reports/hourly', chart: { x: 'hour', y: 'total' } },
];

const fmtVal = (v: unknown, f?: Col['fmt']) => v == null ? '—' : f === 'money' ? money(v as number) : f === 'qty' ? qty(v as number) : f === 'date' ? date(v as string) : f === 'pct' ? `${v}%` : f === 'pay' ? PAYMENT_LABELS[v as string] ?? String(v) : String(v);

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('r') ?? 'summary';
  const report = REPORTS.find((r) => r.id === id) ?? REPORTS[0];
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 29 * 86400000))); const [to, setTo] = useState(isoDate());
  const { data, isLoading } = useQuery({ queryKey: ['report', report.path, from, to], queryFn: () => api<unknown>(report.path, { query: report.noRange ? {} : { from, to } }) });
  const rows: Array<Record<string, unknown>> = useMemo(() => {
    const d = data as { rows?: unknown[] } | unknown[] | undefined;
    if (!d) return [];
    if (report.id === 'hourly') { const byH = new Map<number, number>(); (d as Array<{ hour: number; total: number }>).forEach((x) => byH.set(x.hour, (byH.get(x.hour) ?? 0) + x.total)); return Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, total: byH.get(h) ?? 0 })); }
    return (Array.isArray(d) ? d : d.rows ?? []) as Array<Record<string, unknown>>;
  }, [data, report.id]);
  const summary = data as { current?: Record<string, number>; previous?: Record<string, number>; credit?: number } & Record<string, number>;
  const exportCsv = () => {
    if (!report.cols) return;
    const csv = '﻿' + [report.cols.map((c) => c.label).join(','), ...rows.map((r) => report.cols!.map((c) => `"${fmtVal(r[c.key], c.fmt).replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${report.id}.csv`; a.click();
  };
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  const filtered = REPORTS.filter((r) => !q || r.title.includes(q) || r.desc.includes(q));
  return (
    <>
      <PageHeader title="مركز التقارير" subtitle="كل تقارير متجرك في مكان واحد. افتح تقريراً أو ابحث عنه باسمه." />
      <div className="grid lg:grid-cols-[280px_1fr] gap-5">
        <aside className="card p-3 h-fit lg:sticky lg:top-20">
          <SearchInput value={q} onChange={setQ} placeholder="ابحث عن تقرير" />
          <nav className="mt-3 space-y-3" aria-label="التقارير">{groups.map((g) => {
            const list = filtered.filter((r) => r.group === g); if (!list.length) return null;
            return <div key={g}><div className="text-xs font-bold text-ink-500 px-2 mb-1">{g}</div>{list.map((r) => (
              <button key={r.id} onClick={() => setParams({ r: r.id })} className={clsx('w-full text-start px-3 py-2 rounded-lg text-[14px]', r.id === report.id ? 'bg-brand-50 text-brand-800 font-bold' : 'hover:bg-ink-50')}>{r.title}</button>
            ))}</div>;
          })}</nav>
        </aside>
        <div className="space-y-4 min-w-0">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-xl font-extrabold">{report.title}</h2><p className="text-ink-500 text-sm mt-1 max-w-2xl">{report.desc}</p></div>
              <div className="flex flex-wrap gap-2 items-end">
                {!report.noRange && <><Input type="date" aria-label="من" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" aria-label="إلى" value={to} onChange={(e) => setTo(e.target.value)} /></>}
                {report.cols && <Button variant="secondary" onClick={exportCsv}><Download className="size-4" />تصدير</Button>}
                <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" />طباعة</Button>
              </div>
            </div>
          </Card>
          {isLoading ? <Spinner /> : <>
            {report.id === 'summary' && summary?.current && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Stat label="المبيعات" value={money(summary.current.sales)} sub={`${pct(summary.previous?.sales ? ((summary.current.sales - summary.previous.sales) / summary.previous.sales) * 100 : 0)} عن الفترة السابقة`} />
                <Stat label="المرتجعات" value={money(summary.current.returns)} /><Stat label="الصافي" value={money(summary.current.net)} /><Stat label="الضريبة" value={money(summary.current.tax)} /><Stat label="الفواتير" value={summary.current.invoices} sub={`متوسط ${money(summary.current.avg)}`} />
              </div>
            )}
            {report.id === 'payment' && summary?.credit != null && <Stat label="بيع آجل لم يُحصَّل" value={money(summary.credit)} />}
            {report.id === 'profit' && summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="صافي المبيعات قبل الضريبة" value={money(summary.net_ex_tax)} /><Stat label="تكلفة البضاعة المباعة" value={money(summary.cost)} /><Stat label="مجمل الربح" value={money(summary.profit)} /><Stat label="المصروفات" value={money(summary.expenses)} />
                <Stat label="صافي الربح" value={money(summary.netProfit)} tone={summary.netProfit >= 0 ? 'up' : 'down'} />
              </div>
            )}
            {report.chart && rows.length > 0 && (
              <Card title="الرسم البياني"><div className="h-72" dir="ltr"><ResponsiveContainer>
                <BarChart data={rows.slice(0, 24)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#efeeea" vertical={false} />
                  <XAxis dataKey={report.chart.x} tick={{ fontSize: 11, fill: '#767265' }} axisLine={false} tickLine={false} interval={0} angle={rows.length > 8 ? -30 : 0} height={rows.length > 8 ? 60 : 30} tickFormatter={(v) => String(v).slice(0, 14)} />
                  <YAxis tick={{ fontSize: 12, fill: '#767265' }} axisLine={false} tickLine={false} width={55} />
                  <Tooltip formatter={(v: number) => money(v)} contentStyle={{ fontFamily: 'Tajawal', borderRadius: 10, direction: 'rtl' }} cursor={{ fill: '#eef8f6' }} />
                  <Bar dataKey={report.chart.y} fill="#1d6e63" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer></div></Card>
            )}
            {report.cols && (
              <Card bodyClass="!p-0">{!rows.length ? <Empty title="لا بيانات في هذه الفترة" /> : (
                <div className="overflow-x-auto"><table className="table w-full"><thead><tr>{report.cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>{rows.map((r, i) => <tr key={i}>{report.cols!.map((c) => <td key={c.key} className={c.fmt && c.fmt !== 'pay' && c.fmt !== 'date' ? 'num' : ''}>{fmtVal(r[c.key], c.fmt)}</td>)}</tr>)}</tbody></table></div>
              )}</Card>
            )}
          </>}
        </div>
      </div>
    </>
  );
}
