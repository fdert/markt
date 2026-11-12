// شاشة العميل: نافذة ثانية تعرض السلة والإجمالي لحظياً عبر قناة البث في المتصفح
export interface DisplayState {
  storeName: string;
  lines: Array<{ name: string; qty: number; total: number }>;
  subtotal: number; tax: number; discount: number; total: number; rounding: number;
  status: 'IDLE' | 'CART' | 'PAID';
  change?: number; message?: string;
}
const CHANNEL = 'raseed-customer-display';
let channel: BroadcastChannel | null = null;
const ch = () => (channel ??= typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null);

export const customerDisplay = {
  publish(s: DisplayState) { ch()?.postMessage(s); try { localStorage.setItem(CHANNEL, JSON.stringify(s)); } catch { /* تجاهل */ } },
  subscribe(fn: (s: DisplayState) => void) {
    const c = ch(); const h = (e: MessageEvent) => fn(e.data);
    c?.addEventListener('message', h);
    try { const last = localStorage.getItem(CHANNEL); if (last) fn(JSON.parse(last)); } catch { /* تجاهل */ }
    return () => c?.removeEventListener('message', h);
  },
  open() { window.open('/customer-display', 'raseed-customer-display', 'width=1024,height=700'); },
};
