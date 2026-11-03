import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { variants } from './catalog';

export const paymentMethodEnum = pgEnum('payment_method', ['CASH', 'CARD', 'WALLET', 'TRANSFER']);
export const saleStatusEnum = pgEnum('sale_status', ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOID']);

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    number: text('number').notNull().unique(),
    sellerId: uuid('seller_id').references(() => users.id, { onDelete: 'set null' }),
    subtotal: integer('subtotal').notNull(),
    discount: integer('discount').notNull().default(0),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }),
    total: integer('total').notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    status: saleStatusEnum('status').notNull().default('COMPLETED'),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    note: text('note'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sales_created_at_idx').on(t.createdAt),
    index('sales_seller_created_idx').on(t.sellerId, t.createdAt),
    index('sales_status_idx').on(t.status),
  ],
);

// Price and cost are snapshots at sale time; never recomputed from the variant.
export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    unitPrice: integer('unit_price').notNull(),
    unitCost: integer('unit_cost'),
    lineTotal: integer('line_total').notNull(),
    returnedQty: integer('returned_qty').notNull().default(0),
  },
  (t) => [index('sale_items_sale_id_idx').on(t.saleId), index('sale_items_variant_id_idx').on(t.variantId)],
);

export const returns = pgTable(
  'returns',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    refundAmount: integer('refund_amount').notNull(),
    refundMethod: paymentMethodEnum('refund_method').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('returns_sale_id_idx').on(t.saleId), index('returns_created_at_idx').on(t.createdAt)],
);

export const returnItems = pgTable(
  'return_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    saleItemId: uuid('sale_item_id')
      .notNull()
      .references(() => saleItems.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    restock: boolean('restock').notNull(),
  },
  (t) => [index('return_items_return_id_idx').on(t.returnId), index('return_items_sale_item_id_idx').on(t.saleItemId)],
);

/** Carts held at the till: client convenience only; totals are always recomputed at checkout. */
export const parkedSales = pgTable(
  'parked_sales',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('parked_sales_user_expires_idx').on(t.userId, t.expiresAt)],
);

export type SaleRow = typeof sales.$inferSelect;
export type SaleItemRow = typeof saleItems.$inferSelect;
export type ReturnRow = typeof returns.$inferSelect;
export type ReturnItemRow = typeof returnItems.$inferSelect;
export type ParkedSaleRow = typeof parkedSales.$inferSelect;
