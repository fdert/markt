// شاشة العميل: تُفتح على شاشة ثانية مقابل العميل وتعرض السلة والإجمالي
import { useEffect, useState } from 'react';
import { customerDisplay, type DisplayState } from '../../features/print/customerDisplay';
import { money, qty } from '../../lib/format';

export default function CustomerDisplayPage() {
  const [s, setS] = useState<DisplayState | null>(null);
  useEffect(() => customerDisplay.subscribe(setS), []);
  if (!s || s.status === 'IDLE') return (
    <div className="min-h-screen bg-brand-800 text-white flex flex-col items-center justify-center gap-4">
      <img src="/favicon.svg" alt="" className="size-20 rounded-2xl" />
      <h1 className="text-4xl font-extrabold">{s?.storeName || 'أهلاً وسهلاً'}</h1>
      <p className="text-brand-100 text-xl">أهلاً بك</p>
    </div>
  );
  if (s.status === 'PAID') return (
    <div className="min-h-screen bg-emerald-700 text-white flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-5xl font-extrabold">{s.message ?? 'شكراً لزيارتكم'}</h1>
      <p className="text-2xl">الإجمالي <span className="num font-extrabold">{money(s.total)}</span></p>
      {s.change ? <p className="text-3xl">الباقي <span className="num font-extrabold">{money(s.change)}</span></p> : null}
    </div>
  );
  return (
    <div className="min-h-screen bg-ink-50 grid lg:grid-cols-[1fr_420px]">
      <main className="p-6 overflow-y-auto">
        <h1 className="text-2xl font-extrabold mb-4">{s.storeName}</h1>
        <table className="w-full text-xl">
          <tbody>{s.lines.map((l, i) => <tr key={i} className="border-b border-ink-200"><td className="py-3">{l.name}</td><td className="num text-ink-600 w-24">× {qty(l.qty)}</td><td className="num font-bold text-end w-32">{money(l.total)}</td></tr>)}</tbody>
        </table>
      </main>
      <aside className="bg-brand-800 text-white p-8 flex flex-col justify-end gap-3">
        <div className="flex justify-between text-lg"><span>قبل الضريبة</span><span className="num">{money(s.subtotal)}</span></div>
        {s.discount > 0 && <div className="flex justify-between text-lg text-emerald-300"><span>الخصم</span><span className="num">−{money(s.discount)}</span></div>}
        <div className="flex justify-between text-lg"><span>ضريبة القيمة المضافة</span><span className="num">{money(s.tax)}</span></div>
        {s.rounding ? <div className="flex justify-between text-lg"><span>التقريب</span><span className="num">{money(s.rounding)}</span></div> : null}
        <div className="border-t border-white/20 pt-4 flex justify-between items-end"><span className="text-2xl">الإجمالي</span><span className="text-6xl font-extrabold num">{money(s.total)}</span></div>
        <p className="text-brand-200 text-sm">ريال سعودي — شامل الضريبة</p>
      </aside>
    </div>
  );
}
