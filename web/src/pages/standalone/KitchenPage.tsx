// شاشة المطبخ (KDS): الطلبات حسب الحالة لكل قسم مع تحديث تلقائي وتنبيه صوتي
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Volume2, VolumeX, Maximize } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, IconButton, clsx } from '../../components/ui';

interface KOrder { id: number; stationId: number | null; orderNo: number | null; orderType: string | null; tableName: string | null; customerName: string | null; notes: string | null; status: string; createdAt: string; items: Array<{ name: string; qty: number; note?: string | null }> }
const TYPES: Record<string, string> = { DINE_IN: 'محلي', TAKEAWAY: 'سفري', DELIVERY: 'توصيل' };
const COLS = [{ s: 'NEW', l: 'جديدة', next: 'PREPARING', btn: 'بدء التحضير', tone: 'border-sky-400' }, { s: 'PREPARING', l: 'قيد التحضير', next: 'READY', btn: 'جاهز', tone: 'border-amber-400' }, { s: 'READY', l: 'جاهزة للتسليم', next: 'SERVED', btn: 'تم التسليم', tone: 'border-emerald-500' }];

function beep() {
  try { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(0.2, c.currentTime); o.start(); o.stop(c.currentTime + 0.25); } catch { /* تجاهل */ }
}

export default function KitchenPage() {
  const { branchId } = useAuth(); const qc = useQueryClient();
  const [station, setStation] = useState<number | ''>(''); const [sound, setSound] = useState(true); const [now, setNow] = useState(Date.now());
  const { data: stations } = useQuery({ queryKey: ['stations'], queryFn: () => api<Array<{ id: number; name: string; showOnScreen: boolean }>>('/kitchen/stations') });
  const { data } = useQuery({ queryKey: ['kitchen', branchId, station], queryFn: () => api<KOrder[]>('/kitchen/orders', { query: { branchId, stationId: station } }), refetchInterval: 5000 });
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.map((o) => o.id));
    if (seen.current && sound && data.some((o) => !seen.current!.has(o.id) && o.status === 'NEW')) beep();
    seen.current = ids;
  }, [data, sound]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const move = useMutation({ mutationFn: (p: { id: number; status: string }) => api(`/kitchen/orders/${p.id}/status`, { body: { status: p.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['kitchen'] }) });
  const mins = (d: string) => Math.floor((now - new Date(d).getTime()) / 60000);
  return (
    <div className="min-h-screen bg-ink-900 text-white flex flex-col">
      <header className="h-14 flex items-center gap-3 px-4 bg-ink-800 border-b border-ink-700">
        <ChefHat className="size-6 text-amber-400" /><h1 className="font-extrabold text-lg">شاشة المطبخ</h1>
        <select aria-label="القسم" className="h-9 rounded-lg bg-ink-700 border-0 px-3 text-white" value={station} onChange={(e) => setStation(e.target.value ? Number(e.target.value) : '')}>
          <option value="">كل الأقسام</option>{stations?.filter((s) => s.showOnScreen).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        <IconButton label={sound ? 'كتم التنبيه' : 'تشغيل التنبيه'} className="text-white hover:bg-ink-700" onClick={() => setSound((s) => !s)}>{sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}</IconButton>
        <IconButton label="ملء الشاشة" className="text-white hover:bg-ink-700" onClick={() => document.documentElement.requestFullscreen?.()}><Maximize className="size-5" /></IconButton>
      </header>
      <main className="flex-1 grid md:grid-cols-3 gap-3 p-3 overflow-hidden">
        {COLS.map((c) => {
          const list = data?.filter((o) => o.status === c.s) ?? [];
          return (
            <section key={c.s} className="flex flex-col min-h-0" aria-label={c.l}>
              <h2 className="font-bold mb-2 flex items-center gap-2">{c.l}<span className="text-sm bg-ink-700 rounded-full px-2 num">{list.length}</span></h2>
              <div className="flex-1 overflow-y-auto space-y-3 pe-1">
                {list.map((o) => {
                  const m = mins(o.createdAt);
                  return (
                    <article key={o.id} className={clsx('rounded-xl bg-ink-800 border-s-4 p-3', c.tone, m >= 15 && c.s !== 'READY' && 'ring-2 ring-red-500')}>
                      <div className="flex items-start justify-between">
                        <div><div className="text-2xl font-extrabold num">#{o.orderNo ?? o.id}</div><div className="text-sm text-ink-300">{[o.orderType ? TYPES[o.orderType] : '', o.tableName, o.customerName].filter(Boolean).join(' · ')}</div></div>
                        <span className={clsx('text-sm num', m >= 15 ? 'text-red-400 font-bold' : 'text-ink-300')}>{m} د</span>
                      </div>
                      <ul className="mt-2 space-y-1 text-[17px]">{o.items.map((it, i) => <li key={i}><b className="num text-amber-300">{it.qty}×</b> {it.name}{it.note && <span className="block text-sm text-ink-300">↲ {it.note}</span>}</li>)}</ul>
                      {o.notes && <p className="mt-2 text-sm bg-ink-700 rounded p-2">ملاحظة: {o.notes}</p>}
                      <Button className="w-full mt-3" onClick={() => move.mutate({ id: o.id, status: c.next })}>{c.btn}</Button>
                    </article>
                  );
                })}
                {!list.length && <p className="text-ink-400 text-center py-10">لا طلبات</p>}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
