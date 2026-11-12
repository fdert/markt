CREATE TABLE "kitchen_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"station_id" integer,
	"invoice_id" integer,
	"held_cart_id" integer,
	"order_no" integer,
	"order_type" text,
	"table_name" text,
	"customer_name" text,
	"items" jsonb NOT NULL,
	"notes" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kitchen_stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"printer" text,
	"show_on_screen" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'OTHER' NOT NULL,
	"account_key" text DEFAULT 'BANK' NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"commission_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_methods_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"price_list_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"unit_id" integer,
	"price" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"adjust_percent" numeric(6, 2) DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"area" text,
	"seats" integer DEFAULT 4 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktake_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"stocktake_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"system_qty" numeric(14, 3) NOT NULL,
	"counted_qty" numeric(14, 3),
	"unit_cost" numeric(14, 4) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"notes" text,
	"user_id" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocktakes_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"type" text NOT NULL,
	"method" text,
	"invoice_id" integer,
	"note" text,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "wallet_balance" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "price_list_id" integer;--> statement-breakpoint
ALTER TABLE "held_carts" ADD COLUMN "table_id" integer;--> statement-breakpoint
ALTER TABLE "held_carts" ADD COLUMN "order_type" text;--> statement-breakpoint
ALTER TABLE "held_carts" ADD COLUMN "order_no" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "order_type" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "order_no" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "table_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "price_list_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rounding" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kitchen_status_idx" ON "kitchen_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "pli_list_product" ON "price_list_items" USING btree ("price_list_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktake_product" ON "stocktake_items" USING btree ("stocktake_id","product_id");