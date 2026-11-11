export interface CartLine {
  key: string;
  productId: number | null;
  unitId: number | null;
  name: string;
  price: number; // السعر الشامل للوحدة
  qty: number;
  isWeighted?: boolean;
  stock?: number;
  unlimited?: boolean;
  priceOverride?: boolean;
  manual?: { taxable: boolean };
  lineDiscount?: number;
  barcode?: string | null;
}

export interface Customer { id: number; name: string; phone?: string | null; vatNumber?: string | null; type?: string; loyaltyPoints?: number; due?: number }

export interface Preview {
  lines: Array<{ name: string; total: number; offerDiscount: number; offerName?: string; taxAmount: number }>;
  subtotal: number; discount: number; offerDiscount: number; couponDiscount: number; manualDiscount: number; loyaltyDiscount: number;
  taxTotal: number; total: number; appliedOffers: string[];
}

export interface LookupResult { productId: number; unitId: number | null; name: string; price: number; qty: number | null; isWeighted: boolean; stock: number; unlimited: boolean; barcode: string; expiryDate: string | null }

export interface Shift {
  id: number; status: string; opening_cash: string; expected_cash: number; cash_sales: number; card_sales: number; transfer_sales: number; cash_in: number; cash_out: number;
  sales_total: number; returns_total: number; invoices_count: number; credit_sales: number; opened_at: string; closed_at: string | null; user_name: string; branch_name: string;
  counted_cash: string | null; difference: string | null; entries: Array<{ id: number; type: string; amount: number; note: string; createdAt: string }>;
}
