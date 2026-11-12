// الطباعة المباشرة على الطابعات الحرارية (ESC/POS): تُرسم الفاتورة صورةً نقطية
// فتظهر العربية بشكل صحيح على أي طابعة، مع أوامر قص الورق وفتح درج النقود.
import QRCode from 'qrcode';
import { money, qty, dateTime, PAYMENT_LABELS } from '../../lib/format';
import type { InvoiceSettings, PrintableInvoice, StoreInfo } from './receipt';
import { docTitle } from './receipt';

export type CutMode = 'AUTO' | 'NONE' | 'PARTIAL' | 'FULL';
export interface DeviceSettings {
  method: 'BROWSER' | 'SERIAL' | 'USB' | 'AGENT';
  paperWidth: 58 | 80;
  cutMode: CutMode;
  openDrawer: boolean;
  autoPrint: boolean;
  skipSuccess: boolean;
  template: 'RECEIPT' | 'A4' | 'COMPACT';
  autoPrintOnHold: boolean;
  autoPrintOnReturn: boolean;
  printKitchenTickets: boolean;
  agentUrl: string;
  agentPrinter: string;
  baudRate: number;
}

const KEY = 'raseed.printer';
export const defaultDevice: DeviceSettings = { method: 'BROWSER', paperWidth: 80, cutMode: 'AUTO', openDrawer: false, autoPrint: true, skipSuccess: false, template: 'RECEIPT', autoPrintOnHold: false, autoPrintOnReturn: true, printKitchenTickets: true, agentUrl: 'http://127.0.0.1:17777', agentPrinter: '', baudRate: 9600 };
/** تُحفظ إعدادات الطابعة لهذا الجهاز والمتصفح */
export const deviceStore = {
  get(): DeviceSettings { try { return { ...defaultDevice, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return defaultDevice; } },
  set(v: DeviceSettings) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* تجاهل */ } },
};

// ===== رسم الإيصال على لوحة رسم =====
async function renderCanvas(inv: PrintableInvoice, s: InvoiceSettings, store: StoreInfo, widthMm: 58 | 80) {
  const W = widthMm === 58 ? 384 : 576;
  const pad = 8; const right = W - pad;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = 4000;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, canvas.height); ctx.fillStyle = '#000';
  ctx.direction = 'rtl'; ctx.textBaseline = 'top';
  const base = widthMm === 58 ? 20 : 24;
  let y = 6;
  const font = (size: number, bold = false) => { ctx.font = `${bold ? 700 : 500} ${size}px Tajawal, Tahoma, sans-serif`; };
  const center = (t: string, size = base, bold = false) => { font(size, bold); ctx.textAlign = 'center'; ctx.fillText(t, W / 2, y, W - pad * 2); y += size + 8; };
  const row = (a: string, b: string, size = base, bold = false) => {
    font(size, bold); ctx.textAlign = 'right'; ctx.fillText(a, right, y);
    ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.fillText(b, pad, y); ctx.direction = 'rtl'; y += size + 8;
  };
  const wrap = (t: string, size = base, bold = false) => {
    font(size, bold); ctx.textAlign = 'right';
    const words = t.split(' '); let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > W - pad * 2 && line) { ctx.fillText(line, right, y); y += size + 6; line = w; } else line = test;
    }
    if (line) { ctx.fillText(line, right, y); y += size + 6; }
  };
  const hr = () => { ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(pad, y + 4); ctx.lineTo(W - pad, y + 4); ctx.stroke(); ctx.setLineDash([]); y += 14; };

  if (s.showLogo && store.logo) {
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = store.logo!; });
      const h = Math.min(110, img.height * ((W * 0.6) / img.width)); const w = img.width * (h / img.height);
      ctx.drawImage(img, (W - w) / 2, y, w, h); y += h + 8;
    } catch { /* تجاهل الشعار */ }
  }
  if (s.showStoreName) center(s.printBranchAsTitle && inv.branch ? inv.branch.name : store.name, base + 8, true);
  if (s.showBranch && inv.branch) center(inv.branch.name);
  if (s.showVatNumber && store.vatNumber) center(`الرقم الضريبي: ${store.vatNumber}`);
  if (s.showCr && store.crNumber) center(`السجل التجاري: ${store.crNumber}`);
  hr();
  center(docTitle(inv), base + 2, true);
  if (s.showOrderNumber !== false && inv.orderNo) center(`طلب رقم ${inv.orderNo}`, base + 16, true);
  if (s.showOrderType !== false && inv.orderType) center(`${ORDER_TYPES[inv.orderType] ?? ''}${inv.tableName ? ` — ${inv.tableName}` : ''}`, base, true);
  row('رقم الفاتورة', inv.number, base, true);
  row('التاريخ', dateTime(inv.createdAt).replace('، ', ' '));
  if (s.showEmployee && inv.user) row('الكاشير', inv.user.name);
  if (s.showCustomer && inv.customer) row('العميل', inv.customer.name);
  hr();
  inv.items.forEach((it, i) => {
    wrap(`${s.showLineNumbers ? `${i + 1}. ` : ''}${it.name}`, base, true);
    row(`${qty(it.qty)} × ${money(it.total / it.qty)}`, money(it.total));
  });
  hr();
  if (s.printItemCount !== false) row('عدد الأصناف / القطع', `${inv.items.length} / ${qty(inv.items.reduce((a, it) => a + it.qty, 0))}`);
  if (s.showSubtotal) row('قبل الضريبة', money(inv.subtotal));
  if (inv.discount > 0) row('الخصم', money(inv.discount));
  if (s.showTaxAmount) row('ضريبة القيمة المضافة', money(inv.taxTotal));
  if (inv.rounding) row('تقريب الفاتورة', money(inv.rounding));
  row('الإجمالي', money(inv.total), base + 8, true);
  if (s.showPaymentMethod) inv.payments.filter((p) => p.amount).forEach((p) => row(PAYMENT_LABELS[p.method] ?? p.method, money(Math.abs(p.amount))));
  if (inv.change) row('الباقي', money(inv.change));
  if (inv.due > 0) row('المتبقي (آجل)', money(inv.due), base, true);
  if (s.showNotes && (inv.notes || s.notesText)) { hr(); wrap(inv.notes || s.notesText); }
  if (inv.qrCode) {
    const qc = document.createElement('canvas');
    await QRCode.toCanvas(qc, inv.qrCode, { margin: 0, width: widthMm === 58 ? 220 : 260 });
    y += 6; ctx.drawImage(qc, (W - qc.width) / 2, y); y += qc.height + 10;
  }
  if (s.showFooter && s.footerText) center(s.footerText);
  y += 10;
  const out = document.createElement('canvas'); out.width = W; out.height = Math.ceil(y);
  out.getContext('2d')!.drawImage(canvas, 0, 0);
  return out;
}

// ===== تحويل الصورة إلى أوامر ESC/POS =====
function rasterBytes(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(8 + bytesPerRow * height);
  out.set([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff]);
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const i = (yy * width + xx) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < 150 && data[i + 3] > 100) out[8 + yy * bytesPerRow + (xx >> 3)] |= 0x80 >> (xx & 7);
    }
  }
  return out;
}

export async function buildEscPos(inv: PrintableInvoice, s: InvoiceSettings, store: StoreInfo, dev: DeviceSettings, opts: { drawer?: boolean } = {}) {
  const canvas = await renderCanvas(inv, s, store, dev.paperWidth);
  const parts: number[][] = [[0x1b, 0x40]]; // تهيئة الطابعة
  if (opts.drawer ?? dev.openDrawer) parts.push([0x1b, 0x70, 0x00, 0x19, 0xfa]); // فتح درج النقود
  parts.push([...rasterBytes(canvas)]);
  parts.push([0x1b, 0x64, 0x04]); // تغذية 4 أسطر
  if (dev.cutMode === 'FULL' || dev.cutMode === 'AUTO') parts.push([0x1d, 0x56, 0x00]);
  if (dev.cutMode === 'PARTIAL') parts.push([0x1d, 0x56, 0x01]);
  return new Uint8Array(parts.flat());
}

export const drawerKickBytes = () => new Uint8Array([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]);

// ===== قنوات الإرسال =====
type SerialPortLike = { open: (o: { baudRate: number }) => Promise<void>; writable: WritableStream<Uint8Array>; close: () => Promise<void> };
type USBDeviceLike = { open: () => Promise<void>; selectConfiguration: (n: number) => Promise<void>; claimInterface: (n: number) => Promise<void>; transferOut: (ep: number, d: Uint8Array) => Promise<unknown>; configuration: { interfaces: Array<{ interfaceNumber: number; alternate: { endpoints: Array<{ direction: string; endpointNumber: number }> } }> } | null; productName?: string };
const nav = navigator as unknown as { serial?: { requestPort: () => Promise<SerialPortLike>; getPorts: () => Promise<SerialPortLike[]> }; usb?: { requestDevice: (o: { filters: unknown[] }) => Promise<USBDeviceLike>; getDevices: () => Promise<USBDeviceLike[]> } };

export const support = { serial: !!nav.serial, usb: !!nav.usb };

export async function pairDevice(method: 'SERIAL' | 'USB') {
  if (method === 'SERIAL') { if (!nav.serial) throw new Error('المتصفح لا يدعم المنفذ التسلسلي. استخدم Chrome أو Edge.'); await nav.serial.requestPort(); return; }
  if (!nav.usb) throw new Error('المتصفح لا يدعم USB. استخدم Chrome أو Edge.');
  await nav.usb.requestDevice({ filters: [{ classCode: 7 }, {}] });
}

async function sendSerial(bytes: Uint8Array, baudRate: number) {
  const [port] = (await nav.serial?.getPorts()) ?? [];
  if (!port) throw new Error('لم يُعثر على طابعة. وصّل الطابعة ثم اضغط «ربط طابعة».');
  await port.open({ baudRate });
  const w = port.writable.getWriter();
  try { await w.write(bytes); } finally { w.releaseLock(); await port.close(); }
}

async function sendUsb(bytes: Uint8Array) {
  const [dev] = (await nav.usb?.getDevices()) ?? [];
  if (!dev) throw new Error('لم يُعثر على طابعة. وصّل الطابعة ثم اضغط «ربط طابعة».');
  await dev.open(); if (!dev.configuration) await dev.selectConfiguration(1);
  const iface = dev.configuration!.interfaces.find((i) => i.alternate.endpoints.some((e) => e.direction === 'out'))!;
  await dev.claimInterface(iface.interfaceNumber);
  const ep = iface.alternate.endpoints.find((e) => e.direction === 'out')!.endpointNumber;
  for (let i = 0; i < bytes.length; i += 16384) await dev.transferOut(ep, bytes.slice(i, i + 16384));
}

async function sendAgent(bytes: Uint8Array, dev: DeviceSettings) {
  let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  const res = await fetch(`${dev.agentUrl}/print`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ printer: dev.agentPrinter, data: btoa(bin) }) }).catch(() => null);
  if (!res?.ok) throw new Error('تعذّر الاتصال بمساعد الطباعة. شغّل الأداة ثم أعد المحاولة.');
}

export async function agentPrinters(url: string): Promise<string[]> {
  const res = await fetch(`${url}/printers`).catch(() => null);
  if (!res?.ok) throw new Error('مساعد الطباعة غير متصل.');
  return (await res.json()).printers ?? [];
}

export async function sendRaw(bytes: Uint8Array, dev: DeviceSettings) {
  if (dev.method === 'SERIAL') return sendSerial(bytes, dev.baudRate);
  if (dev.method === 'USB') return sendUsb(bytes);
  if (dev.method === 'AGENT') return sendAgent(bytes, dev);
  throw new Error('طريقة الطباعة الحالية عبر المتصفح.');
}

// ===== تذكرة المطبخ =====
export interface KitchenTicket { stationName: string; orderNo?: number | null; orderType?: string | null; tableName?: string | null; customerName?: string | null; notes?: string | null; items: Array<{ name: string; qty: number; note?: string | null }>; createdAt: string }
const ORDER_TYPES: Record<string, string> = { DINE_IN: 'محلي', TAKEAWAY: 'سفري', DELIVERY: 'توصيل' };

export function renderKitchenCanvas(t: KitchenTicket, widthMm: 58 | 80) {
  const W = widthMm === 58 ? 384 : 576; const pad = 10; const right = W - pad;
  const c = document.createElement('canvas'); c.width = W; c.height = 3000;
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, c.height); ctx.fillStyle = '#000'; ctx.direction = 'rtl'; ctx.textBaseline = 'top';
  let y = 8;
  const text = (s: string, size: number, bold = false, align: CanvasTextAlign = 'right') => { ctx.font = `${bold ? 800 : 500} ${size}px Tajawal, Tahoma`; ctx.textAlign = align; ctx.fillText(s, align === 'center' ? W / 2 : right, y, W - pad * 2); y += size + 10; };
  text(t.stationName, 30, true, 'center');
  if (t.orderNo) text(`طلب رقم ${t.orderNo}`, 44, true, 'center');
  text([t.orderType ? ORDER_TYPES[t.orderType] ?? t.orderType : '', t.tableName ?? '', t.customerName ?? ''].filter(Boolean).join(' — '), 26, true, 'center');
  text(new Date(t.createdAt).toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }), 22, false, 'center');
  ctx.fillRect(pad, y, W - pad * 2, 3); y += 14;
  for (const it of t.items) { text(`${it.qty} × ${it.name}`, 30, true); if (it.note) text(`↲ ${it.note}`, 22); }
  if (t.notes) { ctx.fillRect(pad, y, W - pad * 2, 2); y += 10; text(`ملاحظة: ${t.notes}`, 24, true); }
  y += 20;
  const out = document.createElement('canvas'); out.width = W; out.height = Math.ceil(y); out.getContext('2d')!.drawImage(c, 0, 0);
  return out;
}

/** طباعة تذكرة المطبخ على طابعة القسم عبر مساعد الطباعة (اسم طابعة أو IP:9100) */
export async function printKitchenTicket(t: KitchenTicket, printer: string, dev: DeviceSettings) {
  const canvas = renderKitchenCanvas(t, dev.paperWidth);
  const bytes = new Uint8Array([0x1b, 0x40, ...rasterBytes(canvas), 0x1b, 0x64, 0x04, 0x1d, 0x56, 0x01]);
  return sendAgent(bytes, { ...dev, agentPrinter: printer });
}
