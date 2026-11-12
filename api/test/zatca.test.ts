import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVerify, X509Certificate } from 'node:crypto';
import { buildQr, decodeQr, isValidVat } from '../src/services/zatca/qr.js';
import { buildInvoiceXml, invoiceHashOf } from '../src/services/zatca/xml.js';
import { generatePrivateKey, generateCsr, signInvoice } from '../src/services/zatca/sign.js';

const sample = () => buildInvoiceXml({
  number: 'INV-1', uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be', issuedAt: new Date('2026-11-11T10:00:00Z'), kind: 'SIMPLIFIED', type: 'INVOICE', icv: 1,
  previousHash: 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  seller: { name: 'متجر', vatNumber: '310123456700003', crNumber: '1010123456', city: 'الرياض' }, buyer: null,
  lines: [{ id: 1, name: 'حليب', qty: 2, unitPrice: 6.5217, discount: 0, netAmount: 13.04, taxRate: 15, taxAmount: 1.96, total: 15 }],
  subtotal: 13.04, taxTotal: 1.96, total: 15, paymentMeans: 'CASH',
});

describe('ZATCA', () => {
  it('builds and decodes a Phase 1 TLV QR', () => {
    const qr = buildQr({ sellerName: 'متجر رصيد', vatNumber: '310123456700003', timestamp: '2026-11-11T10:00:00Z', total: '115.00', vatTotal: '15.00' });
    const d = decodeQr(qr);
    expect(d[1]).toBe('متجر رصيد'); expect(d[2]).toBe('310123456700003'); expect(d[4]).toBe('115.00'); expect(d[5]).toBe('15.00');
  });
  it('validates Saudi VAT numbers', () => {
    expect(isValidVat('310123456700003')).toBe(true);
    expect(isValidVat('110123456700003')).toBe(false);
    expect(isValidVat('31012345670000')).toBe(false);
  });
  it('produces a stable invoice hash that ignores the QR/signature parts', () => {
    const x = sample();
    expect(x).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
    expect(invoiceHashOf(x)).toBe(invoiceHashOf(sample()));
    expect(Buffer.from(invoiceHashOf(x), 'base64')).toHaveLength(32);
  });
  it('generates a ZATCA CSR and signs an invoice with secp256k1', () => {
    const key = generatePrivateKey();
    const csr = generateCsr(key, { commonName: 'EGS1', serialNumber: '1-Raseed|2-POS|3-abc', organizationIdentifier: '310123456700003', organizationUnitName: 'Main', organizationName: 'Store', countryName: 'SA', invoiceType: '1100', location: 'Riyadh', industry: 'Retail', env: 'sandbox' });
    expect(csr).toContain('BEGIN CERTIFICATE REQUEST');
    const dir = mkdtempSync(join(tmpdir(), 'zt-'));
    writeFileSync(join(dir, 'k.pem'), key);
    execSync(`openssl req -new -x509 -key ${join(dir, 'k.pem')} -subj "/CN=test" -days 1 -out ${join(dir, 'c.pem')}`);
    const certB64 = readFileSync(join(dir, 'c.pem'), 'utf8').replace(/-----[^-]+-----|\s/g, '');
    const xml = sample(); const hash = invoiceHashOf(xml);
    const s = signInvoice(xml, hash, key, certB64);
    expect(s.signedXml).toContain('<ds:SignatureValue>');
    const v = createVerify('sha256'); v.update(Buffer.from(hash, 'base64'));
    expect(v.verify(new X509Certificate(readFileSync(join(dir, 'c.pem'))).publicKey, Buffer.from(s.signatureValue, 'base64'))).toBe(true);
    expect(s.certSignature.length).toBeGreaterThan(60);
  });
});

import { createHash } from 'node:crypto';
import { canonicalHashOfFinal } from '../src/services/zatca/xml.js';
import { finalizeInvoiceXml, classifyResponse } from '../src/services/zatca/index.js';
import { keyMatchesCert, resolveSigningKey, SANDBOX_PRIVATE_KEY, generatePrivateKey as genKey, ksaDateTime } from '../src/services/zatca/sign.js';
import { complianceCases } from '../src/routes/branches.js';
import { SANDBOX_CERT_B64 } from './fixtures/zatca-sandbox.js';

describe('ZATCA Phase 2 conformance (matches the official SDK algorithms)', () => {
  const signedDoc = () => finalizeInvoiceXml(sample(), { sellerName: 'متجر', vatNumber: '310123456700003', issuedAt: new Date('2026-11-11T10:00:00Z'), total: 15, taxTotal: 1.96, simplified: true, signing: { privateKeyPem: SANDBOX_PRIVATE_KEY, certificateB64: SANDBOX_CERT_B64 } });

  it('hash equals C14N of the final document after removing UBLExtensions/QR/Signature', () => {
    const d = signedDoc();
    expect(canonicalHashOfFinal(d.xml)).toBe(d.invoiceHash);
    expect(d.xml).toContain(`<ds:DigestValue>${d.invoiceHash}</ds:DigestValue>`);
  });

  it('SignedProperties digest = hex(sha256) of the in-document block with namespaces (SDK method)', () => {
    const { xml } = signedDoc();
    const block = xml.slice(xml.indexOf('<xades:SignedProperties'), xml.indexOf('</xades:SignedProperties>') + 25)
      .replace('<xades:SignedProperties ', '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" ')
      .replace(/<ds:(\w+)/g, '<ds:$1 xmlns:ds="http://www.w3.org/2000/09/xmldsig#"');
    const expected = Buffer.from(createHash('sha256').update(block).digest('hex')).toString('base64');
    expect(xml).toContain(`URI="#xadesSignedProperties">
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                    <ds:DigestValue>${expected}</ds:DigestValue>`);
  });

  it('uses the fixed developer-portal key when the sandbox certificate does not match the branch key', () => {
    const own = genKey();
    expect(keyMatchesCert(own, SANDBOX_CERT_B64)).toBe(false);
    expect(resolveSigningKey(own, SANDBOX_CERT_B64)).toBe(SANDBOX_PRIVATE_KEY);
  });

  it('QR tag 3 matches IssueDate/IssueTime in Riyadh time', () => {
    const d = signedDoc();
    expect(decodeQr(d.qrCode)[3]).toBe('2026-11-11T13:00:00');
    expect(d.xml).toContain('<cbc:IssueDate>2026-11-11</cbc:IssueDate>');
    expect(d.xml).toContain('<cbc:IssueTime>13:00:00</cbc:IssueTime>');
    expect(ksaDateTime(new Date('2026-11-11T22:30:00Z')).date).toBe('2026-11-12');
  });

  it('lists the compliance documents for each certificate type', () => {
    expect(complianceCases('1100')).toHaveLength(6);
    expect(complianceCases('0100').every((c) => c.kind === 'SIMPLIFIED')).toBe(true);
    expect(complianceCases('1000').every((c) => c.kind === 'STANDARD')).toBe(true);
  });

  it('classifies gateway responses', () => {
    expect(classifyResponse(200, { reportingStatus: 'REPORTED' }, 'SIMPLIFIED')).toBe('REPORTED');
    expect(classifyResponse(202, { reportingStatus: 'REPORTED', validationResults: { status: 'WARNING' } }, 'SIMPLIFIED')).toBe('WARNING');
    expect(classifyResponse(200, { clearanceStatus: 'CLEARED' }, 'STANDARD')).toBe('CLEARED');
    expect(classifyResponse(400, { reportingStatus: 'NOT_REPORTED' }, 'SIMPLIFIED')).toBe('REJECTED');
    expect(classifyResponse(503, {}, 'SIMPLIFIED')).toBe('PENDING');
    expect(classifyResponse(401, {}, 'SIMPLIFIED')).toBe('PENDING');
  });
});
