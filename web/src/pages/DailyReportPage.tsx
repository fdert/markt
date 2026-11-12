// التقرير اليومي (X): ملخص اليوم بطرق الدفع وأنواع الطلبات والموظفين مع طباعة حرارية
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date, isoDate, dateTime } from '../lib/format';
import { Button, Card, Input, PageHeader, Select, Spinner, Stat } from '../components/ui';
import { printHtml } from '../features/print/receipt';
import { deviceStore } from '../features/print/escpos';

interface Daily { date: string; sales: number; returns: number; net: number; invoices: number; returns_count: number; discounts: number; rounding: number; tax: number; credit: number; walletTopups: number; expenses: number;
  methods: Array<{ method: string; name: string; total: number; count: number }>; types: Array<{ type: string; count: number; total: number }>; users: Array<{ name: string; count: number; total: number }> }
const TYPES: Record<string, string> = { DINE_IN: 'محلي', TAKEAWAY: 'سفري', DELIVERY: 'توصيل' };

export default function DailyReportPage() {
  const { me } = useAuth(); const [day, setDay] = useState(isoDate()); const [branch, setBranch] = useState('');
  const { data } = useQuery({ queryKey: ['daily', day, branch], queryFn: () => api<Daily>('/reports/daily', { query: { date: day, branchId: branch } }) });
  const print = () => {
    if (!data) return;
    const w = deviceStore.get().paperWidth;
    const row = (k: string, v: string) => `<div class="r"><span>${k}</span><span class="n">${v}</span></div>`;
    printHtml(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>@page{size:${w}mm auto;margin:0}body{width:${w}mm;padding:4mm;font-family:Tajawal,Tahoma;font-size:12.5px}.r{display:flex;justify-content:space-between;padding:2px 0}.n{direction:ltr}h3{text-align:center;margin:4px 0}hr{border:0;border-top:1px dashed #000}.b{font-weight:800;font-size:15px}</style></head><body>
      <h3>${me?.store.name ?? ''}</h3><h3>تقرير المبيعات اليومي (X)</h3><div style="text-align:center">${date(data.date)}</div><div style="text-align:center">طُبع: ${dateTime(new Date())}</div><hr>
      ${row('عدد الفواتير', String(data.invoices))}${row('إجمالي المبيعات', money(data.sales))}${row('المرتجعات (' + data.returns_count + ')', money(data.returns))}${row('الخصومات', money(data.discounts))}${row('التقريب', money(data.rounding))}${row('ضريبة القيمة المضافة', money(data.tax))}
      <div class="r b"><span>صافي المبيعات</span><span class="n">${money(data.net)}</span></div>${row('مبيعات آجلة', money(data.credit))}${row('شحن المحافظ', money(data.walletTopups))}${row('المصروفات', money(data.expenses))}<hr>
      <b>طرق الدفع</b>${data.methods.map((m) => row(`${m.name} (${m.count})`, money(m.total))).join('')}<hr>
      <b>أنواع الطلبات</b>${data.types.map((t) => row(`${TYPES[t.type] ?? t.type} (${t.count})`, money(t.total))).join('')}<hr>
      <b>الموظفون</b>${data.users.map((u) => row(`${u.name} (${u.count})`, money(u.total))).join('')}</body></html>`);
  };
  return (
    <>
      <PageHeader title="التقرير اليومي" subtitle="ملخص مبيعات اليوم لطباعته على طابعة الكاشير" actions={<Button onClick={print} disabled={!data}><Printer className="size-4" />طباعة التقرير</Button>} />
      <div className="flex flex-wrap gap-2 mb-4 items-end"><Input label="اليوم" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <Select label="الفرع" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">كل الفروع</option>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>
      {!data ? <Spinner /> : <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3"><Stat label="صافي المبيعات" value={money(data.net)} /><Stat label="الفواتير" value={data.invoices} /><Stat label="المرتجعات" value={money(data.returns)} sub={`${data.returns_count} فاتورة`} /><Stat label="الضريبة" value={money(data.tax)} /><Stat label="الخصومات" value={money(data.discounts)} /></div>
        <div className="grid lg:grid-cols-3 gap-5">
          <Card title="طرق الدفع"><ul className="divide-y divide-ink-100">{data.methods.map((m) => <li key={m.method} className="flex justify-between py-2"><span>{m.name} <span className="text-ink-500 text-sm">({m.count})</span></span><span className="num font-bold">{money(m.total)}</span></li>)}</ul></Card>
          <Card title="أنواع الطلبات"><ul className="divide-y divide-ink-100">{data.types.map((t) => <li key={t.type} className="flex justify-between py-2"><span>{TYPES[t.type] ?? t.type} <span className="text-ink-500 text-sm">({t.count})</span></span><span className="num font-bold">{money(t.total)}</span></li>)}</ul></Card>
          <Card title="الموظفون"><ul className="divide-y divide-ink-100">{data.users.map((u) => <li key={u.name} className="flex justify-between py-2"><span>{u.name} <span className="text-ink-500 text-sm">({u.count})</span></span><span className="num font-bold">{money(u.total)}</span></li>)}</ul></Card>
        </div>
      </div>}
    </>
  );
}
