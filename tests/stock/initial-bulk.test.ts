import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { getDb } from '@/db/client';
import { products, settings, stockMovements, variants } from '@/db/schema';
import { applyInitialMovementsBulk, applyMovement } from '@/services/stock';
import { verifyStock } from '@/services/stock-verify';
import { seedCatalog } from '../helpers/catalog';
import { createUser } from '../helpers/users';

/** Counts the statements issued through the handle (each builder call is one round trip). */
function counting(tx: Db): { db: Db; count: () => number } {
  let n = 0;
  const db = new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function' && ['execute', 'insert', 'update', 'select', 'delete'].includes(String(prop))) {
        return (...args: unknown[]) => {
          n++;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  return { db, count: () => n };
}

async function freshVariants(n: number) {
  const db = getDb();
  const { brand, category } = await seedCatalog(db);
  const [product] = await db.insert(products).values({ name: 'Bulk Tee', baseSku: 'NO-BLK', brandId: brand.id, categoryId: category.id, defaultPrice: 100 }).returning();
  const rows = await db
    .insert(variants)
    .values(Array.from({ length: n }, (_, i) => ({ productId: product!.id, size: `S${i}`, colorName: 'Black', colorHex: '#000000', sku: `NO-BLK-S${i}-BLACK`, sellPrice: 100, costPrice: 40 })))
    .returning({ id: variants.id });
  return rows.map((r) => r.id);
}

describe('applyInitialMovementsBulk', () => {
  it('books 2,500 opening quantities in O(chunks) statements with a consistent ledger', async () => {
    const db = getDb();
    const user = await createUser(db, { role: 'MANAGER' });
    const ids = await freshVariants(2500);
    let statements = 0;
    await db.transaction(async (tx) => {
      const c = counting(tx);
      await applyInitialMovementsBulk(
        c.db,
        ids.map((variantId, i) => ({ variantId, qty: (i % 7) + 1, unitCost: 40, note: 'CSV import', userId: user.id })),
      );
      statements = c.count();
    });
    expect(statements).toBeLessThanOrEqual(12);

    expect(await verifyStock(db)).toEqual({ ok: true, mismatches: [] });
    const moves = await db.select().from(stockMovements).orderBy(asc(stockMovements.seq));
    expect(moves).toHaveLength(2500);
    expect(moves[0]).toMatchObject({ variantId: ids[0], type: 'INITIAL', qtyDelta: 1, qtyAfter: 1, unitCost: 40, reason: 'CSV import', userId: user.id });
    const [v] = await db.select().from(variants).where(eq(variants.id, ids[6]!));
    expect(v).toMatchObject({ quantity: 7, costPrice: 40 });
  });

  it('refuses a variant that already has movements or stock, and a negative qty unless allowed', async () => {
    const db = getDb();
    const [a, b, c] = await freshVariants(3);
    await db.transaction((tx) => applyMovement(tx, { variantId: a!, type: 'INITIAL', qtyDelta: 2, userId: null }));
    await expect(db.transaction((tx) => applyInitialMovementsBulk(tx, [{ variantId: a!, qty: 1, note: 'x', userId: null }]))).rejects.toThrow(/new variants/);
    await expect(db.transaction((tx) => applyInitialMovementsBulk(tx, [{ variantId: b!, qty: 1, note: 'x', userId: null }, { variantId: b!, qty: 1, note: 'x', userId: null }]))).rejects.toThrow(/once/);

    await expect(db.transaction((tx) => applyInitialMovementsBulk(tx, [{ variantId: c!, qty: -3, note: 'x', userId: null }]))).rejects.toThrow(/Insufficient stock/);
    await db.insert(settings).values({ allowNegativeStock: true });
    await db.transaction((tx) => applyInitialMovementsBulk(tx, [{ variantId: c!, qty: -3, note: 'x', userId: null }]));
    expect(await verifyStock(db)).toEqual({ ok: true, mismatches: [] });
    const [vc] = await db.select({ q: variants.quantity }).from(variants).where(eq(variants.id, c!));
    expect(vc!.q).toBe(-3);
  });
});
