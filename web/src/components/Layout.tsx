import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, FileText, BarChart3, Users, Package, Calculator, Truck, KeyRound, Megaphone, Settings, Menu, X, LogOut, Store, ChevronDown, UserRound, Activity, Plus } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { clsx } from './ui';

type NavItem = { to: string; label: string; icon: ReactNode; perm?: string[]; children?: Array<{ to: string; label: string; perm?: string[] }> };
const NAV: NavItem[] = [
  { to: '/', label: 'لوحة التحكم', icon: <LayoutDashboard />, perm: ['dashboard.view', 'reports.view'] },
  { to: '/pos', label: 'نقطة البيع', icon: <ShoppingCart />, perm: ['pos.use'] },
  { to: '/invoices', label: 'الفواتير', icon: <FileText />, perm: ['invoices.view', 'pos.use'] },
  { to: '/reports', label: 'مركز التقارير', icon: <BarChart3 />, perm: ['reports.view'] },
  { to: '/customers', label: 'العملاء', icon: <Users />, perm: ['customers.view'] },
  { to: '/products', label: 'المنتجات والمخزون', icon: <Package />, perm: ['products.view'], children: [
    { to: '/products', label: 'المنتجات' }, { to: '/categories', label: 'التصنيفات' },
    { to: '/inventory/transfers', label: 'تحويلات المخزون', perm: ['inventory.transfer'] }, { to: '/inventory/reorder', label: 'أوامر الشراء المقترحة' },
  ] },
  { to: '/accounting', label: 'المحاسبة', icon: <Calculator />, perm: ['accounting.view', 'shifts.manage'], children: [
    { to: '/accounting', label: 'نظرة عامة', perm: ['accounting.view'] }, { to: '/accounting/accounts', label: 'الحسابات والقيود', perm: ['accounting.view'] },
    { to: '/accounting/statements', label: 'القوائم المالية', perm: ['accounting.view'] }, { to: '/accounting/vat', label: 'الإقفال والضريبة', perm: ['accounting.view'] },
    { to: '/accounting/shifts', label: 'الصندوق والتسويات', perm: ['shifts.manage'] },
  ] },
  { to: '/purchases', label: 'المشتريات والمصروفات', icon: <Truck />, perm: ['purchases.manage', 'expenses.manage', 'suppliers.manage'], children: [
    { to: '/purchases', label: 'المشتريات', perm: ['purchases.manage'] }, { to: '/suppliers', label: 'الموردون', perm: ['suppliers.manage', 'purchases.manage'] }, { to: '/expenses', label: 'المصروفات', perm: ['expenses.manage'] },
  ] },
  { to: '/rentals', label: 'عقود الإيجار', icon: <KeyRound />, perm: ['rentals.manage'] },
  { to: '/marketing', label: 'الأدوات التسويقية', icon: <Megaphone />, perm: ['marketing.manage'], children: [{ to: '/marketing/coupons', label: 'الكوبونات' }, { to: '/marketing/offers', label: 'العروض والتخفيضات' }] },
  { to: '/activity', label: 'سجل الأحداث', icon: <Activity />, perm: ['reports.view', 'settings.manage'] },
  { to: '/settings', label: 'الإعدادات', icon: <Settings />, perm: ['settings.manage', 'users.manage'] },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, me } = useAuth();
  const loc = useLocation();
  const visible = NAV.filter((n) => !n.perm || can(...n.perm));
  return (
    <nav aria-label="القائمة الرئيسية" className="flex flex-col h-full">
      <Link to="/" className="flex items-center gap-2.5 px-5 h-16 shrink-0" onClick={onNavigate}>
        <img src="/favicon.svg" alt="" className="size-8" />
        <div className="leading-tight">
          <div className="font-extrabold text-[17px]">رصيد</div>
          <div className="text-xs text-ink-500 truncate max-w-[150px]">{me?.store.name}</div>
        </div>
      </Link>
      <ul className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
        {visible.map((n) => {
          const active = n.to === '/' ? loc.pathname === '/' : n.children ? n.children.some((c) => loc.pathname.startsWith(c.to)) || loc.pathname.startsWith(n.to) : loc.pathname.startsWith(n.to);
          return (
            <li key={n.to}>
              <NavLink to={n.to} end={n.to === '/'} onClick={onNavigate}
                className={clsx('flex items-center gap-3 rounded-lg px-3 h-10 text-[15px] transition [&>svg]:size-[18px]', active ? 'bg-brand-50 text-brand-800 font-bold' : 'text-ink-700 hover:bg-ink-100')}>
                {n.icon}<span className="flex-1">{n.label}</span>{n.children && <ChevronDown className={clsx('!size-4 transition', active && 'rotate-180')} />}
              </NavLink>
              {n.children && active && (
                <ul className="mt-0.5 mb-1 ms-6 border-s border-ink-200 ps-2 space-y-0.5">
                  {n.children.filter((c) => !c.perm || can(...c.perm)).map((c) => (
                    <li key={c.to}><NavLink to={c.to} end onClick={onNavigate} className={({ isActive }) => clsx('block rounded-md px-3 py-1.5 text-[14px]', isActive ? 'text-brand-800 font-bold bg-brand-50/60' : 'text-ink-600 hover:text-ink-900')}>{c.label}</NavLink></li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function Layout() {
  const { me, branchId, setBranchId, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  return (
    <div className="min-h-screen lg:ps-[260px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 btn-primary">تخطَّ إلى المحتوى</a>
      <aside className="hidden lg:block fixed inset-y-0 start-0 w-[260px] bg-white border-e border-ink-200"><Sidebar /></aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-[280px] bg-white shadow-pop"><Sidebar onNavigate={() => setOpen(false)} /></aside>
        </div>
      )}
      <header className="sticky top-0 z-30 h-16 bg-white/90 backdrop-blur border-b border-ink-200 flex items-center gap-3 px-4 lg:px-6">
        <button className="lg:hidden btn-ghost !px-2" aria-label="فتح القائمة" onClick={() => setOpen(true)}>{open ? <X /> : <Menu />}</button>
        <label className="flex items-center gap-2 text-sm">
          <Store className="size-4 text-ink-500" aria-hidden />
          <span className="sr-only">الفرع الحالي</span>
          <select className="input !h-9 !w-auto min-w-[140px]" value={branchId} onChange={(e) => setBranchId(Number(e.target.value))}>
            {me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.type === 'WAREHOUSE' ? ' (مستودع)' : ''}</option>)}
          </select>
        </label>
        <div className="flex-1" />
        {can('pos.use') && <Link to="/pos" className="btn-primary !h-9 hidden sm:inline-flex"><Plus className="size-4" />فاتورة جديدة</Link>}
        <div className="relative">
          <button className="flex items-center gap-2 rounded-lg px-2 h-9 hover:bg-ink-100" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <span className="size-8 rounded-full bg-brand-100 text-brand-800 flex items-center justify-center font-bold">{me?.user.name.slice(0, 1)}</span>
            <span className="hidden sm:block text-sm font-medium max-w-[140px] truncate">{me?.user.name}</span>
            <ChevronDown className="size-4 text-ink-500" />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute end-0 mt-2 w-56 z-20 card p-1.5 shadow-pop">
                <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-ink-100 text-start" onClick={() => { setMenu(false); nav('/profile'); }}><UserRound className="size-4" />الملف الشخصي</button>
                {can('settings.manage') && <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-ink-100 text-start" onClick={() => { setMenu(false); nav('/settings'); }}><Settings className="size-4" />كل إعدادات المتجر</button>}
                <button role="menuitem" className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-red-50 text-red-700 text-start" onClick={() => { logout(); nav('/login'); }}><LogOut className="size-4" />تسجيل الخروج</button>
              </div>
            </>
          )}
        </div>
      </header>
      <main id="main" className="p-4 lg:p-6 max-w-[1400px] mx-auto"><Outlet /></main>
    </div>
  );
}
