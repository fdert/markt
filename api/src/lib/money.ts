// أدوات الحساب المالي: التقريب إلى هللتين
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
export const sum = (arr: number[]) => r2(arr.reduce((a, b) => a + b, 0));
