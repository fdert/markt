// ترميز TLV لرمز QR وفق متطلبات هيئة الزكاة والضريبة والجمارك
function tlv(tag: number, value: Buffer): Buffer {
  if (value.length > 255) throw new Error('TLV value too long');
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

export interface QrInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO 8601
  total: string; // شامل الضريبة
  vatTotal: string;
  // حقول المرحلة الثانية
  invoiceHash?: string;
  signature?: string;
  publicKey?: Buffer;
  certificateSignature?: Buffer;
}

export function buildQr(i: QrInput): string {
  const parts = [
    tlv(1, Buffer.from(i.sellerName, 'utf8')),
    tlv(2, Buffer.from(i.vatNumber, 'utf8')),
    tlv(3, Buffer.from(i.timestamp, 'utf8')),
    tlv(4, Buffer.from(i.total, 'utf8')),
    tlv(5, Buffer.from(i.vatTotal, 'utf8')),
  ];
  if (i.invoiceHash) parts.push(tlv(6, Buffer.from(i.invoiceHash, 'utf8')));
  if (i.signature) parts.push(tlv(7, Buffer.from(i.signature, 'utf8')));
  if (i.publicKey) parts.push(tlv(8, i.publicKey));
  if (i.certificateSignature) parts.push(tlv(9, i.certificateSignature));
  return Buffer.concat(parts).toString('base64');
}

export function decodeQr(b64: string): Record<number, string> {
  const buf = Buffer.from(b64, 'base64');
  const out: Record<number, string> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i]; const len = buf[i + 1];
    const val = buf.subarray(i + 2, i + 2 + len);
    out[tag] = tag <= 7 ? val.toString('utf8') : val.toString('base64');
    i += 2 + len;
  }
  return out;
}

// التحقق من صحة الرقم الضريبي السعودي: 15 رقماً يبدأ وينتهي بالرقم 3
export const isValidVat = (v?: string | null) => !!v && /^3\d{13}3$/.test(v);
