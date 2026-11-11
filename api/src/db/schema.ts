// مخطط قاعدة البيانات لنظام رصيد (Drizzle ORM + PostgreSQL)
import {
  pgTable, serial, integer, text, boolean, timestamp, numeric, jsonb, uniqueIndex, index, doublePrecision,
} from 'drizzle-orm/pg-core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });
const cost = (name: string) => numeric(name, { precision: 14, scale: 4, mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  pin: text('pin'),
  role: text('role').notNull().default('CASHIER'), // OWNER | MANAGER | ACCOUNTANT | CASHIER | STOREKEEPER
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  maxDiscount: numeric('max_discount', { precision: 5, scale: 2, mode: 'number' }),
  active: boolean('active').notNull().default(true),
  branchId: integer('branch_id'),
  createdAt: createdAt(),
});

export const branches = pgTable('branches', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  nameEn: text('name_en'),
  type: text('type').notNull().default('BRANCH'), // BRANCH | WAREHOUSE
  isDefault: boolean('is_default').notNull().default(false),
  phone: text('phone'),
  city: text('city'),
  district: text('district'),
  street: text('street'),
  buildingNo: text('building_no'),
  additionalNo: text('additional_no'),
  postalCode: text('postal_code'),
  crNumber: text('cr_number'),
  active: boolean('active').notNull().default(true),
  // وحدة الإصدار (EGS) للمرحلة الثانية من الفوترة الإلكترونية
  zatcaEnabled: boolean('zatca_enabled').notNull().default(false),
  zatcaPaused: boolean('zatca_paused').notNull().default(false),
  zatcaEnv: text('zatca_env').notNull().default('sandbox'),
  egsSerial: text('egs_serial'),
  zatcaPrivateKey: text('zatca_private_key'),
  zatcaCsr: text('zatca_csr'),
  complianceCsid: text('compliance_csid'),
  complianceSecret: text('compliance_secret'),
  productionCsid: text('production_csid'),
  productionSecret: text('production_secret'),
  icvCounter: integer('icv_counter').notNull().default(0),
  lastInvoiceHash: text('last_invoice_hash').notNull()
    .default('NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='),
  createdAt: createdAt(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  nameEn: text('name_en'),
  description: text('description'),
  image: text('image'),
  parentId: integer('parent_id'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const brands = pgTable('brands', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  type: text('type').notNull().default('SIMPLE'), // SIMPLE | PRO | SERVICE | RENTAL | DIGITAL
  name: text('name').notNull(),
  nameEn: text('name_en'),
  sku: text('sku'),
  barcode: text('barcode'),
  categoryId: integer('category_id'),
  brandId: integer('brand_id'),
  unitName: text('unit_name').notNull().default('حبة'),
  price: money('price').notNull(),
  cost: cost('cost').notNull().default(0),
  avgCost: cost('avg_cost').notNull().default(0),
  taxIncluded: boolean('tax_included').notNull().default(true),
  taxable: boolean('taxable').notNull().default(true),
  discountPrice: money('discount_price'),
  isWeighted: boolean('is_weighted').notNull().default(false),
  pricePerWeight: money('price_per_weight'),
  unlimited: boolean('unlimited').notNull().default(false),
  expiryDate: timestamp('expiry_date', { withTimezone: true }),
  posEnabled: boolean('pos_enabled').notNull().default(true),
  onlineEnabled: boolean('online_enabled').notNull().default(true),
  requiresShipping: boolean('requires_shipping').notNull().default(true),
  nonReturnable: boolean('non_returnable').notNull().default(false),
  lowStockAlert: qty('low_stock_alert'),
  isComposite: boolean('is_composite').notNull().default(false),
  rentalRate: money('rental_rate'),
  rentalUnit: text('rental_unit'),
  depositAmount: money('deposit_amount'),
  description: text('description'),
  shortDescription: text('short_description'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  image: text('image'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('products_barcode_idx').on(t.barcode), index('products_name_idx').on(t.name)]);

export const productUnits = pgTable('product_units', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  factor: qty('factor').notNull().default(1),
  price: money('price').notNull(),
  barcode: text('barcode'),
  active: boolean('active').notNull().default(true),
}, (t) => [index('units_barcode_idx').on(t.barcode)]);

export const recipeItems = pgTable('recipe_items', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  componentId: integer('component_id').notNull().references(() => products.id),
  qty: qty('qty').notNull(),
});

export const stocks = pgTable('stocks', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  branchId: integer('branch_id').notNull().references(() => branches.id),
  qty: qty('qty').notNull().default(0),
  reserved: qty('reserved').notNull().default(0),
  counted: boolean('counted').notNull().default(false),
  alertLevel: qty('alert_level'),
}, (t) => [uniqueIndex('stock_product_branch').on(t.productId, t.branchId)]);

export const stockMovements = pgTable('stock_movements', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  branchId: integer('branch_id').notNull(),
  type: text('type').notNull(), // OPENING | SALE | RETURN | PURCHASE | PURCHASE_RETURN | ADJUST | TRANSFER_IN | TRANSFER_OUT | ISSUE | RENTAL_OUT | RENTAL_IN
  qty: qty('qty').notNull(),
  balanceAfter: qty('balance_after').notNull(),
  unitCost: cost('unit_cost'),
  refType: text('ref_type'),
  refId: integer('ref_id'),
  note: text('note'),
  userId: integer('user_id'),
  createdAt: createdAt(),
}, (t) => [index('movements_product_idx').on(t.productId, t.createdAt)]);

export const transfers = pgTable('transfers', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  fromBranchId: integer('from_branch_id').notNull(),
  toBranchId: integer('to_branch_id').notNull(),
  status: text('status').notNull().default('DRAFT'), // DRAFT | IN_TRANSIT | RECEIVED | CANCELLED
  notes: text('notes'),
  userId: integer('user_id'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const transferItems = pgTable('transfer_items', {
  id: serial('id').primaryKey(),
  transferId: integer('transfer_id').notNull().references(() => transfers.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull(),
  qty: qty('qty').notNull(),
});

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  type: text('type').notNull().default('INDIVIDUAL'), // INDIVIDUAL | COMPANY | GOVERNMENT | NGO
  gender: text('gender'),
  active: boolean('active').notNull().default(true),
  vatNumber: text('vat_number'),
  crNumber: text('cr_number'),
  country: text('country').default('SA'),
  city: text('city'),
  district: text('district'),
  street: text('street'),
  buildingNo: text('building_no'),
  additionalNo: text('additional_no'),
  postalCode: text('postal_code'),
  shortAddress: text('short_address'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  loyaltyPoints: money('loyalty_points').notNull().default(0),
  notes: text('notes'),
  createdAt: createdAt(),
}, (t) => [index('customers_phone_idx').on(t.phone)]);

export const shifts = pgTable('shifts', {
  id: serial('id').primaryKey(),
  branchId: integer('branch_id').notNull(),
  userId: integer('user_id').notNull(),
  status: text('status').notNull().default('OPEN'), // OPEN | CLOSED | REVIEWED
  openingCash: money('opening_cash').notNull().default(0),
  countedCash: money('counted_cash'),
  expectedCash: money('expected_cash'),
  difference: money('difference'),
  diffReason: text('diff_reason'),
  openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const shiftEntries = pgTable('shift_entries', {
  id: serial('id').primaryKey(),
  shiftId: integer('shift_id').notNull().references(() => shifts.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // CASH_IN | CASH_OUT | EXPENSE
  amount: money('amount').notNull(),
  note: text('note'),
  createdAt: createdAt(),
});

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  uuid: text('uuid').notNull().unique(),
  kind: text('kind').notNull().default('SIMPLIFIED'), // SIMPLIFIED | STANDARD
  type: text('type').notNull().default('INVOICE'), // INVOICE | CREDIT_NOTE | QUOTE
  status: text('status').notNull().default('PAID'), // DRAFT | PAID | PARTIAL | UNPAID | RETURNED | PARTIALLY_RETURNED | CANCELLED
  channel: text('channel').notNull().default('POS'), // POS | ONLINE | ORDER
  branchId: integer('branch_id').notNull(),
  userId: integer('user_id').notNull(),
  customerId: integer('customer_id'),
  shiftId: integer('shift_id'),
  originalId: integer('original_id'),
  subtotal: money('subtotal').notNull(),
  discount: money('discount').notNull().default(0),
  shipping: money('shipping').notNull().default(0),
  taxTotal: money('tax_total').notNull(),
  total: money('total').notNull(),
  paid: money('paid').notNull().default(0),
  due: money('due').notNull().default(0),
  costTotal: money('cost_total').notNull().default(0),
  couponCode: text('coupon_code'),
  offerDiscount: money('offer_discount').notNull().default(0),
  loyaltyUsed: money('loyalty_used').notNull().default(0),
  isEmployeeSale: boolean('is_employee_sale').notNull().default(false),
  notes: text('notes'),
  privateNote: text('private_note'),
  returnReason: text('return_reason'),
  supplyDate: timestamp('supply_date', { withTimezone: true }),
  icv: integer('icv'),
  previousHash: text('previous_hash'),
  invoiceHash: text('invoice_hash'),
  qrCode: text('qr_code'),
  zatcaStatus: text('zatca_status').notNull().default('NOT_REQUIRED'), // NOT_REQUIRED | PENDING | REPORTED | CLEARED | REJECTED | WARNING
  zatcaResponse: jsonb('zatca_response'),
  xml: text('xml'),
  createdAt: createdAt(),
}, (t) => [index('invoices_created_idx').on(t.createdAt), index('invoices_branch_idx').on(t.branchId, t.createdAt)]);

export const invoiceItems = pgTable('invoice_items', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  productId: integer('product_id'),
  unitId: integer('unit_id'),
  unitName: text('unit_name'),
  unitFactor: qty('unit_factor').notNull().default(1),
  name: text('name').notNull(),
  barcode: text('barcode'),
  qty: qty('qty').notNull(),
  unitPrice: cost('unit_price').notNull(), // قبل الضريبة
  discount: money('discount').notNull().default(0),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  taxAmount: money('tax_amount').notNull(),
  netAmount: money('net_amount').notNull(), // بعد الخصم وقبل الضريبة
  total: money('total').notNull(), // شامل الضريبة
  unitCost: cost('unit_cost').notNull().default(0),
  returnedQty: qty('returned_qty').notNull().default(0),
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }),
  shiftId: integer('shift_id'),
  method: text('method').notNull(), // CASH | CARD | BANK_TRANSFER | CREDIT | LOYALTY | OTHER
  amount: money('amount').notNull(),
  reference: text('reference'),
  note: text('note'),
  userId: integer('user_id'),
  createdAt: createdAt(),
});

export const heldCarts = pgTable('held_carts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  branchId: integer('branch_id').notNull(),
  label: text('label'),
  data: jsonb('data').notNull(),
  createdAt: createdAt(),
});

export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  vatNumber: text('vat_number'),
  crNumber: text('cr_number'),
  city: text('city'),
  address: text('address'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const purchases = pgTable('purchases', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  isReturn: boolean('is_return').notNull().default(false),
  supplierId: integer('supplier_id'),
  branchId: integer('branch_id').notNull(),
  supplierInvoiceNo: text('supplier_invoice_no'),
  date: timestamp('date', { withTimezone: true }).defaultNow().notNull(),
  status: text('status').notNull().default('DRAFT'), // DRAFT | APPROVED | CANCELLED
  subtotal: money('subtotal').notNull(),
  taxTotal: money('tax_total').notNull(),
  total: money('total').notNull(),
  paid: money('paid').notNull().default(0),
  paymentMethod: text('payment_method').notNull().default('CASH'),
  notes: text('notes'),
  userId: integer('user_id'),
  createdAt: createdAt(),
});

export const purchaseItems = pgTable('purchase_items', {
  id: serial('id').primaryKey(),
  purchaseId: integer('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull(),
  qty: qty('qty').notNull(),
  unitCost: cost('unit_cost').notNull(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  taxAmount: money('tax_amount').notNull(),
  total: money('total').notNull(),
  expiryDate: timestamp('expiry_date', { withTimezone: true }),
});

export const expenseCategories = pgTable('expense_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  accountId: integer('account_id'),
});

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  categoryId: integer('category_id').notNull(),
  branchId: integer('branch_id').notNull(),
  amount: money('amount').notNull(),
  taxAmount: money('tax_amount').notNull().default(0),
  total: money('total').notNull(),
  vendorName: text('vendor_name'),
  vendorVat: text('vendor_vat'),
  paymentMethod: text('payment_method').notNull().default('CASH'),
  date: timestamp('date', { withTimezone: true }).defaultNow().notNull(),
  notes: text('notes'),
  recurring: text('recurring'),
  userId: integer('user_id'),
  createdAt: createdAt(),
});

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(), // ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
  parentId: integer('parent_id'),
  systemKey: text('system_key').unique(),
  isGroup: boolean('is_group').notNull().default(false),
});

export const journalEntries = pgTable('journal_entries', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  date: timestamp('date', { withTimezone: true }).defaultNow().notNull(),
  description: text('description').notNull(),
  refType: text('ref_type'),
  refId: integer('ref_id'),
  branchId: integer('branch_id'),
  userId: integer('user_id'),
  createdAt: createdAt(),
}, (t) => [index('journal_ref_idx').on(t.refType, t.refId)]);

export const journalLines = pgTable('journal_lines', {
  id: serial('id').primaryKey(),
  entryId: integer('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull(),
  debit: money('debit').notNull().default(0),
  credit: money('credit').notNull().default(0),
  memo: text('memo'),
});

export const accountingPeriods = pgTable('accounting_periods', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  closed: boolean('closed').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const coupons = pgTable('coupons', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  type: text('type').notNull(), // AMOUNT | PERCENT
  value: money('value').notNull(),
  maxDiscount: money('max_discount'),
  freeShipping: boolean('free_shipping').notNull().default(false),
  channel: text('channel').notNull().default('ALL'), // ALL | ONLINE | POS
  minOrder: money('min_order'),
  usageLimit: integer('usage_limit'),
  perCustomer: integer('per_customer'),
  customerId: integer('customer_id'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  active: boolean('active').notNull().default(true),
  usedCount: integer('used_count').notNull().default(0),
  totalGranted: money('total_granted').notNull().default(0),
  createdAt: createdAt(),
});

export const offers = pgTable('offers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  badge: text('badge'),
  type: text('type').notNull(), // PERCENT | AMOUNT | BXGY | BUNDLE
  value: money('value').notNull().default(0),
  buyQty: integer('buy_qty'),
  getQty: integer('get_qty'),
  scope: text('scope').notNull().default('ALL'), // ALL | CATEGORIES | PRODUCTS
  categoryIds: jsonb('category_ids').$type<number[]>().notNull().default([]),
  productIds: jsonb('product_ids').$type<number[]>().notNull().default([]),
  excludedIds: jsonb('excluded_ids').$type<number[]>().notNull().default([]),
  channel: text('channel').notNull().default('ALL'),
  startsAt: timestamp('starts_at', { withTimezone: true }).defaultNow().notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
  stackCoupons: boolean('stack_coupons').notNull().default(true),
  createdAt: createdAt(),
});

export const rentals = pgTable('rentals', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  customerId: integer('customer_id').notNull(),
  branchId: integer('branch_id').notNull(),
  productId: integer('product_id').notNull(),
  qty: qty('qty').notNull().default(1),
  invoiceId: integer('invoice_id'),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  deposit: money('deposit').notNull().default(0),
  amount: money('amount').notNull(),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | RETURNED | CANCELLED
  notes: text('notes'),
  createdAt: createdAt(),
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: integer('entity_id'),
  summary: text('summary').notNull(),
  data: jsonb('data'),
  createdAt: createdAt(),
}, (t) => [index('activity_created_idx').on(t.createdAt)]);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: integer('value').notNull().default(0),
});
