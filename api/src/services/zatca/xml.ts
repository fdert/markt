// توليد فاتورة UBL 2.1 المتوافقة مع الفوترة الإلكترونية (المرحلة الثانية)
import { createHash } from 'node:crypto';
import { ksaDateTime } from './sign.js';

export interface ZatcaParty {
  name: string; vatNumber?: string | null; crNumber?: string | null;
  street?: string | null; buildingNo?: string | null; additionalNo?: string | null; district?: string | null;
  city?: string | null; postalCode?: string | null; country?: string | null;
}

export interface ZatcaLine {
  id: number; name: string; qty: number; unitPrice: number; discount: number; netAmount: number;
  taxRate: number; taxAmount: number; total: number;
}

export interface ZatcaInvoiceInput {
  number: string; uuid: string; issuedAt: Date; kind: 'SIMPLIFIED' | 'STANDARD';
  type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE'; icv: number; previousHash: string;
  seller: ZatcaParty; buyer?: ZatcaParty | null; lines: ZatcaLine[];
  subtotal: number; taxTotal: number; total: number; paymentMeans: string;
  originalNumber?: string | null; reason?: string | null; supplyDate?: Date | null;
}

// تهريب النصوص بنفس قواعد التحويل القياسي C14N حتى تتطابق البصمة مع أداة الهيئة
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const a = (n: number) => n.toFixed(2);

const PAYMENT_CODES: Record<string, string> = { CASH: '10', CARD: '48', BANK_TRANSFER: '42', CREDIT: '30', OTHER: '1' };

function address(p: ZatcaParty, ind: string) {
  return `${ind}<cac:PostalAddress>
${ind}  <cbc:StreetName>${esc(p.street || '-')}</cbc:StreetName>
${ind}  <cbc:BuildingNumber>${esc(p.buildingNo || '0000')}</cbc:BuildingNumber>
${ind}  <cbc:PlotIdentification>${esc(p.additionalNo || '0000')}</cbc:PlotIdentification>
${ind}  <cbc:CitySubdivisionName>${esc(p.district || '-')}</cbc:CitySubdivisionName>
${ind}  <cbc:CityName>${esc(p.city || '-')}</cbc:CityName>
${ind}  <cbc:PostalZone>${esc(p.postalCode || '00000')}</cbc:PostalZone>
${ind}  <cac:Country>
${ind}    <cbc:IdentificationCode>${esc(p.country || 'SA')}</cbc:IdentificationCode>
${ind}  </cac:Country>
${ind}</cac:PostalAddress>`;
}

/**
 * خصم أو رسم على مستوى البند بحيث يتحقق شرط الهيئة BR-KSA-EN16931-11:
 * صافي البند = الكمية × السعر + الرسوم - الخصومات. الفرق الموجب (تقريب نقدي للأعلى) يُكتب رسماً.
 */
function lineAdjustment(l: ZatcaLine) {
  const diff = Math.round((Math.round(l.qty * l.unitPrice * 100) / 100 - l.netAmount) * 100) / 100;
  if (Math.abs(diff) < 0.005) return '';
  const charge = diff < 0;
  return `
        <cac:AllowanceCharge>
            <cbc:ChargeIndicator>${charge}</cbc:ChargeIndicator>
            <cbc:AllowanceChargeReasonCode>${charge ? 'ZZZ' : '95'}</cbc:AllowanceChargeReasonCode>
            <cbc:AllowanceChargeReason>${charge ? 'Rounding' : 'Discount'}</cbc:AllowanceChargeReason>
            <cbc:Amount currencyID="SAR">${a(Math.abs(diff))}</cbc:Amount>
        </cac:AllowanceCharge>`;
}

export const UBL_EXT_PLACEHOLDER = '<!--UBL_EXTENSIONS-->';
export const QR_PLACEHOLDER = '<!--QR_REFERENCE-->';
export const SIGNATURE_PLACEHOLDER = '<!--SIGNATURE_REFERENCE-->';

export function buildInvoiceXml(i: ZatcaInvoiceInput): string {
  const typeCode = i.type === 'CREDIT_NOTE' ? '381' : i.type === 'DEBIT_NOTE' ? '383' : '388';
  const isNote = i.type !== 'INVOICE';
  const nameCode = i.kind === 'SIMPLIFIED' ? '0200000' : '0100000';
  const { date, time } = ksaDateTime(i.issuedAt);
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const l of i.lines) {
    const g = byRate.get(l.taxRate) ?? { taxable: 0, tax: 0 };
    g.taxable += l.netAmount; g.tax += l.taxAmount; byRate.set(l.taxRate, g);
  }
  const subtotals = [...byRate.entries()].map(([rate, g]) => `
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="SAR">${a(g.taxable)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="SAR">${a(g.tax)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cbc:ID>${rate > 0 ? 'S' : 'Z'}</cbc:ID>
                <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>${rate > 0 ? '' : `
                <cbc:TaxExemptionReasonCode>VATEX-SA-35</cbc:TaxExemptionReasonCode>
                <cbc:TaxExemptionReason>Medicines and medical equipment</cbc:TaxExemptionReason>`}
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>`).join('');

  const buyer = i.buyer;
  const buyerXml = buyer ? `
    <cac:AccountingCustomerParty>
        <cac:Party>${buyer.vatNumber ? '' : buyer.crNumber ? `
            <cac:PartyIdentification>
                <cbc:ID schemeID="CRN">${esc(buyer.crNumber)}</cbc:ID>
            </cac:PartyIdentification>` : ''}
${address(buyer, '            ')}${buyer.vatNumber ? `
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${esc(buyer.vatNumber)}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>` : ''}
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${esc(buyer.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>` : `
    <cac:AccountingCustomerParty></cac:AccountingCustomerParty>`;

  const lines = i.lines.map((l) => `
    <cac:InvoiceLine>
        <cbc:ID>${l.id}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">${l.qty.toFixed(3)}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="SAR">${a(l.netAmount)}</cbc:LineExtensionAmount>${lineAdjustment(l)}
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="SAR">${a(l.taxAmount)}</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="SAR">${a(l.total)}</cbc:RoundingAmount>
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Name>${esc(l.name)}</cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>${l.taxRate > 0 ? 'S' : 'Z'}</cbc:ID>
                <cbc:Percent>${l.taxRate.toFixed(2)}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="SAR">${l.unitPrice.toFixed(4)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">${UBL_EXT_PLACEHOLDER}
    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${esc(i.number)}</cbc:ID>
    <cbc:UUID>${i.uuid}</cbc:UUID>
    <cbc:IssueDate>${date}</cbc:IssueDate>
    <cbc:IssueTime>${time}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="${nameCode}">${typeCode}</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>${isNote ? `
    <cac:BillingReference>
        <cac:InvoiceDocumentReference>
            <cbc:ID>${esc(i.originalNumber)}</cbc:ID>
        </cac:InvoiceDocumentReference>
    </cac:BillingReference>` : ''}
    <cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>${i.icv}</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${i.previousHash}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>${QR_PLACEHOLDER}${SIGNATURE_PLACEHOLDER}
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="CRN">${esc(i.seller.crNumber || '0000000000')}</cbc:ID>
            </cac:PartyIdentification>
${address(i.seller, '            ')}
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${esc(i.seller.vatNumber)}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${esc(i.seller.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>${buyerXml}${i.kind === 'STANDARD' || i.supplyDate ? `
    <cac:Delivery>
        <cbc:ActualDeliveryDate>${ksaDateTime(i.supplyDate ?? i.issuedAt).date}</cbc:ActualDeliveryDate>
    </cac:Delivery>` : ''}
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode>${PAYMENT_CODES[i.paymentMeans] ?? '10'}</cbc:PaymentMeansCode>${isNote ? `
        <cbc:InstructionNote>${esc(i.reason || 'Return of goods')}</cbc:InstructionNote>` : ''}
    </cac:PaymentMeans>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${a(i.taxTotal)}</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${a(i.taxTotal)}</cbc:TaxAmount>${subtotals}
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="SAR">${a(i.subtotal)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="SAR">${a(i.subtotal)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="SAR">${a(i.total)}</cbc:TaxInclusiveAmount>
        <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>
        <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>
        <cbc:PayableAmount currencyID="SAR">${a(i.total)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>${lines}
</Invoice>`;
}

/** المسافة البادئة التي تسبق العناصر المُدرجة (التوقيع، QR) وتبقى في المستند بعد حذفها */
export const INSERT_WS = '\n    ';

/**
 * بصمة الفاتورة: SHA-256 للفاتورة بعد حذف UBLExtensions ومرجع QR وcac:Signature والإعلان عن XML.
 * أداة الهيئة تحذف العناصر بتحويل XSLT ثم تطبّق C14N11، فتبقى المسافات المحيطة بكل عنصر محذوف.
 * لذلك نستبدل كل موضع إدراج بالمسافة البادئة نفسها التي ستبقى في المستند النهائي.
 * signed=false: فاتورة المرحلة الأولى (لا توقيع ولا UBLExtensions، والـ QR فقط).
 */
export function invoiceHashOf(xmlWithPlaceholders: string, signed = true): string {
  const pure = xmlWithPlaceholders
    .replace(/^<\?xml[^>]*\?>\n/, '')
    .replace(UBL_EXT_PLACEHOLDER, signed ? INSERT_WS : '')
    .replace(QR_PLACEHOLDER, INSERT_WS)
    .replace(SIGNATURE_PLACEHOLDER, signed ? INSERT_WS : '');
  return createHash('sha256').update(pure, 'utf8').digest('base64');
}

/**
 * يحسب البصمة من مستند نهائي (موقّع أو غير موقّع) بحذف العناصر نفسها التي يحذفها تحويل الهيئة،
 * ويُستخدم للتحقق الذاتي وفي الاختبارات. يفترض أن المستند مكتوب بصيغة قياسية (كما يولّده رصيد).
 */
export function canonicalHashOfFinal(xml: string): string {
  const pure = xml
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, '')
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')
    .replace(/<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, '');
  return createHash('sha256').update(pure, 'utf8').digest('base64');
}

export function qrReference(qr: string) {
  return `${INSERT_WS}<cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>`;
}

export const SIGNATURE_REF = `${INSERT_WS}<cac:Signature>
        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
    </cac:Signature>`;
