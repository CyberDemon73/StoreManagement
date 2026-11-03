import { and, asc, desc, eq, exists, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { brands, categories, products, variants } from '@/db/schema';
import type { ProductListQuery } from '@/schemas/products';
import { toProductListItem, type ProductListItemOut } from '@/serializers/catalog';
import type { Paginated } from './audit';
import { toAggregates, variantAggregateFields } from './products';

/** Escape ILIKE metacharacters so user text only ever matches literally (pair with ESCAPE '\'). */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => '\\' + m);
}

type SortKey = 'name' | 'updated' | 'price' | 'qty';

/**
 * One SQL-first query: products ⋈ brands ⋈ categories with a lateral aggregate over ACTIVE
 * variants, so stock filters and price/qty sorts run server-side; `count(*) over()` gives total.
 */
export async function listProducts(db: Db, query: ProductListQuery): Promise<Paginated<ProductListItemOut>> {
  const { page, pageSize, q, brandId, categoryId, size, color, stock, minPrice, maxPrice, status, sort } = query;

  const agg = db
    .select(variantAggregateFields)
    .from(variants)
    .where(and(eq(variants.productId, products.id), eq(variants.isActive, true)))
    .as('agg');
  // Products without variants fall back to the default price for both bounds.
  const minPriceExpr = sql<number>`coalesce(${agg.minPrice}, ${products.defaultPrice})`;
  const maxPriceExpr = sql<number>`coalesce(${agg.maxPrice}, ${products.defaultPrice})`;

  const where: SQL[] = [];
  if (status !== 'ALL') where.push(eq(products.status, status));
  if (brandId) where.push(eq(products.brandId, brandId));
  if (categoryId) where.push(eq(products.categoryId, categoryId));
  if (size) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(variants)
          .where(and(eq(variants.productId, products.id), eq(variants.isActive, true), sql`lower(${variants.size}) = lower(${size})`)),
      ),
    );
  }
  if (color) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(variants)
          .where(and(eq(variants.productId, products.id), eq(variants.isActive, true), sql`lower(${variants.colorName}) = lower(${color})`)),
      ),
    );
  }
  if (stock === 'in') where.push(sql`${agg.totalQty} > 0 and ${agg.lowCount} = 0`);
  if (stock === 'low') where.push(sql`${agg.lowCount} > 0`);
  if (stock === 'out') where.push(sql`${agg.outCount} > 0`);
  // Range overlap: the product's [min, max] must intersect the requested [minPrice, maxPrice].
  if (minPrice !== undefined) where.push(sql`${maxPriceExpr} >= ${minPrice}`);
  if (maxPrice !== undefined) where.push(sql`${minPriceExpr} <= ${maxPrice}`);
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      sql`(${products.name} ilike ${like} escape '\\'
        or ${products.baseSku} ilike ${like} escape '\\'
        or ${brands.name} ilike ${like} escape '\\'
        or ${exists(
          db
            .select({ one: sql`1` })
            .from(variants)
            .where(and(eq(variants.productId, products.id), sql`(${variants.sku} ilike ${like} escape '\\' or ${variants.barcode} = ${q})`)),
        )})`,
    );
  }

  // Whitelist: the Zod enum already limits `sort`; this map is the only place a column is chosen.
  const sortColumns: Record<SortKey, SQL | PgColumn> = {
    name: products.name,
    updated: products.updatedAt,
    price: minPriceExpr,
    qty: sql`${agg.totalQty}`,
  };
  const direction = sort.startsWith('-') ? desc : asc;
  const sortColumn = sortColumns[sort.replace(/^-/, '') as SortKey];

  const rows = await db
    .select({
      product: products,
      brand: { id: brands.id, name: brands.name },
      category: { id: categories.id, name: categories.name },
      agg: {
        variantCount: agg.variantCount,
        totalQty: agg.totalQty,
        lowCount: agg.lowCount,
        outCount: agg.outCount,
        minPrice: agg.minPrice,
        maxPrice: agg.maxPrice,
        tint: agg.tint,
      },
      total: sql<number>`count(*) over()::int`,
    })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .crossJoinLateral(agg)
    .where(where.length ? and(...where) : undefined)
    .orderBy(direction(sortColumn), asc(products.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    data: rows.map((r) => toProductListItem(r.product, { brand: r.brand, category: r.category }, toAggregates(r.agg))),
    page,
    pageSize,
    total: rows[0]?.total ?? 0,
  };
}
