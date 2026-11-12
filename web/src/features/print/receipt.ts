// قوالب الفواتير: إيصال حراري (80/58 مم) وفاتورة A4 وفاتورة مختصرة، مع رمز QR للفوترة الإلكترونية
import QRCode from 'qrcode';
import { money, qty, dateTime, PAYMENT_LABELS } from '../../lib/format';

export interface InvoiceSettings {
  showLogo: boolean; showStoreName: boolean; showCr: boolean; showVatNumber: boolean; showBranch: boolean; showBranchAddress: boolean; showBranchPhone: boolean;
  showEmployee: boolean; showOrderNo: boolean; showPaymentMethod: boolean; showCustomer: boolean; showCustomerPhone: boolean; showCustomerVat: boolean;
  showCustomerAddress: boolean; showLineNumbers: boolean; showSku: boolean; showUnit: boolean; showItemDiscount: boolean; showSubtotal: boolean;
  showTaxRate: boolean; showTaxAmount: boolean; showBarcode: boolean; showNotes: boolean; showFooter: boolean; showSignature: boolean; showStamp: boolean;
  notesText: string; footerText: string; signature: string; stamp: string;
  printItemCount?: boolean; printBranchAsTitle?: boolean; showOrderNumber?: boolean; showOrderType?: boolean;
}
export interface StoreInfo { name: string; nameEn?: string; logo?: string; crNumber?: string; phone?: string; vatNumber?: string; city?: string; street?: string; district?: string }

export interface PrintableInvoice {
  id: number; number: string; kind: string; type: string; status: string; createdAt: string; subtotal: number; discount: number; taxTotal: number; total: number;
  paid: number; due: number; notes?: string | null; qrCode?: string | null; returnReason?: string | null; change?: number; supplyDate?: string | null;
  orderNo?: number | null; orderType?: string | null; rounding?: number; tableName?: string | null;
  items: Array<{ name: string; barcode?: string | null; qty: number; unitPrice: number; discount: number; taxRate: number; taxAmount: number; netAmount: number; total: number; unitName?: string | null }>;
  payments: Array<{ method: string; amount: number }>;
  customer?: { name: string; phone?: string | null; vatNumber?: string | null; crNumber?: string | null; city?: string | null; district?: string | null; street?: string | null; buildingNo?: string | null; postalCode?: string | null } | null;
  branch?: { name: string; phone?: string | null; city?: string | null; district?: string | null; street?: string | null; crNumber?: string | null } | null;
  user?: { name: string } | null; original?: { number: string } | null;
}

export const ORDER_TYPE_LABELS: Record<string, string> = { DINE_IN: 'محلي', TAKEAWAY: 'سفري', DELIVERY: 'توصيل' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const docTitle = (inv: PrintableInvoice) =>
  inv.type === 'CREDIT_NOTE' ? (inv.kind === 'STANDARD' ? 'إشعار دائن ضريبي' : 'إشعار دائن مبسط')
    : inv.type === 'QUOTE' ? 'عرض سعر' : inv.status === 'DRAFT' ? 'مسودة فاتورة'
      : inv.kind === 'STANDARD' ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة';

export async function qrDataUrl(text: string) {
  return QRCode.toDataURL(text, { margin: 0, width: 220, errorCorrectionLevel: 'M' });
}

const baseCss = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif; color: #000; direction: rtl; }
  .num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
`;

/** إيصال الكاشير الحراري */
export async function receiptHtml(inv: PrintableInvoice, s: InvoiceSettings, store: StoreInfo, widthMm: 58 | 80) {
  const qr = inv.qrCode ? await qrDataUrl(inv.qrCode) : '';
  const fs = widthMm === 58 ? 11 : 12.5;
  const pays = inv.payments.filter((p) => p.amount !== 0);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.number)}</title><style>${baseCss}
    @page { size: ${widthMm}mm auto; }
    body { width: ${widthMm}mm; padding: 3mm ${widthMm === 58 ? 2 : 4}mm 6mm; font-size: ${fs}px; line-height: 1.45; }
    .c { text-align: center; } .b { font-weight: 700; } .hr { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; } .big { font-size: ${fs + 5}px; font-weight: 800; }
    .items td { padding: 2px 0; vertical-align: top; } .items .n { font-weight: 600; }
    img.logo { max-width: 60%; max-height: 22mm; display: block; margin: 0 auto 4px; } img.qr { width: ${widthMm === 58 ? 30 : 36}mm; display: block; margin: 6px auto 0; }
  </style></head><body>
    ${s.showLogo && store.logo ? `<img class="logo" src="${store.logo}" alt="">` : ''}
    ${s.showStoreName ? `<div class="c big">${esc(s.printBranchAsTitle && inv.branch ? inv.branch.name : store.name)}</div>` : ''}
    ${s.showBranch && inv.branch && !s.printBranchAsTitle ? `<div class="c">${esc(inv.branch.name)}</div>` : ''}
    ${s.showBranchAddress && inv.branch?.city ? `<div class="c">${esc([inv.branch.city, inv.branch.district, inv.branch.street].filter(Boolean).join('، '))}</div>` : ''}
    ${s.showBranchPhone && inv.branch?.phone ? `<div class="c">هاتف: <span class="num">${esc(inv.branch.phone)}</span></div>` : ''}
    ${s.showVatNumber && store.vatNumber ? `<div class="c">الرقم الضريبي: <span class="num">${esc(store.vatNumber)}</span></div>` : ''}
    ${s.showCr && (inv.branch?.crNumber || store.crNumber) ? `<div class="c">السجل التجاري: <span class="num">${esc(inv.branch?.crNumber || store.crNumber)}</span></div>` : ''}
    <div class="hr"></div>
    <div class="c b" style="font-size:${fs + 2}px">${docTitle(inv)}</div>
    ${s.showOrderNumber !== false && inv.orderNo ? `<div class="c" style="font-size:${fs + 14}px;font-weight:800;border:2px solid #000;border-radius:6px;margin:4px 20%">${inv.orderNo}</div>` : ''}
    ${s.showOrderType !== false && inv.orderType ? `<div class="c b">${ORDER_TYPE_LABELS[inv.orderType] ?? ''}${inv.tableName ? ` — ${esc(inv.tableName)}` : ''}</div>` : ''}
    <div class="row"><span>رقم الفاتورة</span><span class="num b">${esc(inv.number)}</span></div>
    <div class="row"><span>التاريخ</span><span>${dateTime(inv.createdAt)}</span></div>
    ${inv.original ? `<div class="row"><span>الفاتورة الأصلية</span><span class="num">${esc(inv.original.number)}</span></div>` : ''}
    ${s.showEmployee && inv.user ? `<div class="row"><span>الكاشير</span><span>${esc(inv.user.name)}</span></div>` : ''}
    ${s.showCustomer && inv.customer ? `<div class="row"><span>العميل</span><span>${esc(inv.customer.name)}</span></div>` : ''}
    ${s.showCustomerPhone && inv.customer?.phone ? `<div class="row"><span>الجوال</span><span class="num">${esc(inv.customer.phone)}</span></div>` : ''}
    ${s.showCustomerVat && inv.customer?.vatNumber ? `<div class="row"><span>ر.ض العميل</span><span class="num">${esc(inv.customer.vatNumber)}</span></div>` : ''}
    <div class="hr"></div>
    <table class="items"><tbody>
      ${inv.items.map((it, i) => `<tr><td colspan="2" class="n">${s.showLineNumbers ? `${i + 1}. ` : ''}${esc(it.name)}</td></tr>
        <tr><td><span class="num">${qty(it.qty)}</span>${s.showUnit && it.unitName ? ` ${esc(it.unitName)}` : ''} × <span class="num">${money((it.total + 0) / it.qty)}</span>${s.showItemDiscount && it.discount > 0 ? ` <small>(خصم ${money(it.discount)})</small>` : ''}</td><td style="text-align:left" class="num">${money(it.total)}</td></tr>`).join('')}
    </tbody></table>
    <div class="hr"></div>
    ${s.printItemCount !== false ? `<div class="row"><span>عدد الأصناف / القطع</span><span class="num">${inv.items.length} / ${qty(inv.items.reduce((a, it) => a + it.qty, 0))}</span></div>` : ''}
    ${s.showSubtotal ? `<div class="row"><span>الإجمالي قبل الضريبة</span><span class="num">${money(inv.subtotal)}</span></div>` : ''}
    ${inv.discount > 0 ? `<div class="row"><span>الخصم</span><span class="num">${money(inv.discount)}</span></div>` : ''}
    ${s.showTaxAmount ? `<div class="row"><span>ضريبة القيمة المضافة${s.showTaxRate ? ` (${inv.items[0]?.taxRate ?? 15}%)` : ''}</span><span class="num">${money(inv.taxTotal)}</span></div>` : ''}
    ${inv.rounding ? `<div class="row"><span>تقريب الفاتورة</span><span class="num">${money(inv.rounding)}</span></div>` : ''}
    <div class="row big"><span>الإجمالي</span><span class="num">${money(inv.total)}</span></div>
    ${s.showPaymentMethod ? pays.map((p) => `<div class="row"><span>${PAYMENT_LABELS[p.method] ?? p.method}</span><span class="num">${money(Math.abs(p.amount))}</span></div>`).join('') : ''}
    ${inv.change ? `<div class="row"><span>الباقي للعميل</span><span class="num">${money(inv.change)}</span></div>` : ''}
    ${inv.due > 0 ? `<div class="row b"><span>المتبقي (آجل)</span><span class="num">${money(inv.due)}</span></div>` : ''}
    ${inv.returnReason && inv.type === 'CREDIT_NOTE' ? `<div>سبب الإرجاع: ${esc(inv.returnReason)}</div>` : ''}
    ${s.showNotes && (inv.notes || s.notesText) ? `<div class="hr"></div><div>${esc(inv.notes || s.notesText)}</div>` : ''}
    ${qr ? `<img class="qr" src="${qr}" alt="رمز QR">` : ''}
    ${s.showFooter && s.footerText ? `<div class="c" style="margin-top:6px">${esc(s.footerText)}</div>` : ''}
  </body></html>`;
}

/** فاتورة A4 (مبيعات أو ضريبية) */
export async function a4Html(inv: PrintableInvoice, s: InvoiceSettings, store: StoreInfo, compact = false) {
  const qr = inv.qrCode ? await qrDataUrl(inv.qrCode) : '';
  const c = inv.customer;
  const addr = c ? [c.buildingNo, c.street, c.district, c.city, c.postalCode].filter(Boolean).join('، ') : '';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.number)}</title><style>${baseCss}
    @page { size: A4; margin: 12mm; }
    body { font-size: 12.5px; line-height: 1.5; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #0f5f58; padding-bottom: 10px; }
    .title { font-size: 22px; font-weight: 800; color: #0f5f58; } .muted { color: #555; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; } .box h4 { margin: 0 0 6px; font-size: 13px; color: #0f5f58; }
    .kv { display: flex; justify-content: space-between; gap: 8px; }
    th { background: #f1f5f4; font-weight: 700; } th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: start; } td.n { text-align: left; }
    .totals { width: 320px; margin-inline-start: auto; margin-top: 10px; } .totals .kv { padding: 4px 0; border-bottom: 1px solid #eee; } .grand { font-size: 16px; font-weight: 800; }
    img.logo { max-height: 60px; max-width: 200px; } img.qr { width: 110px; height: 110px; }
    .sig { display: flex; justify-content: space-between; margin-top: 30px; } .sig img { max-height: 70px; }
  </style></head><body>
    <div class="top">
      <div>
        ${s.showLogo && store.logo ? `<img class="logo" src="${store.logo}" alt="">` : ''}
        ${s.showStoreName ? `<div style="font-size:18px;font-weight:800">${esc(store.name)}</div>` : ''}
        ${s.showBranchAddress && inv.branch ? `<div class="muted">${esc([inv.branch.name, inv.branch.city, inv.branch.district, inv.branch.street].filter(Boolean).join('، '))}</div>` : ''}
        ${s.showVatNumber && store.vatNumber ? `<div>الرقم الضريبي: <span class="num">${esc(store.vatNumber)}</span></div>` : ''}
        ${s.showCr && store.crNumber ? `<div>السجل التجاري: <span class="num">${esc(store.crNumber)}</span></div>` : ''}
      </div>
      <div style="text-align:left">
        <div class="title">${docTitle(inv)}</div>
        <div>Tax Invoice</div>
        ${qr ? `<img class="qr" src="${qr}" alt="رمز QR">` : ''}
      </div>
    </div>
    <div class="grid">
      <div class="box"><h4>بيانات الفاتورة</h4>
        <div class="kv"><span>رقم الفاتورة</span><b class="num">${esc(inv.number)}</b></div>
        <div class="kv"><span>تاريخ الإصدار</span><span>${dateTime(inv.createdAt)}</span></div>
        ${inv.supplyDate ? `<div class="kv"><span>تاريخ التوريد</span><span>${dateTime(inv.supplyDate)}</span></div>` : ''}
        ${inv.original ? `<div class="kv"><span>الفاتورة الأصلية</span><span class="num">${esc(inv.original.number)}</span></div>` : ''}
        ${s.showEmployee && inv.user ? `<div class="kv"><span>الموظف</span><span>${esc(inv.user.name)}</span></div>` : ''}
      </div>
      <div class="box"><h4>بيانات العميل</h4>
        ${c ? `<div class="kv"><span>الاسم</span><b>${esc(c.name)}</b></div>
        ${s.showCustomerVat && c.vatNumber ? `<div class="kv"><span>الرقم الضريبي</span><span class="num">${esc(c.vatNumber)}</span></div>` : ''}
        ${c.crNumber ? `<div class="kv"><span>السجل التجاري</span><span class="num">${esc(c.crNumber)}</span></div>` : ''}
        ${s.showCustomerPhone && c.phone ? `<div class="kv"><span>الجوال</span><span class="num">${esc(c.phone)}</span></div>` : ''}
        ${s.showCustomerAddress && addr ? `<div class="kv"><span>العنوان</span><span>${esc(addr)}</span></div>` : ''}` : '<div class="muted">عميل نقدي</div>'}
      </div>
    </div>
    <table><thead><tr>${s.showLineNumbers ? '<th>#</th>' : ''}<th>البند</th>${!compact && s.showUnit ? '<th>الوحدة</th>' : ''}<th>الكمية</th><th>سعر الوحدة</th>${!compact && s.showItemDiscount ? '<th>الخصم</th>' : ''}${!compact && s.showSubtotal ? '<th>قبل الضريبة</th>' : ''}${!compact && s.showTaxRate ? '<th>النسبة</th>' : ''}${!compact && s.showTaxAmount ? '<th>الضريبة</th>' : ''}<th>الإجمالي</th></tr></thead>
    <tbody>${inv.items.map((it, i) => `<tr>${s.showLineNumbers ? `<td class="n">${i + 1}</td>` : ''}<td>${esc(it.name)}${s.showBarcode && it.barcode && !compact ? `<div class="muted num" style="font-size:11px">${esc(it.barcode)}</div>` : ''}</td>${!compact && s.showUnit ? `<td>${esc(it.unitName ?? '')}</td>` : ''}<td class="n">${qty(it.qty)}</td><td class="n">${money(it.unitPrice, 2)}</td>${!compact && s.showItemDiscount ? `<td class="n">${money(it.discount)}</td>` : ''}${!compact && s.showSubtotal ? `<td class="n">${money(it.netAmount)}</td>` : ''}${!compact && s.showTaxRate ? `<td class="n">${it.taxRate}%</td>` : ''}${!compact && s.showTaxAmount ? `<td class="n">${money(it.taxAmount)}</td>` : ''}<td class="n">${money(it.total)}</td></tr>`).join('')}</tbody></table>
    <div class="totals">
      <div class="kv"><span>الإجمالي قبل الضريبة</span><span class="num">${money(inv.subtotal)}</span></div>
      ${inv.discount > 0 ? `<div class="kv"><span>إجمالي الخصم</span><span class="num">${money(inv.discount)}</span></div>` : ''}
      <div class="kv"><span>ضريبة القيمة المضافة</span><span class="num">${money(inv.taxTotal)}</span></div>
      <div class="kv grand"><span>الإجمالي شامل الضريبة</span><span class="num">${money(inv.total)} ر.س</span></div>
      ${inv.due > 0 ? `<div class="kv"><span>المدفوع</span><span class="num">${money(inv.paid)}</span></div><div class="kv"><b>المتبقي</b><b class="num">${money(inv.due)}</b></div>` : ''}
    </div>
    ${s.showNotes && (inv.notes || s.notesText) ? `<div class="box" style="margin-top:14px"><h4>ملاحظات</h4>${esc(inv.notes || s.notesText)}</div>` : ''}
    ${s.showSignature || s.showStamp ? `<div class="sig"><div>${s.showSignature ? `التوقيع<br>${s.signature ? `<img src="${s.signature}" alt="">` : ''}` : ''}</div><div>${s.showStamp && s.stamp ? `<img src="${s.stamp}" alt="الختم">` : ''}</div></div>` : ''}
    ${s.showFooter && s.footerText ? `<p style="text-align:center;margin-top:20px" class="muted">${esc(s.footerText)}</p>` : ''}
  </body></html>`;
}

/** الطباعة عبر المتصفح باستخدام إطار مخفي */
export function printHtml(html: string) {
  return new Promise<void>((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, { position: 'fixed', width: '0', height: '0', border: '0', insetInlineStart: '-9999px' });
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open(); doc.write(html); doc.close();
    const go = () => {
      iframe.contentWindow!.focus(); iframe.contentWindow!.print();
      setTimeout(() => { iframe.remove(); resolve(); }, 1000);
    };
    // انتظار تحميل الصور والخطوط
    const imgs = Array.from(doc.images);
    Promise.all(imgs.map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))).then(() => setTimeout(go, 150));
  });
}
