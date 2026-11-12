// المنيو الذكي العام: يفتحه الزبون بمسح رمز QR
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Phone } from 'lucide-react';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { Empty, Spinner, clsx } from '../../components/ui';

interface Menu { store: { name: string; subtitle: string; logo: string; phone: string; whatsapp: string; currency: string }; categories: Array<{ id: number; name: string; image: string | null }>; products: Array<{ id: number; name: string; nameEn: string | null; price: number | null; image: string | null; categoryId: number | null; description: string | null; isWeighted: boolean; pricePerWeight: number | null; available: boolean }> }

export default function PublicMenuPage() {
  const branch = new URLSearchParams(location.search).get('branch') ?? undefined;
  const { data, isLoading, error } = useQuery({ queryKey: ['public-menu', branch], queryFn: () => api<Menu>('/public/menu', { query: { branch } }) });
  const [cat, setCat] = useState<number | null>(null);
  if (isLoading) return <Spinner className="py-40" />;
  if (error || !data) return <Empty title="المنيو غير متاح حالياً." />;
  const list = data.products.filter((p) => !cat || p.categoryId === cat);
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="bg-brand-800 text-white px-4 pt-8 pb-6 text-center">
        {data.store.logo && <img src={data.store.logo} alt="" className="h-14 mx-auto mb-3 object-contain" />}
        <h1 className="text-2xl font-extrabold">{data.store.name}</h1>
        {data.store.subtitle && <p className="text-brand-100 mt-1">{data.store.subtitle}</p>}
        <div className="flex justify-center gap-3 mt-3">
          {data.store.whatsapp && <a href={`https://wa.me/${data.store.whatsapp.replace(/^0/, '966').replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 h-9 text-sm"><MessageCircle className="size-4" />واتساب</a>}
          {data.store.phone && <a href={`tel:${data.store.phone}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 h-9 text-sm"><Phone className="size-4" />اتصال</a>}
        </div>
      </header>
      <nav className="sticky top-0 z-10 bg-white border-b border-ink-200 flex gap-2 overflow-x-auto px-4 py-2" aria-label="الأقسام">
        <button onClick={() => setCat(null)} className={clsx('shrink-0 rounded-full px-4 h-9 text-sm', !cat ? 'bg-brand-700 text-white' : 'bg-ink-100')}>الكل</button>
        {data.categories.map((c) => <button key={c.id} onClick={() => setCat(c.id)} className={clsx('shrink-0 rounded-full px-4 h-9 text-sm', cat === c.id ? 'bg-brand-700 text-white' : 'bg-ink-100')}>{c.name}</button>)}
      </nav>
      <main className="max-w-3xl mx-auto p-4 grid gap-3">
        {list.map((p) => (
          <article key={p.id} className={clsx('card flex gap-3 p-3', !p.available && 'opacity-50')}>
            <div className="size-20 shrink-0 rounded-lg bg-ink-100 overflow-hidden flex items-center justify-center text-2xl font-bold text-ink-300">{p.image ? <img src={p.image} alt="" className="size-full object-cover" loading="lazy" /> : p.name.slice(0, 1)}</div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold">{p.name}</h2>
              {p.description && <p className="text-sm text-ink-500 line-clamp-2">{p.description}</p>}
              <div className="mt-1 flex items-center justify-between">
                {p.price != null && <span className="font-extrabold text-brand-800"><span className="num">{money(p.isWeighted ? p.pricePerWeight ?? p.price : p.price)}</span> {data.store.currency}{p.isWeighted && ' / كجم'}</span>}
                {!p.available && <span className="text-sm text-red-600">غير متوفر</span>}
              </div>
            </div>
          </article>
        ))}
        {!list.length && <Empty />}
      </main>
      <footer className="text-center text-xs text-ink-400 py-6">الأسعار شاملة ضريبة القيمة المضافة</footer>
    </div>
  );
}
