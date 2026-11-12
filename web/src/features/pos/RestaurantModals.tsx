// نوافذ المطاعم في الكاشير: الطاولات ومجموعات الأسعار
import { useQuery } from '@tanstack/react-query';
import { Armchair, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { money, time } from '../../lib/format';
import { Empty, Modal, Spinner, clsx } from '../../components/ui';

export interface TableRow { id: number; name: string; area: string | null; seats: number; occupied: boolean; heldId: number | null; orderNo: number | null; since: string | null; amount: number; active: boolean }

export function TablesModal({ open, onClose, branchId, current, onPick }: { open: boolean; onClose: () => void; branchId: number; current: number | null; onPick: (t: TableRow) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['tables', branchId], queryFn: () => api<TableRow[]>('/tables', { query: { branchId } }), enabled: open, refetchInterval: open ? 10_000 : false });
  const areas = [...new Set((data ?? []).filter((t) => t.active).map((t) => t.area ?? 'عام'))];
  return (
    <Modal open={open} onClose={onClose} title="اختيار الطاولة" size="xl">
      {isLoading ? <Spinner /> : !data?.length ? <Empty title="لا توجد طاولات" hint="أضف الطاولات من الإعدادات ← المطاعم والطلبات." /> : areas.map((area) => (
        <section key={area} className="mb-5">
          <h3 className="font-bold text-ink-600 mb-2">{area}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {data.filter((t) => t.active && (t.area ?? 'عام') === area).map((t) => (
              <button key={t.id} onClick={() => onPick(t)}
                className={clsx('rounded-xl border-2 p-3 text-start transition', t.id === current ? 'border-brand-600 bg-brand-50' : t.occupied ? 'border-amber-400 bg-amber-50 hover:bg-amber-100' : 'border-ink-200 bg-white hover:border-brand-400')}>
                <div className="flex items-center justify-between"><span className="font-bold">{t.name}</span><Armchair className={clsx('size-5', t.occupied ? 'text-amber-600' : 'text-ink-400')} /></div>
                <div className="text-xs text-ink-500 mt-1 flex items-center gap-1"><Users className="size-3" /><span className="num">{t.seats}</span></div>
                {t.occupied ? <div className="text-sm mt-1"><span className="num font-bold">{money(t.amount)}</span>{t.orderNo && <span className="text-ink-500"> · #{t.orderNo}</span>}{t.since && <span className="block text-xs text-ink-500">منذ {time(t.since)}</span>}</div>
                  : <div className="text-sm text-emerald-700 mt-1">متاحة</div>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </Modal>
  );
}

export function PriceListModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (pl: { id: number; name: string } | null) => void }) {
  const { data } = useQuery({ queryKey: ['price-lists'], queryFn: () => api<Array<{ id: number; name: string; adjustPercent: number; active: boolean; itemsCount: number }>>('/price-lists'), enabled: open });
  return (
    <Modal open={open} onClose={onClose} title="مجموعة الأسعار" size="sm">
      <p className="text-sm text-ink-600 mb-3">تُطبَّق أسعار المجموعة على كل بنود السلة.</p>
      <div className="grid gap-2">
        <button className="rounded-xl border border-ink-200 px-4 py-3 text-start hover:bg-ink-50" onClick={() => onPick(null)}>السعر الافتراضي</button>
        {data?.filter((p) => p.active).map((p) => (
          <button key={p.id} className="rounded-xl border border-ink-200 px-4 py-3 text-start hover:bg-brand-50" onClick={() => onPick(p)}>
            <b>{p.name}</b><span className="block text-sm text-ink-500">{p.adjustPercent ? `تعديل عام ${p.adjustPercent > 0 ? '+' : ''}${p.adjustPercent}%` : 'بدون تعديل عام'}{p.itemsCount ? ` · ${p.itemsCount} سعر خاص` : ''}</span>
          </button>
        ))}
        {data && !data.length && <Empty title="لا توجد مجموعات أسعار" hint="أنشئها من الإعدادات ← مجموعات الأسعار." />}
      </div>
    </Modal>
  );
}
