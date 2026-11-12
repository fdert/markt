// قارئ رمز QR للفاتورة الإلكترونية: يفك ترميز TLV حسب معايير هيئة الزكاة والضريبة والجمارك
import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ScanLine, CheckCircle2, AlertTriangle, ImageUp } from 'lucide-react';
import { money, dateTime } from '../lib/format';
import { Button, Card, Empty, PageHeader, Textarea, clsx, useToast } from '../components/ui';

interface Decoded { seller: string; vat: string; time: string; total: string; tax: string; phase2: boolean; hash?: string; extraTags: number[] }

function decodeTlv(b64: string): Decoded {
  const bin = atob(b64.trim().replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const out: Record<number, Uint8Array> = {};
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i]; const len = bytes[i + 1];
    if (len == null || i + 2 + len > bytes.length) throw new Error('بنية الرمز غير صحيحة.');
    out[tag] = bytes.slice(i + 2, i + 2 + len); i += 2 + len;
  }
  const txt = (t: number) => (out[t] ? new TextDecoder().decode(out[t]) : '');
  if (!out[1] || !out[2] || !out[4]) throw new Error('الرمز لا يحتوي على بيانات فاتورة إلكترونية.');
  return { seller: txt(1), vat: txt(2), time: txt(3), total: txt(4), tax: txt(5), phase2: !!out[6] && !!out[7], hash: out[6] ? txt(6) : undefined, extraTags: Object.keys(out).map(Number).filter((t) => t > 5) };
}

type Detector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;

export default function QrReaderPage() {
  const toast = useToast();
  const [raw, setRaw] = useState(''); const [res, setRes] = useState<Decoded | null>(null); const [err, setErr] = useState('');
  const [cam, setCam] = useState(false); const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null);
  const read = (v: string) => { setRaw(v); try { setRes(decodeTlv(v)); setErr(''); } catch (e) { setRes(null); setErr(e instanceof Error ? e.message : 'تعذّرت قراءة الرمز.'); } };
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCam(false); };
  useEffect(() => () => stop(), []);
  const start = async () => {
    if (!BD) return toast.error('المتصفح لا يدعم قراءة QR بالكاميرا. استخدم Chrome، أو امسح الرمز بقارئ ثنائي الأبعاد في الحقل.');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setCam(true);
      setTimeout(async () => {
        if (!video.current) return;
        video.current.srcObject = stream.current; await video.current.play();
        const det = new BD({ formats: ['qr_code'] });
        const loop = async () => {
          if (!stream.current || !video.current) return;
          const codes = await det.detect(video.current).catch(() => []);
          if (codes[0]) { read(codes[0].rawValue); stop(); return; }
          requestAnimationFrame(loop);
        };
        loop();
      }, 50);
    } catch { toast.error('لم يُسمح بالوصول إلى الكاميرا.'); }
  };
  const fromImage = async (f: File) => {
    if (!BD) return toast.error('المتصفح لا يدعم قراءة QR من الصور.');
    const bmp = await createImageBitmap(f);
    const codes = await new BD({ formats: ['qr_code'] }).detect(bmp);
    if (codes[0]) read(codes[0].rawValue); else toast.error('لم يُعثر على رمز QR في الصورة.');
  };
  const vatOk = res && /^3\d{13}3$/.test(res.vat);
  return (
    <>
      <PageHeader title="قارئ الفاتورة الإلكترونية" subtitle="اقرأ رمز QR لأي فاتورة سعودية واعرض بياناتها وفق معايير هيئة الزكاة والضريبة والجمارك." />
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="الرمز">
          <div className="flex flex-wrap gap-2 mb-3">
            {cam ? <Button variant="danger" onClick={stop}><CameraOff className="size-4" />إيقاف الكاميرا</Button> : <Button onClick={start}><Camera className="size-4" />المسح بالكاميرا</Button>}
            <label className="btn-secondary cursor-pointer"><ImageUp className="size-4" />من صورة<input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && fromImage(e.target.files[0])} /></label>
          </div>
          {cam && <video ref={video} className="w-full rounded-xl bg-black aspect-video mb-3" muted playsInline />}
          <Textarea label="أو امسح الرمز بقارئ QR / الصق النص" dir="ltr" className="font-mono text-xs min-h-[120px]" value={raw} onChange={(e) => read(e.target.value)} placeholder="AQ..." />
          <p className="text-[13px] text-ink-500 mt-2 flex items-center gap-1"><ScanLine className="size-4" />قارئات الباركود ثنائية الأبعاد تكتب الرمز هنا مباشرة.</p>
        </Card>
        <Card title="بيانات الفاتورة">
          {err ? <p className="text-red-600" role="alert">{err}</p> : !res ? <Empty title="اقرأ رمزاً لعرض بياناته" /> : (
            <div className="space-y-3">
              <div className={clsx('rounded-xl p-3 flex items-center gap-2', res.phase2 ? 'bg-emerald-50 text-emerald-800' : 'bg-brand-50 text-brand-800')}>
                <CheckCircle2 className="size-5" />{res.phase2 ? 'فاتورة موقّعة — المرحلة الثانية (الربط والتكامل)' : 'فاتورة المرحلة الأولى (الإصدار والحفظ)'}
              </div>
              <dl className="divide-y divide-ink-100">
                {[['اسم البائع', res.seller], ['الرقم الضريبي', res.vat], ['تاريخ ووقت الفاتورة', res.time ? dateTime(res.time) : '—'], ['الإجمالي شامل الضريبة', `${money(res.total)} ر.س`], ['مبلغ الضريبة', `${money(res.tax)} ر.س`]].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2"><dt className="text-ink-500">{k}</dt><dd className="font-medium">{v}</dd></div>
                ))}
              </dl>
              {!vatOk && <p className="flex items-center gap-2 text-amber-700 text-sm"><AlertTriangle className="size-4" />الرقم الضريبي لا يطابق الصيغة (15 رقماً يبدأ وينتهي بالرقم 3).</p>}
              {res.hash && <p className="text-xs text-ink-500 break-all" dir="ltr">Hash: {res.hash}</p>}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
