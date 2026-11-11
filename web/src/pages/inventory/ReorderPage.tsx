import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, qty } from '../../lib/format';
import { Badge, Card, Empty, PageHeader, Select, Spinner, Stat } from '../../components/ui';

interface Row { id: number; name: string; barcode: string | null; branch: string; available: number; reorder_level: number; sold60: number; target: number; suggested: number; last_cost: number | null; supplier: string | null; estValue: number | null; status: string }

export default function ReorderPage() {
  const { me } = useAuth(); const [branch, setBranch] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['reorder', branch], queryFn: () => api<Row[]>('/inventory/reorder-suggestions', { query: { branchId: branch } }) });
  return (
    <>
      <PageHeader title="أوامر الشراء المقترحة" subtitle="راجع احتياج الفروع ثم خطط للشراء حسب المورد. تُحسب الاقتراحات من المخزون المجرود وحدود إعادة الطلب ومبيعات آخر 60 يوماً." actions={<Link to="/purchases" className="btn-primary">المشتريات</Link>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="بنود تحتاج مراجعة" value={data?.length ?? 0} /><Stat label="أصناف نافدة" value={data?.filter((r) => r.status === 'OUT').length ?? 0} />
        <Stat label="موردون مقترحون" value={new Set(data?.map((r) => r.supplier).filter(Boolean)).size} /><Stat label="القيمة التقديرية" value={money(data?.reduce((s, r) => s + (r.estValue ?? 0), 0))} sub="من آخر تكلفة شراء معروفة" />
      </div>
      <Card bodyClass="!p-0">
        <div className="p-4 max-w-xs"><Select aria-label="الفرع" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">كل الفروع</option>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>
        {isLoading ? <Spinner /> : !data?.length ? <Empty title="لا اقتراحات شراء حالياً" hint="كل الأصناف المجرودة فوق حد إعادة الطلب." /> : (
          <div className="overflow-x-auto"><table className="table w-full">
            <thead><tr><th>الصنف</th><th>الفرع</th><th>المتاح</th><th>حد الطلب</th><th>مبيع 60 يوماً</th><th>الكمية المقترحة</th><th>المورد / آخر تكلفة</th></tr></thead>
            <tbody>{data.map((r, i) => <tr key={i}><td>{r.name}{r.status === 'OUT' ? <Badge tone="red">نافد</Badge> : <Badge tone="amber">منخفض</Badge>}</td><td>{r.branch}</td><td className="num">{qty(r.available)}</td><td className="num">{qty(r.reorder_level)}</td><td className="num">{qty(r.sold60)}</td><td className="num font-bold text-brand-800">{r.suggested}</td><td className="text-sm">{r.supplier ?? 'بلا مورد'}{r.last_cost != null && <span className="block num text-ink-500">{money(r.last_cost)}</span>}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="text-[13px] text-ink-500 p-4">الكمية المقترحة = المستوى المستهدف − المتاح. المستوى المستهدف = حد الطلب + بيع 30 يوماً المتوقع من متوسط آخر 60 يوماً. هذه قائمة تخطيط؛ تُنشأ فاتورة الشراء يدوياً من المشتريات.</p>
      </Card>
    </>
  );
}
