import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { a4Html, printHtml, receiptHtml, type InvoiceSettings, type PrintableInvoice, type StoreInfo } from './receipt';
import { buildEscPos, deviceStore, drawerKickBytes, pairDevice, sendRaw, support, agentPrinters, type DeviceSettings } from './escpos';
import { Button, Modal, Select, Toggle, Input, Segmented, useToast } from '../../components/ui';

export interface AllSettings { store: StoreInfo & Record<string, string>; tax: { vatNumber: string; enabled: boolean; rate: number }; invoice: InvoiceSettings; pos: Record<string, unknown> }

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<AllSettings>('/settings'), staleTime: 300_000 });
}

/** خدمة الطباعة الموحدة: المتصفح أو الطباعة المباشرة */
export function usePrinter() {
  const { data } = useSettings();
  return {
    ready: !!data,
    async print(inv: PrintableInvoice, opts: { template?: DeviceSettings['template']; drawer?: boolean } = {}) {
      if (!data) return;
      const dev = deviceStore.get();
      const template = opts.template ?? dev.template;
      const store = { ...data.store, vatNumber: data.tax.vatNumber };
      if (template === 'RECEIPT' && dev.method !== 'BROWSER') {
        const bytes = await buildEscPos(inv, data.invoice, store, dev, { drawer: opts.drawer });
        return sendRaw(bytes, dev);
      }
      const html = template === 'RECEIPT' ? await receiptHtml(inv, data.invoice, store, dev.paperWidth) : await a4Html(inv, data.invoice, store, template === 'COMPACT');
      return printHtml(html);
    },
    async openDrawer() { const dev = deviceStore.get(); if (dev.method !== 'BROWSER') await sendRaw(drawerKickBytes(), dev); },
  };
}

export function PrinterSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [dev, setDev] = useState<DeviceSettings>(deviceStore.get());
  const [printers, setPrinters] = useState<string[]>([]);
  const set = <K extends keyof DeviceSettings>(k: K, v: DeviceSettings[K]) => setDev((d) => ({ ...d, [k]: v }));
  const direct = dev.method !== 'BROWSER';

  const testPrint = async () => {
    try {
      deviceStore.set(dev);
      const sample: PrintableInvoice = { id: 0, number: 'TEST-0001', kind: 'SIMPLIFIED', type: 'INVOICE', status: 'PAID', createdAt: new Date().toISOString(), subtotal: 13.04, discount: 0, taxTotal: 1.96, total: 15, paid: 15, due: 0,
        items: [{ name: 'صفحة تجربة الطابعة', qty: 1, unitPrice: 13.04, discount: 0, taxRate: 15, taxAmount: 1.96, netAmount: 13.04, total: 15 }], payments: [{ method: 'CASH', amount: 15 }] };
      const s = await api<AllSettings>('/settings');
      if (direct) await sendRaw(await buildEscPos(sample, s.invoice, { ...s.store, vatNumber: s.tax.vatNumber }, dev), dev);
      else await printHtml(await receiptHtml(sample, s.invoice, { ...s.store, vatNumber: s.tax.vatNumber }, dev.paperWidth));
      toast.success('أُرسلت صفحة التجربة.');
    } catch (e) { toast.error(e); }
  };

  return (
    <Modal open={open} onClose={onClose} title="إعدادات الطباعة" size="md"
      footer={<><Button variant="secondary" onClick={testPrint}>طباعة تجريبية</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button><Button onClick={() => { deviceStore.set(dev); toast.success('تم الحفظ.'); onClose(); }}>حفظ الإعدادات</Button></>}>
      <p className="text-sm text-ink-500 mb-4">تُحفظ اختياراتك لهذا الجهاز والمتصفح.</p>
      <div className="space-y-4">
        <Select label="طريقة الطباعة الافتراضية" value={dev.method} onChange={(e) => set('method', e.target.value as DeviceSettings['method'])}
          hint={dev.method === 'BROWSER' ? 'تفتح نافذة الطباعة في المتصفح وتختار منها الطابعة.' : dev.method === 'AGENT' ? 'ترسل الفاتورة إلى مساعد الطباعة المثبّت على هذا الجهاز (Windows / macOS / Linux) أو طابعة شبكة.' : 'طباعة مباشرة دون نافذة طباعة، مع قص الورق وفتح درج النقود.'}>
          <option value="BROWSER">عبر المتصفح</option>
          <option value="USB" disabled={!support.usb}>مباشرة عبر USB{!support.usb ? ' (غير مدعوم في هذا المتصفح)' : ''}</option>
          <option value="SERIAL" disabled={!support.serial}>مباشرة عبر المنفذ التسلسلي / بلوتوث{!support.serial ? ' (غير مدعوم)' : ''}</option>
          <option value="AGENT">عبر مساعد الطباعة المحلي</option>
        </Select>
        {(dev.method === 'USB' || dev.method === 'SERIAL') && (
          <div className="flex items-end gap-2">
            {dev.method === 'SERIAL' && <Input label="سرعة المنفذ (Baud)" type="number" value={dev.baudRate} onChange={(e) => set('baudRate', Number(e.target.value))} />}
            <Button variant="secondary" onClick={() => pairDevice(dev.method as 'USB' | 'SERIAL').then(() => toast.success('تم ربط الطابعة.')).catch(toast.error)}>ربط طابعة</Button>
          </div>
        )}
        {dev.method === 'AGENT' && (
          <div className="space-y-3">
            <Input label="عنوان مساعد الطباعة" dir="ltr" value={dev.agentUrl} onChange={(e) => set('agentUrl', e.target.value)} hint="الافتراضي: http://127.0.0.1:17777 — اسمح بالاتصال المحلي إذا طلب المتصفح ذلك." />
            <div className="flex items-end gap-2">
              <Select label="طابعة الفواتير الافتراضية" value={dev.agentPrinter} onChange={(e) => set('agentPrinter', e.target.value)} className="flex-1">
                <option value="">اختر الطابعة</option>
                {printers.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
              <Button variant="secondary" onClick={() => agentPrinters(dev.agentUrl).then((p) => { setPrinters(p); if (!p.length) toast.error('لم يُعثر على طابعة. وصّل الطابعة ثم اضغط تحديث الطابعات.'); }).catch(toast.error)}>تحديث الطابعات</Button>
            </div>
          </div>
        )}
        <div>
          <span className="label">القالب الافتراضي</span>
          <Segmented value={dev.template} onChange={(v) => set('template', v)} items={[{ value: 'RECEIPT', label: 'إيصال كاشير' }, { value: 'A4', label: 'فاتورة مبيعات A4' }, { value: 'COMPACT', label: 'فاتورة مختصرة' }]} />
        </div>
        <div>
          <span className="label">عرض ورق الإيصال</span>
          <Segmented value={String(dev.paperWidth) as '80' | '58'} onChange={(v) => set('paperWidth', Number(v) as 58 | 80)} items={[{ value: '80', label: '80 مم' }, { value: '58', label: '58 مم' }]} />
        </div>
        <Select label="قص الورق بعد الفاتورة" value={dev.cutMode} disabled={!direct} onChange={(e) => set('cutMode', e.target.value as DeviceSettings['cutMode'])} hint="يتطلب قاطعاً آلياً في الطابعة. يسري على الطباعة المباشرة فقط.">
          <option value="AUTO">تلقائي — الإعداد الحالي</option><option value="NONE">بدون قص</option><option value="PARTIAL">قص جزئي</option><option value="FULL">قص كامل</option>
        </Select>
        <Toggle checked={dev.openDrawer} disabled={!direct} onChange={(v) => set('openDrawer', v)} label="فتح درج النقود بعد الطباعة" hint="للدرج الموصول بالطابعة. يُفتح بعد كل إيصال، بما فيها إعادة الطباعة." />
        <Toggle checked={dev.autoPrint} onChange={(v) => set('autoPrint', v)} label="طباعة الإيصال تلقائياً" hint="يُطبع الإيصال فور إصدار الفاتورة." />
        <Toggle checked={dev.skipSuccess} onChange={(v) => set('skipSuccess', v)} label="عدم إظهار شاشة نجاح الإصدار" hint="تظهر رسالة سريعة برقم الفاتورة بدلاً منها." />
      </div>
    </Modal>
  );
}
