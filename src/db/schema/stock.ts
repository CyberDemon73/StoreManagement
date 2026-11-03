import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { variants } from './catalog';

export const movementTypeEnum = pgEnum('movement_type', ['INITIAL', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT']);
export const referenceKindEnum = pgEnum('reference_kind', ['sale', 'purchase', 'return', 'count']);

// Immutable ledger: rows are never updated or deleted. variants.quantity == Σ qty_delta.
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'restrict' }),
    type: movementTypeEnum('type').notNull(),
    qtyDelta: integer('qty_delta').notNull(),
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

export type StockMovementRow = typeof stockMovements.$inferSelect;
