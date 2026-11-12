// توحيد مدخلات قارئ الباركود: يعمل حتى لو كانت لغة لوحة المفاتيح عربية
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
// موضع كل حرف عربي على لوحة المفاتيح (Arabic 101) ← الحرف الإنجليزي في المكان نفسه
const AR_TO_EN: Record<string, string> = {
  'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p', 'ج': '[', 'د': ']',
  'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l', 'ك': ';', 'ط': "'",
  'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'ى': 'n', 'ة': 'm', 'و': ',', 'ز': '.', 'ظ': '/', 'ذ': '`',
  'أ': 'h', 'إ': 'h', 'آ': 'h',
};

export function normalizeScan(raw: string) {
  let s = raw.trim().replace(/لا/g, 'b');
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  if (/[؀-ۿ]/.test(s)) s = [...s].map((ch) => AR_TO_EN[ch] ?? ch).join('').toUpperCase();
  return s;
}
