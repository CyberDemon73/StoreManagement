import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  logoUrl: text('logo_url'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('categories_name_parent_unique').on(t.name, t.parentId),
    // NULL parents are distinct under the composite unique, so root names need their own index.
    uniqueIndex('categories_root_name_unique').on(t.name).where(sql`${t.parentId} is null`),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    phone: text('phone'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [unique('suppliers_name_unique').on(t.name)],
);

export const productStatusEnum = pgEnum('product_status', ['ACTIVE', 'ARCHIVED']);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    description: text('description'),
    baseSku: text('base_sku').notNull().unique(),
    images: jsonb('images').$type<string[]>().notNull().default([]),
    defaultCost: integer('default_cost'),
    defaultPrice: integer('default_price').notNull(),
    status: productStatusEnum('status').notNull().default('ACTIVE'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('products_brand_id_idx').on(t.brandId),
    index('products_category_id_idx').on(t.categoryId),
    index('products_status_idx').on(t.status),
    index('products_base_sku_idx').on(t.baseSku),
    index('products_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

// quantity is written ONLY by applyMovement() in src/services/stock.ts (CLAUDE.md rule 1).
export const variants = pgTable(
  'variants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    size: text('size').notNull(),
    colorName: text('color_name').notNull(),
    colorHex: char('color_hex', { length: 7 }).notNull(),
    sku: text('sku').notNull().unique(),
    barcode: text('barcode').unique(),
    costPrice: integer('cost_price'),
    sellPrice: integer('sell_price').notNull(),
    quantity: integer('quantity').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(3),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('variants_product_size_color_unique').on(t.productId, t.size, t.colorName),
    index('variants_product_id_idx').on(t.productId),
    index('variants_quantity_idx').on(t.quantity),
    // Product search matches `sku ILIKE '%q%'`; a btree cannot serve a leading wildcard.
    index('variants_sku_trgm_idx').using('gin', sql`${t.sku} gin_trgm_ops`),
    // Low-stock list/dashboard: column-vs-column predicate, so only a partial index can serve it.
    index('variants_low_stock_idx')
      .on(t.productId)
      .where(sql`${t.isActive} and ${t.quantity} <= ${t.lowStockThreshold}`),
  ],
);

export type BrandRow = typeof brands.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type VariantRow = typeof variants.$inferSelect;
