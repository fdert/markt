import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Input, useToast } from '../components/ui';

export default function Login() {
  const { login, me } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const { data: status } = useQuery({ queryKey: ['status'], queryFn: () => api<{ initialized: boolean; storeName: string }>('/auth/status') });
  const [f, setF] = useState({ email: '', password: '', storeName: '', ownerName: '', vatNumber: '' });
  const [loading, setLoading] = useState(false);
  if (me) return <Navigate to="/" replace />;
  const setup = status && !status.initialized;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const r = await api<{ token: string }>(setup ? '/auth/setup' : '/auth/login', { body: setup ? f : { email: f.email, password: f.password } });
      login(r.token); nav('/');
    } catch (err) { toast.error(err); } finally { setLoading(false); }
  };
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand-800 text-white p-12">
        <div className="flex items-center gap-3"><img src="/favicon.svg" alt="" className="size-10 rounded-xl ring-2 ring-white/20" /><span className="text-2xl font-extrabold">رصيد</span></div>
        <div>
          <h2 className="text-4xl font-extrabold leading-tight">نقطة بيع ومخزون ومحاسبة<br />في نظام واحد.</h2>
          <p className="mt-4 text-brand-100 text-lg max-w-md">فواتير متوافقة مع الفوترة الإلكترونية، كاشير بقارئ الباركود، وتقارير لحظية لكل فروعك.</p>
        </div>
        <p className="text-brand-200 text-sm">متوافق مع متطلبات هيئة الزكاة والضريبة والجمارك</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h1 className="text-2xl font-extrabold">{setup ? 'إعداد المتجر' : 'تسجيل الدخول'}</h1>
            <p className="text-ink-500 mt-1">{setup ? 'أنشئ حساب المالك وابدأ البيع خلال دقائق.' : `أهلاً بك في ${status?.storeName ?? 'رصيد'}.`}</p>
          </div>
          {setup && <>
            <Input label="اسم المتجر" required {...bind('storeName')} />
            <Input label="اسمك" required {...bind('ownerName')} />
            <Input label="الرقم الضريبي (اختياري)" dir="ltr" inputMode="numeric" maxLength={15} hint="15 رقماً يبدأ وينتهي بالرقم 3." {...bind('vatNumber')} />
          </>}
          <Input label="البريد الإلكتروني" type="email" dir="ltr" autoComplete="username" required {...bind('email')} />
          <Input label="كلمة المرور" type="password" dir="ltr" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 8 : 1} {...bind('password')} />
          <Button type="submit" className="w-full !h-11" loading={loading}>{setup ? 'إنشاء المتجر' : 'دخول'}</Button>
        </form>
      </div>
    </div>
  );
}
