// التوقيع الرقمي (XAdES) وإنشاء المفاتيح وطلب الشهادة (CSR) لوحدة الإصدار
import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function generatePrivateKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return privateKey.export({ type: 'sec1', format: 'pem' }).toString();
}

export interface CsrInput {
  commonName: string; serialNumber: string; organizationIdentifier: string; organizationUnitName: string;
  organizationName: string; countryName: string; invoiceType: string; location: string; industry: string;
  env: 'sandbox' | 'simulation' | 'production';
}

/** إنشاء طلب الشهادة عبر OpenSSL بالقالب الذي تشترطه الهيئة */
export function generateCsr(privateKeyPem: string, i: CsrInput): string {
  const template = i.env === 'production' ? 'ZATCA-Code-Signing' : i.env === 'simulation' ? 'PREZATCA-Code-Signing' : 'TSTZATCA-Code-Signing';
  const dir = mkdtempSync(join(tmpdir(), 'zatca-'));
  try {
    const cnf = `oid_section = OIDs
[ OIDs ]
certificateTemplateName = 1.3.6.1.4.1.311.20.2
[ req ]
default_bits = 2048
emailAddress = it@example.com
req_extensions = v3_req
prompt = no
default_md = sha256
distinguished_name = dn
[ dn ]
C = ${i.countryName}
OU = ${i.organizationUnitName}
O = ${i.organizationName}
CN = ${i.commonName}
[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment
certificateTemplateName = ASN1:PRINTABLESTRING:${template}
subjectAltName = dirName:alt_names
[ alt_names ]
SN = ${i.serialNumber}
UID = ${i.organizationIdentifier}
title = ${i.invoiceType}
registeredAddress = ${i.location}
businessCategory = ${i.industry}
`;
    writeFileSync(join(dir, 'csr.cnf'), cnf);
    writeFileSync(join(dir, 'key.pem'), privateKeyPem);
    execFileSync('openssl', ['req', '-new', '-sha256', '-key', join(dir, 'key.pem'), '-config', join(dir, 'csr.cnf'), '-out', join(dir, 'csr.pem')]);
    return readFileSync(join(dir, 'csr.pem'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const certPem = (b64: string) => `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`;

/** يستخرج قيمة توقيع الشهادة (آخر BIT STRING في بنية DER) */
export function certificateSignature(der: Buffer): Buffer {
  const readLen = (pos: number): [number, number] => {
    const first = der[pos];
    if (first < 0x80) return [first, 1];
    const n = first & 0x7f; let len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | der[pos + 1 + k];
    return [len, 1 + n];
  };
  // SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  let p = 1; const [, l0] = readLen(p); p += l0;
  for (let k = 0; k < 2; k++) { const [len, ll] = readLen(p + 1); p += 1 + ll + len; }
  const [sigLen, sl] = readLen(p + 1);
  return der.subarray(p + 1 + sl + 1, p + 1 + sl + sigLen); // تجاوز بايت البتات غير المستخدمة
}

export interface SignResult { signedXml: string; signatureValue: string; publicKey: Buffer; certSignature: Buffer }

/**
 * توقيع الفاتورة: يُوقَّع ملخص البصمة بمفتاح secp256k1 ويُضاف بلوك UBLExtensions.
 * certificateB64: الشهادة الثنائية (binarySecurityToken بعد فك base64).
 */
export function signInvoice(xml: string, invoiceHash: string, privateKeyPem: string, certificateB64: string, signingTime = new Date()): SignResult {
  const signer = createSign('sha256');
  signer.update(Buffer.from(invoiceHash, 'base64'));
  const signatureValue = signer.sign(privateKeyPem).toString('base64');

  const x509 = new X509Certificate(certPem(certificateB64));
  const certHash = Buffer.from(createHash('sha256').update(certificateB64).digest('hex')).toString('base64');
  const issuer = x509.issuer.split('\n').reverse().join(', ');
  const serial = BigInt('0x' + x509.serialNumber).toString();
  const time = signingTime.toISOString().slice(0, 19);

  const signedPropsForHash = `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${time}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certHash}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${issuer}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${serial}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;
  const signedPropsHash = Buffer.from(createHash('sha256').update(signedPropsForHash).digest('hex')).toString('base64');
  // في المستند: تُحذف تعريفات النطاقات الموروثة من الأب (كما تفعل أداة الهيئة)، والبصمة تُحسب على الصيغة الكاملة
  const signedPropsInDoc = signedPropsForHash
    .replace(/ xmlns:ds="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"/g, '')
    .replace(' xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"', '');

  const ext = `${'\n    '}<ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
            <ext:ExtensionContent>
                <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
                    <sac:SignatureInformation>
                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                        <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
                        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
                            <ds:SignedInfo>
                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
                                <ds:Reference Id="invoiceSignedData" URI="">
                                    <ds:Transforms>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                    </ds:Transforms>
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                    <ds:DigestValue>${invoiceHash}</ds:DigestValue>
                                </ds:Reference>
                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                    <ds:DigestValue>${signedPropsHash}</ds:DigestValue>
                                </ds:Reference>
                            </ds:SignedInfo>
                            <ds:SignatureValue>${signatureValue}</ds:SignatureValue>
                            <ds:KeyInfo>
                                <ds:X509Data>
                                    <ds:X509Certificate>${certificateB64}</ds:X509Certificate>
                                </ds:X509Data>
                            </ds:KeyInfo>
                            <ds:Object>
                                <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">
                                ${signedPropsInDoc}
                                </xades:QualifyingProperties>
                            </ds:Object>
                        </ds:Signature>
                    </sac:SignatureInformation>
                </sig:UBLDocumentSignatures>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>`;

  const der = Buffer.from(certificateB64, 'base64');
  return {
    signedXml: xml.replace('<!--UBL_EXTENSIONS-->', ext),
    signatureValue,
    publicKey: x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    certSignature: certificateSignature(der),
  };
}

/**
 * بيئة المطوّرين (developer-portal) تعيد دائماً شهادة ثابتة مرتبطة بمفتاح معروف،
 * أياً كان المفتاح المستخدم في طلب الشهادة؛ لذا يجب التوقيع بهذا المفتاح هناك وإلا فشل التحقق من التوقيع.
 */
export const SANDBOX_PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIL14JV+5nr/sE8Sppaf2IySovrhVBtt8+yz+g4NRKyz8oAcGBSuBBAAK
oUQDQgAEoWCKa0Sa9FIErTOv0uAkC1VIKXxU9nPpx2vlf4yhMejy8c02XJblDq7t
Pydo8mq0ahOMmNo8gwni7Xt1KT9UeA==
-----END EC PRIVATE KEY-----
`;

/** هل يطابق المفتاح الخاص المفتاح العام في الشهادة؟ */
export function keyMatchesCert(privateKeyPem: string, certificateB64: string): boolean {
  const pub = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' }) as Buffer;
  const certPub = new X509Certificate(certPem(certificateB64)).publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return pub.equals(certPub);
}

/** يختار مفتاح التوقيع الصحيح للشهادة المستلمة (مفتاح الفرع، أو مفتاح بيئة المطوّرين الثابت) */
export function resolveSigningKey(privateKeyPem: string, certificateB64: string): string {
  if (keyMatchesCert(privateKeyPem, certificateB64)) return privateKeyPem;
  if (keyMatchesCert(SANDBOX_PRIVATE_KEY, certificateB64)) return SANDBOX_PRIVATE_KEY;
  throw new Error('الشهادة المستلمة لا تطابق المفتاح الخاص للفرع.');
}

/** التاريخ والوقت بتوقيت الرياض (UTC+3) كما يُطبع على الفاتورة */
export function ksaDateTime(d: Date) {
  const iso = new Date(d.getTime() + 3 * 3600_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19), stamp: iso.slice(0, 19) };
}
