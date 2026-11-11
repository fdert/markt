// الإعدادات: المتجر، الضريبة والفوترة الإلكترونية، قوالب الفواتير، نقطة البيع، الطابعة، الفروع، الموظفون، العملات، الاستيراد
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Store, Receipt, Percent, Building2, Users, Coins, Upload, Printer, ShoppingCart, ArrowRight, Plus, Pencil, Link2, ShieldCheck, Pause, Play, Unplug, Download } from 'lucide-react';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Empty, Input, Modal, NumberInput, PageHeader, Segmented, Select, Spinner, Textarea, Toggle, useToast } from '../../components/ui';
import { PrinterSettingsModal, useSettings, type AllSettings } from '../../features/print/usePrinter';
import { receiptHtml, a4Html, type InvoiceSettings, type PrintableInvoice } from '../../features/print/receipt';

const SECTIONS = [
  { key: 'basic', icon: <Store />, title: 'الإعدادات الأساسية', desc: 'الاسم، الوصف، الشعار، التواصل' },
  { key: 'options', icon: <ShoppingCart />, title: 'خيارات نقطة البيع', desc: 'الخصم، الصلاحية، المخزون، الميزان، الولاء' },
  { key: 'billing', icon: <Receipt />, title: 'الفواتير', desc: 'قوالب الفواتير وبيانات الطباعة' },
  { key: 'tax', icon: <Percent />, title: 'ضريبة القيمة المضافة', desc: 'الضريبة والفوترة الإلكترونية (زاتكا)' },
  { key: 'printer', icon: <Printer />, title: 'الطابعة', desc: 'الطابعة الحرارية، قص الورق، درج النقود' },
  { key: 'branches', icon: <Building2 />, title: 'الفروع والمستودعات', desc: 'إضافة فرع أو مستودع' },
  { key: 'employees', icon: <Users />, title: 'الموظفون', desc: 'إضافة موظفين وإدارة الصلاحيات' },
  { key: 'currency', icon: <Coins />, title: 'العملات', desc: 'عملة المتجر الرئيسية' },
  { key: 'import', icon: <Upload />, title: 'استيراد البيانات', desc: 'منتجات أو عملاء من Excel أو CSV' },
];

export default function SettingsRouter() {
  const { section } = useParams();
  if (!section) return <SettingsHub />;
  const map: Record<string, ReactNode> = { basic: <BasicSettings />, options: <PosOptions />, billing: <BillingSettings />, tax: <TaxSettings />, printer: <PrinterPage />, branches: <BranchesPage />, employees: <EmployeesPage />, currency: <CurrencySettings />, import: <ImportPage /> };
  const s = SECTIONS.find((x) => x.key === section);
  return (
    <>
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-brand-700 mb-2"><ArrowRight className="size-4" />رجوع للإعدادات</Link>
      <PageHeader title={s?.title ?? 'الإعدادات'} subtitle={s?.desc} />
      {map[section] ?? <Empty title="الصفحة غير موجودة" />}
    </>
  );
}

function SettingsHub() {
  return (
    <>
      <PageHeader title="الإعدادات" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{SECTIONS.map((s) => (
        <Link key={s.key} to={`/settings/${s.key}`} className="card p-5 flex gap-4 hover:border-brand-400 transition [&>svg]:size-6 [&>svg]:text-brand-700 [&>svg]:shrink-0">{s.icon}<span><b>{s.title}</b><span className="block text-sm text-ink-500 mt-0.5">{s.desc}</span></span></Link>
      ))}</div>
    </>
  );
}

/** حفظ مفتاح من الإعدادات */
function useSave<K extends keyof AllSettings>(key: K) {
  const qc = useQueryClient(); const toast = useToast();
  return useMutation({ mutationFn: (v: Partial<AllSettings[K]>) => api(`/settings/${key}`, { method: 'PUT', body: v }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['me'] }); toast.success('تم الحفظ.'); }, onError: toast.error });
}
function useDraft<T>(src: T | undefined) {
  const [v, setV] = useState<T | undefined>(src);
  useEffect(() => { if (src) setV(src); }, [src]);
  return [v, setV] as const;
}
const readImage = (file: File, cb: (url: string) => void, onErr: (e: string) => void) => {
  if (file.size > 1_500_000) return onErr('حجم الصورة أكبر من 1.5 ميجابايت.');
  const r = new FileReader(); r.onload = () => cb(String(r.result)); r.readAsDataURL(file);
};

function BasicSettings() {
  const { data } = useSettings(); const save = useSave('store'); const toast = useToast();
  const [v, setV] = useDraft(data?.store as Record<string, string> | undefined);
  if (!v) return <Spinner />;
  const b = (k: string) => ({ value: v[k] ?? '', onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  return (
    <Card>
      <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
        <Input label="اسم المتجر" required {...b('name')} /><Input label="اسم المتجر بالإنجليزية (اختياري)" dir="ltr" {...b('nameEn')} />
        <div className="sm:col-span-2"><Textarea label="نبذة عن المتجر" maxLength={400} {...b('description')} /></div>
        <Input label="رقم السجل التجاري" dir="ltr" {...b('crNumber')} /><Input label="الهاتف" dir="ltr" {...b('phone')} />
        <Input label="البريد الإلكتروني" dir="ltr" {...b('email')} /><Input label="المدينة" {...b('city')} />
        <Input label="الحي" {...b('district')} /><Input label="الشارع" {...b('street')} />
        <Input label="رقم المبنى" dir="ltr" {...b('buildingNo')} /><Input label="الرمز البريدي" dir="ltr" {...b('postalCode')} />
        <div className="sm:col-span-2"><span className="label">شعار المتجر</span>
          <div className="flex items-center gap-4">{v.logo ? <img src={v.logo} alt="الشعار" className="h-16 max-w-[200px] object-contain border border-ink-200 rounded-lg p-1" /> : <span className="text-ink-500 text-sm">لا يوجد</span>}
            <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="رفع الشعار" onChange={(e) => e.target.files?.[0] && readImage(e.target.files[0], (url) => setV({ ...v, logo: url }), toast.error)} />
            {v.logo && <Button size="sm" variant="ghost" onClick={() => setV({ ...v, logo: '' })}>حذف</Button>}</div>
          <p className="text-[13px] text-ink-500 mt-1">المقاس المثالي 1024×256 بكسل — يظهر في الفواتير والإيصالات.</p></div>
      </div>
      <div className="mt-5"><Button loading={save.isPending} onClick={() => save.mutate(v)}>حفظ التغييرات</Button></div>
    </Card>
  );
}

type PosOpts = { requireCustomer: boolean; allowManualDiscount: boolean; maxDiscountPercent: number; allowCoupons: boolean; allowExpiredSale: boolean; expiryWarningDays: number; defaultLowStock: number; allowNegativeStock: boolean;
  weightBarcode: { enabled: boolean; prefixes: string[]; itemCodeLength: number; valueLength: number; valueType: 'WEIGHT' | 'PRICE'; divisor: number }; loyalty: { enabled: boolean; pointsPerRiyal: number; riyalPerPoint: number; minRedeem: number } };
function PosOptions() {
  const { data } = useSettings(); const save = useSave('pos');
  const [v, setV] = useDraft(data?.pos as unknown as PosOpts | undefined);
  if (!v) return <Spinner />;
  const set = <K extends keyof PosOpts>(k: K, val: PosOpts[K]) => setV({ ...v, [k]: val });
  return (
    <div className="space-y-5 max-w-3xl">
      <Card title="سلوك الكاشير عند إصدار الفاتورة">
        <Toggle checked={v.requireCustomer} onChange={(x) => set('requireCustomer', x)} label="يتطلب بيانات العميل قبل إصدار الفاتورة" hint="الكاشير لا يستطيع إتمام الفاتورة قبل اختيار عميل." />
        <Toggle checked={v.allowManualDiscount} onChange={(x) => set('allowManualDiscount', x)} label="السماح بالخصم اليدوي" hint="يستطيع الكاشير إضافة خصم يدوي بمبلغ أو نسبة." />
        <div className="max-w-xs my-2"><NumberInput label="الحد الأقصى للخصم اليدوي" suffix="%" value={v.maxDiscountPercent} onChange={(x) => set('maxDiscountPercent', x ?? 0)} hint="أعلى نسبة يستطيع أي مستخدم خصمها، بما فيه المالك. الخصم بالمبلغ يخضع للحد نفسه." /></div>
        <Toggle checked={v.allowCoupons} onChange={(x) => set('allowCoupons', x)} label="السماح بالكوبونات في نقطة البيع" />
      </Card>
      <Card title="صلاحية المنتجات">
        <Toggle checked={v.allowExpiredSale} onChange={(x) => set('allowExpiredSale', x)} label="السماح ببيع منتج منتهي الصلاحية" hint="معطّل = منع البيع نهائياً (الافتراضي والأأمن)." />
        <div className="max-w-xs mt-2"><NumberInput label="التنبيه قبل انتهاء الصلاحية" suffix="يوم" value={v.expiryWarningDays} onChange={(x) => set('expiryWarningDays', x ?? 0)} /></div>
      </Card>
      <Card title="المخزون">
        <div className="max-w-xs mb-2"><NumberInput label="حد التنبيه الافتراضي لنقص المخزون" suffix="وحدة" value={v.defaultLowStock} onChange={(x) => set('defaultLowStock', x ?? 0)} hint="0 = التنبيه معطّل. حد المنتج يتجاوز هذا الحد." /></div>
        <Toggle checked={v.allowNegativeStock} onChange={(x) => set('allowNegativeStock', x)} label="السماح بالبيع عند نفاد الكمية" hint="مفيد قبل الجرد الافتتاحي. أوقفه لمنع البيع بأكثر من المتاح." />
      </Card>
      <Card title="باركود الميزان">
        <Toggle checked={v.weightBarcode.enabled} onChange={(x) => set('weightBarcode', { ...v.weightBarcode, enabled: x })} label="قراءة باركود الميزان (EAN-13)" hint="الصيغة: بادئة + رمز الصنف + الوزن أو السعر + رقم تحقق. مثال: 20 10001 01250 3 = 1.250 كجم من الصنف 10001." />
        {v.weightBarcode.enabled && <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <Input label="البادئات" dir="ltr" value={v.weightBarcode.prefixes.join(',')} onChange={(e) => set('weightBarcode', { ...v.weightBarcode, prefixes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} hint="مفصولة بفواصل، مثل: 20,21,22" />
          <Select label="القيمة المضمّنة" value={v.weightBarcode.valueType} onChange={(e) => set('weightBarcode', { ...v.weightBarcode, valueType: e.target.value as 'WEIGHT' })}><option value="WEIGHT">الوزن (بالجرام)</option><option value="PRICE">السعر (بالهللة)</option></Select>
          <NumberInput label="طول رمز الصنف" value={v.weightBarcode.itemCodeLength} onChange={(x) => set('weightBarcode', { ...v.weightBarcode, itemCodeLength: x ?? 5 })} />
          <NumberInput label="القسمة على" value={v.weightBarcode.divisor} onChange={(x) => set('weightBarcode', { ...v.weightBarcode, divisor: x ?? 1000 })} hint="1000 للجرام←كجم، 100 للهللة←ريال" />
        </div>}
      </Card>
      <Card title="نظام الولاء">
        <Toggle checked={v.loyalty.enabled} onChange={(x) => set('loyalty', { ...v.loyalty, enabled: x })} label="تفعيل نقاط الولاء" />
        {v.loyalty.enabled && <div className="grid sm:grid-cols-3 gap-3 mt-2">
          <NumberInput label="نقاط لكل ريال" value={v.loyalty.pointsPerRiyal} onChange={(x) => set('loyalty', { ...v.loyalty, pointsPerRiyal: x ?? 1 })} />
          <NumberInput label="قيمة النقطة (ريال)" value={v.loyalty.riyalPerPoint} onChange={(x) => set('loyalty', { ...v.loyalty, riyalPerPoint: x ?? 0.05 })} />
          <NumberInput label="الحد الأدنى للاستبدال" value={v.loyalty.minRedeem} onChange={(x) => set('loyalty', { ...v.loyalty, minRedeem: x ?? 0 })} />
        </div>}
      </Card>
      <Button loading={save.isPending} onClick={() => save.mutate(v as never)}>حفظ التغييرات</Button>
    </div>
  );
}

const INV_GROUPS: Array<[string, Array<[keyof InvoiceSettings, string]>]> = [
  ['بيانات المتجر', [['showStoreName', 'اسم المتجر'], ['showCr', 'السجل التجاري'], ['showVatNumber', 'الرقم الضريبي'], ['showLogo', 'الشعار']]],
  ['الموظف والطلب', [['showEmployee', 'بيانات الموظف'], ['showOrderNo', 'رقم الطلب'], ['showPaymentMethod', 'طريقة الدفع']]],
  ['بيانات العميل', [['showCustomer', 'اسم العميل'], ['showCustomerPhone', 'رقم هاتف العميل'], ['showCustomerVat', 'الرقم الضريبي للعميل'], ['showCustomerAddress', 'عنوان العميل']]],
  ['الفرع', [['showBranch', 'الفرع'], ['showBranchAddress', 'عنوان الفرع'], ['showBranchPhone', 'هاتف الفرع']]],
  ['بنود المنتجات', [['showLineNumbers', 'ترقيم البنود'], ['showSku', 'رقم الصنف'], ['showUnit', 'نوع الوحدة'], ['showBarcode', 'الباركود']]],
  ['الأسعار والضريبة', [['showItemDiscount', 'خصم البند'], ['showSubtotal', 'الإجمالي قبل الضريبة'], ['showTaxRate', 'نسبة الضريبة'], ['showTaxAmount', 'مبلغ الضريبة']]],
  ['إضافات', [['showNotes', 'إظهار الملاحظات'], ['showFooter', 'إظهار التذييل'], ['showSignature', 'التوقيع'], ['showStamp', 'الختم']]],
];
function BillingSettings() {
  const { data } = useSettings(); const save = useSave('invoice'); const toast = useToast();
  const [v, setV] = useDraft(data?.invoice);
  const [tpl, setTpl] = useState<'RECEIPT' | 'A4'>('RECEIPT'); const [html, setHtml] = useState('');
  useEffect(() => {
    if (!v || !data) return;
    const sample: PrintableInvoice = { id: 0, number: 'INV-1-000123', kind: 'SIMPLIFIED', type: 'INVOICE', status: 'PAID', createdAt: new Date().toISOString(), subtotal: 26.09, discount: 0, taxTotal: 3.91, total: 30, paid: 30, due: 0, qrCode: 'AQ3Zhdiq2KzYsSDYsdi12YrYrw==', notes: null,
      items: [{ name: 'حليب طازج 1 لتر', barcode: '6281007000011', qty: 2, unitPrice: 6.5217, discount: 0, taxRate: 15, taxAmount: 1.96, netAmount: 13.04, total: 15, unitName: 'حبة' }, { name: 'خبز أبيض شرائح', qty: 3, unitPrice: 4.3478, discount: 0, taxRate: 15, taxAmount: 1.95, netAmount: 13.05, total: 15, unitName: 'حبة' }],
      payments: [{ method: 'CASH', amount: 30 }], user: { name: 'الكاشير' }, branch: { name: 'الفرع الرئيسي', city: 'الرياض' }, customer: null };
    const store = { ...data.store, vatNumber: data.tax.vatNumber };
    (tpl === 'RECEIPT' ? receiptHtml(sample, v, store, 80) : a4Html(sample, v, store)).then(setHtml);
  }, [v, tpl, data]);
  if (!v) return <Spinner />;
  const img = (k: 'signature' | 'stamp', label: string) => (
    <div><span className="label">{label}</span><div className="flex items-center gap-3">{v[k] ? <img src={v[k]} alt="" className="h-12 border rounded" /> : <span className="text-sm text-ink-500">لا يوجد</span>}<input type="file" accept="image/*" aria-label={label} onChange={(e) => e.target.files?.[0] && readImage(e.target.files[0], (url) => setV({ ...v, [k]: url }), toast.error)} /></div></div>
  );
  return (
    <div className="grid xl:grid-cols-2 gap-5">
      <div className="space-y-4">
        {INV_GROUPS.map(([g, items]) => <Card key={g} title={g}><div className="grid sm:grid-cols-2 gap-2">{items.map(([k, l]) => <Checkbox key={k} checked={!!v[k]} onChange={(x) => setV({ ...v, [k]: x })} label={l} />)}</div></Card>)}
        <Card title="نصوص القالب والتوقيع"><div className="space-y-3">
          <Textarea label="نصّ الملاحظات" value={v.notesText} onChange={(e) => setV({ ...v, notesText: e.target.value })} />
          <Input label="نصّ التذييل" value={v.footerText} onChange={(e) => setV({ ...v, footerText: e.target.value })} />
          {img('signature', 'التوقيع')}{img('stamp', 'الختم')}
        </div></Card>
        <Button loading={save.isPending} onClick={() => save.mutate(v)}>حفظ التغييرات</Button>
      </div>
      <Card title="معاينة ما يراه العميل" actions={<Segmented value={tpl} onChange={setTpl} items={[{ value: 'RECEIPT', label: 'إيصال 80مم' }, { value: 'A4', label: 'A4' }]} />}>
        <iframe title="معاينة الفاتورة" srcDoc={html} className="w-full h-[640px] border border-ink-200 rounded-lg bg-white" />
      </Card>
    </div>
  );
}

interface Branch { id: number; name: string; nameEn: string | null; type: string; isDefault: boolean; phone: string | null; city: string | null; district: string | null; street: string | null; buildingNo: string | null; additionalNo: string | null; postalCode: string | null; crNumber: string | null; active: boolean; zatcaEnabled: boolean; zatcaPaused: boolean; zatcaLinked: boolean; zatcaCompliance: boolean; zatcaEnv: string; icvCounter: number }

function TaxSettings() {
  const { data } = useSettings(); const save = useSave('tax'); const qc = useQueryClient(); const toast = useToast();
  const [v, setV] = useDraft(data?.tax as (AllSettings['tax'] & { taxOnShipping: boolean }) | undefined);
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const [link, setLink] = useState<Branch | null>(null); const [otp, setOtp] = useState(''); const [env, setEnv] = useState('sandbox');
  const [results, setResults] = useState<Array<{ case: string; status: number; body: unknown }> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['branches'] });
  const onboard = useMutation({ mutationFn: () => api(`/branches/${link!.id}/zatca/onboard`, { body: { otp, env } }), onSuccess: () => { refresh(); toast.success('تم استلام شهادة الامتثال.'); }, onError: toast.error });
  const compliance = useMutation({ mutationFn: (id: number) => api<{ results: Array<{ case: string; status: number; body: unknown }> }>(`/branches/${id}/zatca/compliance`, { body: {} }), onSuccess: (r) => setResults(r.results), onError: toast.error });
  const production = useMutation({ mutationFn: (id: number) => api(`/branches/${id}/zatca/production`, { body: {} }), onSuccess: () => { refresh(); setLink(null); toast.success('تم ربط الفرع بالمرحلة الثانية.'); }, onError: toast.error });
  const pause = useMutation({ mutationFn: (b: Branch) => api(`/branches/${b.id}/zatca/pause`, { body: { paused: !b.zatcaPaused } }), onSuccess: refresh, onError: toast.error });
  const unlink = useMutation({ mutationFn: (b: Branch) => api(`/branches/${b.id}/zatca/unlink`, { body: {} }), onSuccess: refresh, onError: toast.error });
  if (!v) return <Spinner />;
  return (
    <div className="space-y-5 max-w-4xl">
      <Card title="ضريبة القيمة المضافة" actions={<span className="text-sm text-ink-500">تُطبَّق على الفواتير الجديدة فور الحفظ</span>}>
        <Toggle checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label="تفعيل ضريبة القيمة المضافة على المبيعات" hint="عند الإيقاف تصدر الفواتير بضريبة صفر، ويتوقف رمز QR وتوقيع الفوترة الإلكترونية." />
        <Toggle checked={v.taxOnShipping} onChange={(x) => setV({ ...v, taxOnShipping: x })} label="احتساب الضريبة على خدمات الشحن" />
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <NumberInput label="نسبة الضريبة" suffix="%" value={v.rate} onChange={(x) => setV({ ...v, rate: x ?? 15 })} required />
          <Input label="الرقم الضريبي" dir="ltr" maxLength={15} required value={v.vatNumber} onChange={(e) => setV({ ...v, vatNumber: e.target.value.replace(/\D/g, '') })} hint="15 رقماً كما هو مسجَّل في هيئة الزكاة والضريبة والجمارك." />
        </div>
        <div className="mt-4"><Button loading={save.isPending} onClick={() => save.mutate(v)}>حفظ التغييرات</Button></div>
      </Card>
      <Card title="الفاتورة الإلكترونية (المرحلة الثانية)">
        <div className="rounded-xl bg-brand-50 p-4 text-[14px] text-brand-900 mb-4">فواتيرك تحمل رمز QR للمرحلة الأولى ولا تحتاج ربطاً. اربط الفروع عند الانتقال للمرحلة الثانية (الفوترة الموقّعة): لكل فرع وحدة إصدار (EGS) بشهادة توقيع وسلسلة عدّاد فواتير (ICV) مستقلة.</div>
        {!branches?.length ? <Empty title="لا توجد فروع لهذا المتجر." /> : (
          <table className="table w-full"><thead><tr><th>الفرع</th><th>الحالة</th><th>العدّاد</th><th /></tr></thead>
            <tbody>{branches.filter((b) => b.type === 'BRANCH').map((b) => (
              <tr key={b.id}><td>{b.name}<span className="block text-xs text-ink-500">{b.zatcaEnv === 'production' ? 'الإنتاج' : b.zatcaEnv === 'simulation' ? 'المحاكاة' : 'بيئة المطورين'}</span></td>
                <td>{b.zatcaLinked ? (b.zatcaPaused ? <Badge tone="amber">التوقيع موقوف</Badge> : <Badge tone="green">مربوط</Badge>) : b.zatcaCompliance ? <Badge tone="blue">بانتظار الامتثال</Badge> : <Badge>المرحلة الأولى</Badge>}</td>
                <td className="num">{b.icvCounter}</td>
                <td className="whitespace-nowrap space-x-1 space-x-reverse">
                  {!b.zatcaLinked && <Button size="sm" onClick={() => { setLink(b); setOtp(''); setResults(null); }}><Link2 className="size-4" />ربط</Button>}
                  {b.zatcaLinked && <Button size="sm" variant="secondary" onClick={() => pause.mutate(b)}>{b.zatcaPaused ? <><Play className="size-4" />استئناف</> : <><Pause className="size-4" />إيقاف مؤقت</>}</Button>}
                  {(b.zatcaLinked || b.zatcaCompliance) && <Button size="sm" variant="ghost" onClick={() => unlink.mutate(b)}><Unplug className="size-4" />فصل</Button>}
                </td></tr>
            ))}</tbody></table>
        )}
        <details className="mt-4 text-[14px] text-ink-600"><summary className="cursor-pointer font-medium text-ink-800">كيف يعمل الربط؟</summary>
          <ol className="list-decimal ps-5 mt-2 space-y-1"><li>استخرج رمز التحقق (OTP) من بوابة فاتورة لكل فرع — صلاحيته دقائق معدودة.</li><li>أدخل الرمز هنا فيُنشأ مفتاح التوقيع وطلب الشهادة (CSR) وتُطلب شهادة الامتثال.</li><li>شغّل فحص الامتثال لإرسال فواتير نموذجية موقعة.</li><li>اطلب شهادة الإنتاج، فتوقَّع كل فاتورة وتُرسل للهيئة فور إصدارها مع إعادة محاولة تلقائية.</li></ol>
          <p className="mt-2">إيقاف التوقيع يوقف المرحلة الثانية مؤقتاً مع بقاء الشهادة. فصل الفرع يحذف الشهادة ومفتاح التوقيع، ويُمنع ما دامت هناك فواتير بانتظار الإبلاغ.</p>
        </details>
      </Card>
      <Modal open={!!link} onClose={() => setLink(null)} title={`ربط ${link?.name ?? ''} بالفاتورة الإلكترونية`} size="md">
        {link && <div className="space-y-4">
          <section className="space-y-3"><h3 className="font-bold">1. رمز التحقق</h3>
            <Select label="البيئة" value={env} onChange={(e) => setEnv(e.target.value)}><option value="sandbox">بيئة المطورين (تجريبية)</option><option value="simulation">المحاكاة</option><option value="production">الإنتاج</option></Select>
            <div className="flex gap-2 items-end"><Input label="رمز التحقق (OTP)" dir="ltr" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="flex-1" /><Button loading={onboard.isPending} disabled={otp.length !== 6} onClick={() => onboard.mutate()}>طلب شهادة الامتثال</Button></div>
            <a className="text-sm text-brand-700 underline" href="https://fatoora.zatca.gov.sa/" target="_blank" rel="noopener noreferrer">بوابة فاتورة ↗</a>
          </section>
          <section className="space-y-2"><h3 className="font-bold">2. فحص الامتثال</h3><Button variant="secondary" loading={compliance.isPending} onClick={() => compliance.mutate(link.id)}><ShieldCheck className="size-4" />إرسال الفواتير النموذجية</Button>
            {results && <ul className="text-sm space-y-1">{results.map((r) => <li key={r.case} className="flex justify-between"><span dir="ltr">{r.case}</span>{r.status < 300 ? <Badge tone="green">مقبولة</Badge> : <Badge tone="red">مرفوضة ({r.status})</Badge>}</li>)}</ul>}</section>
          <section className="space-y-2"><h3 className="font-bold">3. شهادة الإنتاج</h3><Button loading={production.isPending} onClick={() => production.mutate(link.id)}>إكمال الربط</Button></section>
        </div>}
      </Modal>
    </div>
  );
}

function PrinterPage() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-5 max-w-3xl">
      <Card title="طابعة هذا الجهاز">
        <p className="text-ink-600 mb-4">تُحفظ إعدادات الطباعة لكل جهاز ومتصفح على حدة: طريقة الطباعة، عرض الورق (80 أو 58 مم)، قص الورق، فتح درج النقود، والطباعة التلقائية.</p>
        <Button onClick={() => setOpen(true)}><Printer className="size-4" />فتح إعدادات الطباعة</Button>
      </Card>
      <Card title="طرق الطباعة المدعومة">
        <ul className="space-y-3 text-[14px]">
          <li><b>عبر المتصفح:</b> تعمل مع أي طابعة معرّفة في النظام. اضبط حجم الورق في نافذة الطباعة على عرض الإيصال، وألغِ الهوامش.</li>
          <li><b>مباشرة عبر USB:</b> من Chrome أو Edge دون نافذة طباعة، مع قص الورق وفتح الدرج (أوامر ESC/POS). على Windows قد تحتاج تعريف WinUSB عبر أداة Zadig.</li>
          <li><b>المنفذ التسلسلي / بلوتوث:</b> للطابعات التي تظهر كمنفذ COM.</li>
          <li><b>مساعد الطباعة المحلي:</b> برنامج صغير يعمل على جهاز الكاشير ويطبع على أي طابعة Windows أو طابعة شبكة (IP:9100) — يدعم القص والدرج.</li>
        </ul>
        <p className="text-[13px] text-ink-500 mt-3">تُرسَم الفاتورة صورةً نقطية قبل إرسالها للطابعة الحرارية، فتظهر العربية بشكل صحيح على أي طابعة ESC/POS دون الحاجة لجداول ترميز عربية.</p>
      </Card>
      <PrinterSettingsModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function BranchesPage() {
  const qc = useQueryClient(); const toast = useToast();
  const { data } = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const [edit, setEdit] = useState<Partial<Branch> | null>(null);
  const save = useMutation({ mutationFn: () => api(edit!.id ? `/branches/${edit!.id}` : '/branches', { method: edit!.id ? 'PUT' : 'POST', body: { name: edit!.name, nameEn: edit!.nameEn || null, type: edit!.type ?? 'BRANCH', phone: edit!.phone || null, city: edit!.city || null, district: edit!.district || null, street: edit!.street || null, buildingNo: edit!.buildingNo || '', additionalNo: edit!.additionalNo || null, postalCode: edit!.postalCode || '', crNumber: edit!.crNumber || null, active: edit!.active ?? true } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['branches'] }); qc.invalidateQueries({ queryKey: ['me'] }); setEdit(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const b = (k: keyof Branch) => ({ value: (edit?.[k] as string) ?? '', onChange: (e: { target: { value: string } }) => setEdit({ ...edit, [k]: e.target.value }) });
  return (
    <>
      <div className="mb-4"><Button onClick={() => setEdit({ type: 'BRANCH', active: true })}><Plus className="size-4" />إضافة فرع أو مستودع جديد</Button></div>
      <Card bodyClass="!p-0">{!data ? <Spinner /> : !data.length ? <Empty title="لا توجد فروع بعد." /> : (
        <table className="table w-full"><thead><tr><th>الفرع</th><th>النوع</th><th>المدينة</th><th>الهاتف</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.map((x) => <tr key={x.id}><td className="font-medium">{x.name} {x.isDefault && <Badge tone="brand">افتراضي</Badge>}</td><td>{x.type === 'WAREHOUSE' ? 'مستودع' : 'فرع بيع'}</td><td>{x.city ?? '—'}</td><td className="num">{x.phone ?? '—'}</td><td>{x.active ? <Badge tone="green">نشط</Badge> : <Badge>غير نشط</Badge>}</td><td><Button size="sm" variant="ghost" aria-label="تعديل" onClick={() => setEdit(x)}><Pencil className="size-4" /></Button></td></tr>)}</tbody></table>
      )}</Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل الفرع' : 'فرع جديد'} size="lg" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>حفظ التغييرات</Button>}>
        {edit && <div className="grid sm:grid-cols-2 gap-3">
          <Input label="اسم الفرع" required {...b('name')} /><Input label="الاسم بالإنجليزية" dir="ltr" {...b('nameEn')} />
          <Select label="النوع" {...b('type')}><option value="BRANCH">فرع بيع</option><option value="WAREHOUSE">مستودع (للتخزين لا للبيع)</option></Select><Input label="الهاتف" dir="ltr" {...b('phone')} />
          <Input label="المدينة" {...b('city')} /><Input label="الحي" {...b('district')} /><Input label="الشارع" {...b('street')} /><Input label="رقم المبنى (4 أرقام)" dir="ltr" {...b('buildingNo')} />
          <Input label="الرقم الإضافي" dir="ltr" {...b('additionalNo')} /><Input label="الرمز البريدي (5 أرقام)" dir="ltr" {...b('postalCode')} /><Input label="السجل التجاري للفرع" dir="ltr" {...b('crNumber')} />
          <div className="flex items-end"><Toggle checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="الفرع نشط" /></div>
        </div>}
      </Modal>
    </>
  );
}

interface Emp { id: number; name: string; email: string; phone: string | null; role: string; permissions: string[]; effectivePermissions: string[]; maxDiscount: number | null; active: boolean; branchId: number | null }
function EmployeesPage() {
  const { me } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const { data } = useQuery({ queryKey: ['users'], queryFn: () => api<Emp[]>('/users') });
  const { data: meta } = useQuery({ queryKey: ['users-meta'], queryFn: () => api<{ permissions: Record<string, string>; roles: Record<string, string>; presets: Record<string, string[]> }>('/users/meta') });
  const [edit, setEdit] = useState<(Partial<Emp> & { password?: string; pin?: string }) | null>(null);
  const save = useMutation({ mutationFn: () => api(edit!.id ? `/users/${edit!.id}` : '/users', { method: edit!.id ? 'PUT' : 'POST', body: { name: edit!.name, email: edit!.email, phone: edit!.phone || null, role: edit!.role, permissions: edit!.permissions ?? [], maxDiscount: edit!.maxDiscount ?? null, branchId: edit!.branchId ?? null, active: edit!.active ?? true, password: edit!.password || undefined, pin: edit!.pin ?? undefined } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEdit(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const perms = edit ? (edit.permissions?.length ? edit.permissions : meta?.presets[edit.role ?? 'CASHIER'] ?? []) : [];
  return (
    <>
      <div className="mb-4 flex items-center justify-between"><p className="text-ink-600">أعضاء متجرك وصلاحياتهم. الصلاحية تُفحص في الخادم عند كل طلب.</p><Button onClick={() => setEdit({ role: 'CASHIER', active: true, branchId: me?.branches[0]?.id })}><Plus className="size-4" />إضافة موظف</Button></div>
      <Card bodyClass="!p-0">{!data ? <Spinner /> : (
        <table className="table w-full"><thead><tr><th>العضو</th><th>الفرع</th><th>الدور</th><th>حد الخصم</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.map((u) => <tr key={u.id}><td><b>{u.name}</b><span className="block text-sm text-ink-500" dir="ltr">{u.email}</span></td><td>{me?.branches.find((b) => b.id === u.branchId)?.name ?? 'بلا فرع'}</td><td>{meta?.roles[u.role]}</td><td className="num">{u.maxDiscount != null ? `${u.maxDiscount}%` : '—'}</td><td>{u.active ? <Badge tone="green">نشط</Badge> : <Badge tone="red">موقوف</Badge>}</td><td>{u.role !== 'OWNER' && <Button size="sm" variant="ghost" aria-label="تعديل" onClick={() => setEdit({ ...u, permissions: u.permissions })}><Pencil className="size-4" /></Button>}</td></tr>)}</tbody></table>
      )}</Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل الموظف' : 'إضافة موظف'} size="lg" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>حفظ التغييرات</Button>}>
        {edit && meta && <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="الاسم" required value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Input label="البريد الإلكتروني" dir="ltr" type="email" required value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            <Input label={edit.id ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'} type="password" dir="ltr" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} hint="8 أحرف على الأقل." />
            <Input label="الرمز السري للكاشير (اختياري)" dir="ltr" inputMode="numeric" maxLength={6} value={edit.pin ?? ''} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })} />
            <Select label="الدور" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value, permissions: [] })}>{Object.entries(meta.roles).filter(([k]) => k !== 'OWNER').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Select label="الفرع" value={edit.branchId ?? ''} onChange={(e) => setEdit({ ...edit, branchId: e.target.value ? Number(e.target.value) : null })}><option value="">بلا فرع</option>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            <NumberInput label="الحد الأقصى للخصم" suffix="%" value={edit.maxDiscount ?? null} onChange={(v) => setEdit({ ...edit, maxDiscount: v })} />
            <div className="flex items-end"><Toggle checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="الحساب نشط" /></div>
          </div>
          <fieldset><legend className="font-bold mb-2">الصلاحيات</legend>
            <p className="text-sm text-ink-500 mb-2">تبدأ من صلاحيات الدور، ويمكنك تخصيصها.</p>
            <div className="grid sm:grid-cols-2 gap-2">{Object.entries(meta.permissions).map(([k, l]) => <Checkbox key={k} checked={perms.includes(k)} onChange={(v) => setEdit({ ...edit, permissions: v ? [...perms, k] : perms.filter((p) => p !== k) })} label={l} />)}</div>
          </fieldset>
        </div>}
      </Modal>
    </>
  );
}

function CurrencySettings() {
  const { data } = useSettings(); const save = useSave('store');
  const [v, setV] = useDraft(data?.store as Record<string, string> | undefined);
  if (!v) return <Spinner />;
  return (
    <Card><div className="grid sm:grid-cols-3 gap-3 max-w-3xl">
      <Select label="عملة المتجر الرئيسية" value={v.currencyCode} onChange={(e) => setV({ ...v, currencyCode: e.target.value })}><option value="SAR">ريال سعودي (SAR)</option></Select>
      <Input label="اسم العملة" value={v.currencyName} onChange={(e) => setV({ ...v, currencyName: e.target.value })} />
      <Input label="رمز العملة" value={v.currencySymbol} onChange={(e) => setV({ ...v, currencySymbol: e.target.value })} hint="الرمز للعرض فقط." />
    </div>
    <p className="text-sm text-ink-500 mt-3">معاينة: <span className="num">{money(1234.56)}</span> {v.currencySymbol}. الفوترة الإلكترونية وبوابات الدفع تستخدم SAR دائماً.</p>
    <div className="mt-4"><Button loading={save.isPending} onClick={() => save.mutate(v)}>حفظ</Button></div></Card>
  );
}

function ImportPage() {
  const { branchId } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const [type, setType] = useState<'products' | 'customers'>('products');
  const [preview, setPreview] = useState<{ rows: Array<Record<string, string> & { line: number; errors: string[] }>; valid: number; invalid: number } | null>(null);
  const [done, setDone] = useState<{ added: number; updated: number; skipped: number } | null>(null);
  const upload = (file: File) => {
    const r = new FileReader();
    r.onload = async () => { try { setPreview(await api('/import/preview', { body: { type, file: r.result, filename: file.name } })); setDone(null); } catch (e) { toast.error(e); } };
    r.readAsDataURL(file);
  };
  const commit = useMutation({ mutationFn: () => api<{ added: number; updated: number; skipped: number }>('/import/commit', { body: { type, branchId, rows: preview!.rows.filter((x) => !x.errors.length) } }), onSuccess: (r) => { setDone(r); setPreview(null); qc.invalidateQueries(); }, onError: toast.error });
  const cols = type === 'products' ? ['name', 'barcode', 'price', 'cost', 'qty', 'category'] : ['name', 'phone', 'email', 'city', 'vatNumber'];
  const LBL: Record<string, string> = { name: 'الاسم', barcode: 'الباركود', price: 'السعر', cost: 'التكلفة', qty: 'الكمية', category: 'التصنيف', phone: 'الجوال', email: 'البريد', city: 'المدينة', vatNumber: 'الرقم الضريبي' };
  return (
    <div className="space-y-5 max-w-5xl">
      <Card title="1. ماذا تريد أن تستورد؟"><Segmented value={type} onChange={(v) => { setType(v); setPreview(null); }} items={[{ value: 'products', label: 'المنتجات' }, { value: 'customers', label: 'العملاء' }]} />
        <p className="text-sm text-ink-500 mt-2">{type === 'products' ? 'الاسم والسعر والكمية والتصنيف والباركود.' : 'الاسم والجوال والبريد والمدينة والبيانات الضريبية.'}</p></Card>
      <Card title="2. ارفع الملف">
        <p className="text-sm text-ink-600 mb-3">حمّل النموذج، املأه ببياناتك، ثم ارفعه هنا. أو ارفع ملفك الحالي مباشرة — نطابق الأعمدة تلقائياً.</p>
        <div className="flex flex-wrap gap-3 items-center"><Button variant="secondary" onClick={() => download(`/import/template/${type}`, `${type}-template.xlsx`).catch(toast.error)}><Download className="size-4" />تحميل النموذج الجاهز</Button>
          <input type="file" accept=".xlsx,.csv" aria-label="ملف الاستيراد" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></div>
      </Card>
      {preview && <Card title="3. راجِع وصحّح" actions={<span className="text-sm"><Badge tone="green">جاهز: {preview.valid}</Badge> <Badge tone="red">خطأ: {preview.invalid}</Badge></span>}>
        <div className="overflow-x-auto max-h-96"><table className="table w-full"><thead><tr><th>السطر</th>{cols.map((c) => <th key={c}>{LBL[c]}</th>)}<th>الحالة</th></tr></thead>
          <tbody>{preview.rows.map((r) => <tr key={r.line} className={r.errors.length ? 'bg-red-50' : ''}><td className="num">{r.line}</td>{cols.map((c) => <td key={c}>{r[c] ?? ''}</td>)}<td>{r.errors.length ? <span className="text-red-700 text-sm">{r.errors.join('، ')}</span> : <Badge tone="green">جديد/تحديث</Badge>}</td></tr>)}</tbody></table></div>
        <div className="mt-4"><Button loading={commit.isPending} disabled={!preview.valid} onClick={() => commit.mutate()}>ابدأ الاستيراد ({preview.valid})</Button></div>
      </Card>}
      {done && <Card title="4. تمّ الاستيراد"><p>أُضيف <b className="num">{done.added}</b> · حُدِّث <b className="num">{done.updated}</b> · تُخطّي <b className="num">{done.skipped}</b></p></Card>}
    </div>
  );
}
