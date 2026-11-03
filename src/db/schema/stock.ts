import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { suppliers, variants } from './catalog';

export const movementTypeEnum = pgEnum('movement_type', ['INITIAL', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT']);
export const referenceKindEnum = pgEnum('reference_kind', ['sale', 'purchase', 'return', 'count']);
export const stockCountStatusEnum = pgEnum('stock_count_status', ['OPEN', 'APPLIED', 'CANCELLED']);

// Immutable ledger: rows are never updated or deleted. variants.quantity == Σ qty_delta == last qty_after.
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'restrict' }),
    type: movementTypeEnum('type').notNull(),
    qtyDelta: integer('qty_delta').notNull(),
    qtyAfter: integer('qty_after').notNull(),
    unitCost: integer('unit_cost'),
    referenceKind: referenceKindEnum('reference_kind'),
    referenceId: uuid('reference_id'),
    reason: text('reason'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_movements_variant_created_idx').on(t.variantId, t.createdAt.desc()),
    index('stock_movements_reference_idx').on(t.referenceKind, t.referenceId),
    index('stock_movements_created_at_idx').on(t.createdAt),
  ],
);

/** Document number sequences (PO purchases, SC counts, AS sales); the row is locked to allocate. */
export const saleCounters = pgTable('sale_counters', {
  prefix: text('prefix').primaryKey(),
  next: integer('next').notNull().default(1),
});

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    number: text('number').notNull().unique(),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    invoiceRef: text('invoice_ref'),
    total: integer('total').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('purchases_received_at_idx').on(t.receivedAt), index('purchases_supplier_id_idx').on(t.supplierId)],
);

export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    unitCost: integer('unit_cost').notNull(),
  },
  (t) => [index('purchase_items_purchase_id_idx').on(t.purchaseId), index('purchase_items_variant_id_idx').on(t.variantId)],
);

export const stockCounts = pgTable('stock_counts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  number: text('number').notNull().unique(),
  status: stockCountStatusEnum('status').notNull().default('OPEN'),
  scope: text('scope').notNull().default('all'),
  startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
  note: text('note'),
});

export const stockCountItems = pgTable(
  'stock_count_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    countId: uuid('count_id')
      .notNull()
      .references(() => stockCounts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'restrict' }),
    systemQty: integer('system_qty').notNull(),
    countedQty: integer('counted_qty'),
    countedBy: uuid('counted_by').references(() => users.id, { onDelete: 'set null' }),
    countedAt: timestamp('counted_at', { withTimezone: true }),
  },
  (t) => [unique('stock_count_items_count_variant_unique').on(t.countId, t.variantId), index('stock_count_items_count_id_idx').on(t.countId)],
);

/** Stored responses for Idempotency-Key replays (24 h); rows older than that are ignored and may be purged. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: integer('status').notNull(),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index('idempotency_keys_created_at_idx').on(t.createdAt)],
);

export type StockMovementRow = typeof stockMovements.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
export type PurchaseItemRow = typeof purchaseItems.$inferSelect;
export type StockCountRow = typeof stockCounts.$inferSelect;
export type StockCountItemRow = typeof stockCountItems.$inferSelect;
