CREATE TABLE "accounting_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parent_id" integer,
	"system_key" text,
	"is_group" boolean DEFAULT false NOT NULL,
	CONSTRAINT "accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "accounts_system_key_unique" UNIQUE("system_key")
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer,
	"summary" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"type" text DEFAULT 'BRANCH' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"phone" text,
	"city" text,
	"district" text,
	"street" text,
	"building_no" text,
	"additional_no" text,
	"postal_code" text,
	"cr_number" text,
	"active" boolean DEFAULT true NOT NULL,
	"zatca_enabled" boolean DEFAULT false NOT NULL,
	"zatca_paused" boolean DEFAULT false NOT NULL,
	"zatca_env" text DEFAULT 'sandbox' NOT NULL,
	"egs_serial" text,
	"zatca_private_key" text,
	"zatca_csr" text,
	"compliance_csid" text,
	"compliance_secret" text,
	"production_csid" text,
	"production_secret" text,
	"icv_counter" integer DEFAULT 0 NOT NULL,
	"last_invoice_hash" text DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"description" text,
	"image" text,
	"parent_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"max_discount" numeric(14, 2),
	"free_shipping" boolean DEFAULT false NOT NULL,
	"channel" text DEFAULT 'ALL' NOT NULL,
	"min_order" numeric(14, 2),
	"usage_limit" integer,
	"per_customer" integer,
	"customer_id" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"total_granted" numeric(14, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"type" text DEFAULT 'INDIVIDUAL' NOT NULL,
	"gender" text,
	"active" boolean DEFAULT true NOT NULL,
	"vat_number" text,
	"cr_number" text,
	"country" text DEFAULT 'SA',
	"city" text,
	"district" text,
	"street" text,
	"building_no" text,
	"additional_no" text,
	"postal_code" text,
	"short_address" text,
	"lat" double precision,
	"lng" double precision,
	"loyalty_points" numeric(14, 2) DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"account_id" integer
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"category_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"vendor_name" text,
	"vendor_vat" text,
	"payment_method" text DEFAULT 'CASH' NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"recurring" text,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "held_carts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"label" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"product_id" integer,
	"unit_id" integer,
	"unit_name" text,
	"unit_factor" numeric(14, 3) DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"barcode" text,
	"qty" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"discount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"tax_amount" numeric(14, 2) NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"unit_cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"returned_qty" numeric(14, 3) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"uuid" text NOT NULL,
	"kind" text DEFAULT 'SIMPLIFIED' NOT NULL,
	"type" text DEFAULT 'INVOICE' NOT NULL,
	"status" text DEFAULT 'PAID' NOT NULL,
	"channel" text DEFAULT 'POS' NOT NULL,
	"branch_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"customer_id" integer,
	"shift_id" integer,
	"original_id" integer,
	"subtotal" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"shipping" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"paid" numeric(14, 2) DEFAULT 0 NOT NULL,
	"due" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cost_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"coupon_code" text,
	"offer_discount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"loyalty_used" numeric(14, 2) DEFAULT 0 NOT NULL,
	"is_employee_sale" boolean DEFAULT false NOT NULL,
	"notes" text,
	"private_note" text,
	"return_reason" text,
	"supply_date" timestamp with time zone,
	"icv" integer,
	"previous_hash" text,
	"invoice_hash" text,
	"qr_code" text,
	"zatca_status" text DEFAULT 'NOT_REQUIRED' NOT NULL,
	"zatca_response" jsonb,
	"xml" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"ref_type" text,
	"ref_id" integer,
	"branch_id" integer,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"debit" numeric(14, 2) DEFAULT 0 NOT NULL,
	"credit" numeric(14, 2) DEFAULT 0 NOT NULL,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"badge" text,
	"type" text NOT NULL,
	"value" numeric(14, 2) DEFAULT 0 NOT NULL,
	"buy_qty" integer,
	"get_qty" integer,
	"scope" text DEFAULT 'ALL' NOT NULL,
	"category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channel" text DEFAULT 'ALL' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"stack_coupons" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer,
	"shift_id" integer,
	"method" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reference" text,
	"note" text,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"factor" numeric(14, 3) DEFAULT 1 NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"barcode" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'SIMPLE' NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"sku" text,
	"barcode" text,
	"category_id" integer,
	"brand_id" integer,
	"unit_name" text DEFAULT 'حبة' NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"avg_cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"tax_included" boolean DEFAULT true NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"discount_price" numeric(14, 2),
	"is_weighted" boolean DEFAULT false NOT NULL,
	"price_per_weight" numeric(14, 2),
	"unlimited" boolean DEFAULT false NOT NULL,
	"expiry_date" timestamp with time zone,
	"pos_enabled" boolean DEFAULT true NOT NULL,
	"online_enabled" boolean DEFAULT true NOT NULL,
	"requires_shipping" boolean DEFAULT true NOT NULL,
	"non_returnable" boolean DEFAULT false NOT NULL,
	"low_stock_alert" numeric(14, 3),
	"is_composite" boolean DEFAULT false NOT NULL,
	"rental_rate" numeric(14, 2),
	"rental_unit" text,
	"deposit_amount" numeric(14, 2),
	"description" text,
	"short_description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"tax_amount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"expiry_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"is_return" boolean DEFAULT false NOT NULL,
	"supplier_id" integer,
	"branch_id" integer NOT NULL,
	"supplier_invoice_no" text,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"paid" numeric(14, 2) DEFAULT 0 NOT NULL,
	"payment_method" text DEFAULT 'CASH' NOT NULL,
	"notes" text,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "recipe_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"qty" numeric(14, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rentals" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"customer_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"qty" numeric(14, 3) DEFAULT 1 NOT NULL,
	"invoice_id" integer,
	"start_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"returned_at" timestamp with time zone,
	"deposit" numeric(14, 2) DEFAULT 0 NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rentals_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"shift_id" integer NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opening_cash" numeric(14, 2) DEFAULT 0 NOT NULL,
	"counted_cash" numeric(14, 2),
	"expected_cash" numeric(14, 2),
	"difference" numeric(14, 2),
	"diff_reason" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"type" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"balance_after" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 4),
	"ref_type" text,
	"ref_id" integer,
	"note" text,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"reserved" numeric(14, 3) DEFAULT 0 NOT NULL,
	"counted" boolean DEFAULT false NOT NULL,
	"alert_level" numeric(14, 3)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"vat_number" text,
	"cr_number" text,
	"city" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"qty" numeric(14, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"from_branch_id" integer NOT NULL,
	"to_branch_id" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"user_id" integer,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"pin" text,
	"role" text DEFAULT 'CASHIER' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_discount" numeric(5, 2),
	"active" boolean DEFAULT true NOT NULL,
	"branch_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_component_id_products_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_entries" ADD CONSTRAINT "shift_entries_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "invoices_created_idx" ON "invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "invoices_branch_idx" ON "invoices" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "journal_ref_idx" ON "journal_entries" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "units_barcode_idx" ON "product_units" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "products_barcode_idx" ON "products" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");--> statement-breakpoint
CREATE INDEX "movements_product_idx" ON "stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_product_branch" ON "stocks" USING btree ("product_id","branch_id");