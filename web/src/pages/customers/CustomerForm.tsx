import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { Button, Input, Select, Toggle, useToast } from '../../components/ui';
import type { Customer } from '../../features/pos/types';

export interface CustomerFull extends Customer {
  email?: string | null; type?: string; gender?: string | null; active?: boolean; crNumber?: string | null; country?: string | null; city?: string | null; district?: string | null;
  street?: string | null; buildingNo?: string | null; additionalNo?: string | null; postalCode?: string | null; shortAddress?: string | null; notes?: string | null;
}

/** نموذج العميل: البيانات الأساسية والضريبية والعنوان الوطني */
export function CustomerForm({ initial, onSaved, onCancel }: { initial?: Partial<CustomerFull>; onSaved: (c: CustomerFull) => void; onCancel: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [v, setV] = useState<Partial<CustomerFull>>({ type: 'INDIVIDUAL', active: true, country: 'SA', ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof CustomerFull) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api<CustomerFull>(initial?.id ? `/customers/${initial.id}` : '/customers', { method: initial?.id ? 'PUT' : 'POST', body: { ...v, gender: v.gender || null } }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['customers'] }); toast.success('تم الحفظ.'); onSaved(c); },
    onError: (e) => { if (e instanceof ApiError && e.errors) setErrors(Object.fromEntries(e.errors.map((x) => [x.path, x.message]))); toast.error(e); },
  });
  const isOrg = v.type !== 'INDIVIDUAL';
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setErrors({}); save.mutate(); }}>
      <fieldset className="space-y-3">
        <legend className="font-bold mb-2">البيانات الأساسية</legend>
        <Input label="الاسم" required value={v.name ?? ''} onChange={set('name')} error={errors.name} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="الجوال (اختياري)" dir="ltr" inputMode="tel" value={v.phone ?? ''} onChange={set('phone')} error={errors.phone} hint="جوال سعودي يبدأ بـ05، أو رقم دولي يبدأ بـ+ ورمز الدولة." />
          <Input label="البريد الإلكتروني (اختياري)" dir="ltr" type="email" value={v.email ?? ''} onChange={set('email')} error={errors.email} />
          <Select label="النوع" value={v.type} onChange={set('type')}><option value="INDIVIDUAL">فرد</option><option value="COMPANY">شركة</option><option value="GOVERNMENT">حكومي</option><option value="NGO">جمعية</option></Select>
          {!isOrg && <Select label="الجنس" value={v.gender ?? ''} onChange={set('gender')}><option value="">—</option><option value="MALE">ذكر</option><option value="FEMALE">أنثى</option></Select>}
        </div>
        <Toggle checked={v.active ?? true} onChange={(a) => setV((s) => ({ ...s, active: a }))} label="العميل مفعّل" />
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-bold mb-2">البيانات الضريبية والتجارية (اختياري)</legend>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="الرقم الضريبي" dir="ltr" inputMode="numeric" maxLength={15} value={v.vatNumber ?? ''} onChange={set('vatNumber')} error={errors.vatNumber} hint="15 رقماً يبدأ وينتهي بالرقم 3." />
          <Input label="السجل التجاري" dir="ltr" value={v.crNumber ?? ''} onChange={set('crNumber')} />
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-bold mb-2">العنوان الوطني (اختياري)</legend>
        <div className="grid sm:grid-cols-3 gap-3">
          <Input label="المدينة" value={v.city ?? ''} onChange={set('city')} />
          <Input label="الحي" value={v.district ?? ''} onChange={set('district')} />
          <Input label="الشارع" value={v.street ?? ''} onChange={set('street')} />
          <Input label="رقم المبنى" dir="ltr" value={v.buildingNo ?? ''} onChange={set('buildingNo')} />
          <Input label="الرقم الإضافي" dir="ltr" value={v.additionalNo ?? ''} onChange={set('additionalNo')} />
          <Input label="الرمز البريدي" dir="ltr" value={v.postalCode ?? ''} onChange={set('postalCode')} />
        </div>
        <Input label="العنوان الوطني المختصر" dir="ltr" placeholder="RRRD2929" value={v.shortAddress ?? ''} onChange={set('shortAddress')} />
      </fieldset>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onCancel}>إلغاء</Button><Button type="submit" loading={save.isPending}>حفظ</Button></div>
    </form>
  );
}
