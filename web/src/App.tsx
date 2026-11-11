import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import { Spinner, Empty } from './components/ui';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const PosPage = lazy(() => import('./features/pos/PosPage'));
const InvoicesPage = lazy(() => import('./pages/invoices/InvoicesPage'));
const ProductsPage = lazy(() => import('./pages/products/ProductsPage'));
const CategoriesPage = lazy(() => import('./pages/products/CategoriesPage'));
const TransfersPage = lazy(() => import('./pages/inventory/TransfersPage'));
const ReorderPage = lazy(() => import('./pages/inventory/ReorderPage'));
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage'));
const SuppliersPage = lazy(() => import('./pages/purchases/SuppliersPage'));
const PurchasesPage = lazy(() => import('./pages/purchases/PurchasesPage'));
const ExpensesPage = lazy(() => import('./pages/purchases/ExpensesPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const RentalsPage = lazy(() => import('./pages/RentalsPage'));
const SettingsRouter = lazy(() => import('./pages/settings/SettingsPages'));
const Acc = {
  Overview: lazy(() => import('./pages/accounting/AccountingPages').then((m) => ({ default: m.AccountingOverview }))),
  Accounts: lazy(() => import('./pages/accounting/AccountingPages').then((m) => ({ default: m.AccountsPage }))),
  Statements: lazy(() => import('./pages/accounting/AccountingPages').then((m) => ({ default: m.StatementsPage }))),
  Vat: lazy(() => import('./pages/accounting/AccountingPages').then((m) => ({ default: m.VatPage }))),
  Shifts: lazy(() => import('./pages/accounting/AccountingPages').then((m) => ({ default: m.ShiftsPage }))),
};
const Coupons = lazy(() => import('./pages/MarketingPages').then((m) => ({ default: m.CouponsPage })));
const Offers = lazy(() => import('./pages/MarketingPages').then((m) => ({ default: m.OffersPage })));
const Activity = lazy(() => import('./pages/MiscPages').then((m) => ({ default: m.ActivityPage })));
const Profile = lazy(() => import('./pages/MiscPages').then((m) => ({ default: m.ProfilePage })));

function Guard({ children, perm }: { children: ReactNode; perm?: string[] }) {
  const { me, loading, can } = useAuth();
  if (loading) return <Spinner className="py-40" />;
  if (!me) return <Navigate to="/login" replace />;
  if (perm && !can(...perm)) return <Empty title="لا تملك صلاحية الوصول إلى هذه الصفحة." hint="تواصل مع مالك المتجر لتعديل صلاحياتك." />;
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view', 'reports.view')) return <Dashboard />;
  return <Navigate to={can('pos.use') ? '/pos' : '/products'} replace />;
}

export default function App() {
  const P = (perm: string[], el: ReactNode) => <Guard perm={perm}>{el}</Guard>;
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner className="py-40" />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/pos" element={P(['pos.use'], <PosPage />)} />
          <Route element={<Guard><Layout /></Guard>}>
            <Route index element={<Home />} />
            <Route path="invoices" element={P(['invoices.view', 'pos.use'], <InvoicesPage />)} />
            <Route path="products" element={P(['products.view'], <ProductsPage />)} />
            <Route path="categories" element={P(['products.view'], <CategoriesPage />)} />
            <Route path="inventory/transfers" element={P(['inventory.transfer'], <TransfersPage />)} />
            <Route path="inventory/reorder" element={P(['products.view', 'purchases.manage'], <ReorderPage />)} />
            <Route path="customers" element={P(['customers.view'], <CustomersPage />)} />
            <Route path="suppliers" element={P(['suppliers.manage', 'purchases.manage'], <SuppliersPage />)} />
            <Route path="purchases" element={P(['purchases.manage'], <PurchasesPage />)} />
            <Route path="expenses" element={P(['expenses.manage'], <ExpensesPage />)} />
            <Route path="reports" element={P(['reports.view'], <ReportsPage />)} />
            <Route path="rentals" element={P(['rentals.manage'], <RentalsPage />)} />
            <Route path="accounting" element={P(['accounting.view'], <Acc.Overview />)} />
            <Route path="accounting/accounts" element={P(['accounting.view'], <Acc.Accounts />)} />
            <Route path="accounting/statements" element={P(['accounting.view'], <Acc.Statements />)} />
            <Route path="accounting/vat" element={P(['accounting.view'], <Acc.Vat />)} />
            <Route path="accounting/shifts" element={P(['shifts.manage'], <Acc.Shifts />)} />
            <Route path="marketing" element={<Navigate to="/marketing/coupons" replace />} />
            <Route path="marketing/coupons" element={P(['marketing.manage'], <Coupons />)} />
            <Route path="marketing/offers" element={P(['marketing.manage'], <Offers />)} />
            <Route path="activity" element={P(['reports.view', 'settings.manage'], <Activity />)} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings/:section?" element={P(['settings.manage', 'users.manage'], <SettingsRouter />)} />
            <Route path="*" element={<Empty title="الصفحة غير موجودة." />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
