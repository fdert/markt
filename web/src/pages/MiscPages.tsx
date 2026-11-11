import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Button, Card, Empty, Input, PageHeader, Spinner, useToast } from '../components/ui';

export function ActivityPage() {
  const { data, isLoading } = useQuery({ queryKey: ['activity'], queryFn: () => api<Array<{ id: number; summary: string; user: string | null; createdAt: string; action: string }>>('/activity', { query: { limit: 200 } }) });
  return (
    <>
      <PageHeader title="سجل الأحداث" subtitle="أحداث الإدارة والتغييرات الحساسة" />
      <Card bodyClass="!p-0">{isLoading ? <Spinner /> : !data?.length ? <Empty /> : (
        <ul className="divide-y divide-ink-100">{data.map((a) => <li key={a.id} className="px-5 py-3 flex justify-between gap-4"><span>{a.summary}<span className="block text-xs text-ink-500">{a.user ?? 'النظام'}</span></span><span className="text-sm text-ink-500 whitespace-nowrap">{dateTime(a.createdAt)}</span></li>)}</ul>
      )}</Card>
    </>
  );
}

export function ProfilePage() {
  const { me } = useAuth(); const toast = useToast();
  const [current, setCurrent] = useState(''); const [next, setNext] = useState('');
  const m = useMutation({ mutationFn: () => api('/auth/change-password', { body: { current, next } }), onSuccess: () => { toast.success('تم تحديث كلمة المرور.'); setCurrent(''); setNext(''); }, onError: toast.error });
  return (
    <>
      <PageHeader title="الملف الشخصي" />
      <div className="grid lg:grid-cols-2 gap-5 max-w-4xl">
        <Card title="بياناتي"><dl className="space-y-2"><div><dt className="text-ink-500 text-sm">الاسم</dt><dd>{me?.user.name}</dd></div><div><dt className="text-ink-500 text-sm">البريد الإلكتروني</dt><dd dir="ltr" className="text-end">{me?.user.email}</dd></div></dl></Card>
        <Card title="تغيير كلمة المرور"><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Input label="كلمة المرور الحالية" type="password" dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input label="كلمة المرور الجديدة" type="password" dir="ltr" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} hint="8 أحرف على الأقل." />
          <Button type="submit" loading={m.isPending}>تحديث</Button>
        </form></Card>
      </div>
    </>
  );
}
