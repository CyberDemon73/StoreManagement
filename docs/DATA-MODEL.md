# Data model (Postgres / Drizzle)

Conventions: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz` (trigger or app-set). Money columns are `integer` **minor units** (piastres). Soft-delete via `status`/`archived_at`; never hard-delete rows referenced by movements or sales.

## auth
```
users
  id, name text, email citext unique, password_hash text, role enum(ADMIN,MANAGER,SELLER),
  status enum(ACTIVE,DISABLED) default ACTIVE, must_change_password bool default false,
  last_login_at timestamptz, created_at, updated_at

sessions
  id (random 32-byte token hash as pk — store hash, not raw), user_id fk, user_agent text, ip inet,
  created_at, last_seen_at, expires_at (absolute), idle_expires_at
  index(user_id)

password_reset_tokens
  id, user_id fk, token_hash text unique, purpose enum(RESET,INVITE), expires_at, used_at
  
failed_logins   -- DB table (chosen over Redis so lockout works in tests and is auditable)
  email citext pk, ip inet, count int default 0, locked_until timestamptz null, updated_at
```

## catalog
```
brands        id, name text unique, logo_url text, is_active bool default true, created_at, updated_at
categories    id, name text, parent_id fk null, is_active bool default true, unique(name, parent_id)
suppliers     id, name text, phone text, notes text, is_active bool default true

products
  id, name text, brand_id fk, category_id fk, description text, base_sku text unique,
  images jsonb default '[]' (string[]), default_cost int null, default_price int,
  status enum(ACTIVE,ARCHIVED) default ACTIVE, tags text[] default '{}',
  created_by fk users null (set null on delete), created_at, updated_at
  index(brand_id), index(category_id), index(status), gin trigram index on name, index(base_sku)

variants
  id, product_id fk, size text, color_name text, color_hex char(7),
  sku text unique, barcode text unique null,
  cost_price int null (weighted average, updated on PURCHASE), sell_price int,
  quantity int not null default 0 check(quantity >= 0 OR allow_negative),  -- enforce in app
  low_stock_threshold int default from settings, is_active bool default true,
  created_at, updated_at
  unique(product_id, size, color_name), index(product_id), index(quantity)
```

## stock
```
stock_movements   -- immutable; never UPDATE or DELETE. Live since Sprint 1 (applyMovement in src/services/stock.ts)
  id, variant_id fk, type enum(INITIAL,PURCHASE,SALE,RETURN,ADJUSTMENT),
  qty_delta int not null (sign matters), unit_cost int null,
  reference_kind enum(sale,purchase,return,count) null, reference_id uuid null,
  reason text null, user_id fk, created_at
  index(variant_id, created_at desc), index(reference_kind, reference_id), index(created_at)

purchases
  id, supplier_id fk null, invoice_ref text, total int, received_at timestamptz, note text,
  created_by fk, created_at
purchase_items
  id, purchase_id fk, variant_id fk, qty int, unit_cost int

stock_counts
  id, status enum(OPEN,APPLIED,CANCELLED), started_by fk, started_at, applied_at, applied_by fk, note
stock_count_items
  id, count_id fk, variant_id fk, system_qty int (snapshot at start), counted_qty int null, counted_by fk, counted_at
  unique(count_id, variant_id)
```

## sales
```
sale_counters     prefix text pk, next int      -- row locked to allocate numbers
sales
  id, number text unique (e.g. AS-000123), seller_id fk,
  subtotal int, discount int, discount_pct numeric(5,2) null, total int,
  payment_method enum(CASH,CARD,WALLET,TRANSFER),
  status enum(COMPLETED,PARTIALLY_REFUNDED,REFUNDED,VOID) default COMPLETED,
  customer_name text, customer_phone text, note text,
  idempotency_key text unique null, voided_at, voided_by fk, void_reason text,
  created_at
  index(created_at), index(seller_id, created_at), index(status)
sale_items
  id, sale_id fk, variant_id fk, qty int, unit_price int, unit_cost int (snapshot), line_total int
  index(sale_id), index(variant_id)

returns
  id, sale_id fk, refund_amount int, refund_method enum(as payment), reason text, created_by fk, created_at
return_items
  id, return_id fk, sale_item_id fk, qty int, restock bool

parked_sales
  id, user_id fk, payload jsonb (cart), created_at, expires_at   -- max 3 per user, 24h TTL
```

## system
```
settings  (single row: id integer pk default 1, check(id = 1))
  store_name, logo_url, phone, address, currency char(3) default 'EGP', timezone text default 'Africa/Cairo',
  low_stock_default int default 3, sale_number_prefix text default 'AS',
  seller_discount_cap_pct numeric(5,2) default 10, allow_negative_stock bool default false,
  receipt_header text, receipt_footer text, size_presets jsonb, color_presets jsonb,
  session_idle_hours int default 12, session_absolute_days int default 30, updated_at

audit_log
  id, user_id fk null, action text (e.g. 'sale.create'), entity text, entity_id uuid null,
  before jsonb, after jsonb, ip inet, user_agent text, created_at
  index(created_at desc), index(entity, entity_id), index(user_id)

notifications
  id, user_id fk null (null = all managers), kind enum(LOW_STOCK,LARGE_REFUND,NEW_DEVICE_LOGIN),
  payload jsonb, read_at, created_at
```

## Derived rules
- `variants.quantity` **must equal** `Σ stock_movements.qty_delta` for that variant. `pnpm stock:verify` asserts it.
- Weighted-average cost on PURCHASE/INITIAL: `new_cost = round((old_qty*old_cost + in_qty*in_cost) / (old_qty+in_qty))`. SALE/RETURN/ADJUSTMENT do not change cost (RETURN with restock uses the snapshot cost from the sale item).
- Gross profit for a period = `Σ sale_items(line_total − unit_cost*qty)` for sales in period with status ≠ VOID, minus `Σ returns.refund_amount` adjusted by restocked cost (returned item cost comes back into stock, so profit impact = refund − unit_cost*qty for restocked lines; = refund for non-restocked).
- "Low stock" = `quantity > 0 AND quantity <= low_stock_threshold`; "out" = `quantity <= 0`.
