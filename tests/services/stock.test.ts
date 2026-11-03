import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { brands, categories, products, settings, stockMovements, variants } from '@/db/schema';
import { verifyStock } from '@/db/verify-stock';
import { AppError } from '@/lib/errors';
import { applyMovement, applyMovements, lockVariants, nextNumber } from '@/services/stock';

async function fixture() {
  const db = getDb();
  const [b] = await db.insert(brands).values({ name: 'Northline' }).returning();
  const [c] = await db.insert(categories).values({ name: 'Tops' }).returning();
  const [p] = await db
    .insert(products)
    .values({ name: 'Chino Slim', brandId: b!.id, categoryId: c!.id, baseSku: 'NO-CHI', defaultPrice: 1000 })
    .returning();
  const [v] = await db
    .insert(variants)
    .values({ productId: p!.id, size: 'S', colorName: 'Black', colorHex: '#000000', sku: 'NO-CHI-S-BLACK', sellPrice: 1000 })
    .returning();
  return { db, variantId: v!.id };
}

async function qty(variantId: string) {
  const [row] = await getDb().select({ quantity: variants.quantity, costPrice: variants.costPrice }).from(variants).where(eq(variants.id, variantId));
  return row!;
}

describe('applyMovement', () => {
  it('INITIAL sets quantity and cost and writes one ledger row', async () => {
    const { db, variantId } = await fixture();
    const r = await db.transaction((tx) => applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: 10, unitCost: 500, userId: null }));
    expect(r).toMatchObject({ quantity: 10, costPrice: 500 });
    expect(await qty(variantId)).toEqual({ quantity: 10, costPrice: 500 });
    const rows = await db.select().from(stockMovements);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ variantId, type: 'INITIAL', qtyDelta: 10, unitCost: 500 });
  });

  it('PURCHASE blends cost by weighted average', async () => {
    const { db, variantId } = await fixture();
    await db.transaction((tx) => applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: 10, unitCost: 500, userId: null }));
    const r = await db.transaction((tx) => applyMovement(tx, { variantId, type: 'PURCHASE', qtyDelta: 10, unitCost: 700, userId: null }));
    expect(r).toMatchObject({ quantity: 20, costPrice: 600 });
  });

  it('SALE below zero is rejected with INSUFFICIENT_STOCK and leaves no trace', async () => {
    const { db, variantId } = await fixture();
    await db.transaction((tx) => applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: 10, unitCost: 500, userId: null }));
    let err: unknown;
    try {
      await db.transaction((tx) => applyMovement(tx, { variantId, type: 'SALE', qtyDelta: -25, userId: null }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('INSUFFICIENT_STOCK');
    expect((err as AppError).fields?.[variantId]).toBe('Insufficient stock');
    expect((await qty(variantId)).quantity).toBe(10);
    expect(await db.select().from(stockMovements)).toHaveLength(1);
  });

  it('SALE does not change cost; negative allowed when settings.allowNegativeStock', async () => {
    const { db, variantId } = await fixture();
    await db.insert(settings).values({ allowNegativeStock: true });
    await db.transaction((tx) => applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: 2, unitCost: 500, userId: null }));
    const r = await db.transaction((tx) => applyMovement(tx, { variantId, type: 'SALE', qtyDelta: -5, userId: null }));
    expect(r).toMatchObject({ quantity: -3, costPrice: 500 });
  });

  it('rejects a movement that would overflow int4 quantity', async () => {
    const { db, variantId } = await fixture();
    await db.transaction((tx) => applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: 10, unitCost: 500, userId: null }));
    const err = await db
      .transaction((tx) => applyMovement(tx, { variantId, type: 'PURCHASE', qtyDelta: 2_147_483_647, unitCost: 500, userId: null }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('VALIDATION');
    expect((err as AppError).fields?.qtyDelta).toBe('Out of range');
    expect((await qty(variantId)).quantity).toBe(10);
  });
});

describe('verifyStock', () => {
  it('passes when the ledger matches and fails when quantity was edited directly', async () => {
    const { db, variantId } = await fixture();
    await db.transaction((tx) => applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: 7, unitCost: 500, userId: null }));
    expect((await verifyStock(db)).ok).toBe(true);
    // Test-only direct write to simulate corruption; production code must never do this.
    await db.execute(sql`update variants set quantity = 99 where id = ${variantId}`);
    const result = await verifyStock(db);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ variantId, quantity: 99, ledger: 7 }]);
  });
});

describe('ledger extensions (sprint 2)', () => {
  it('records qtyAfter on every movement', async () => {
    const { db, variantId } = await fixture();
    await db.transaction((tx) => applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: 10, unitCost: 500, userId: null }));
    await db.transaction((tx) => applyMovement(tx, { variantId, type: 'SALE', qtyDelta: -3, userId: null }));
    const rows = await db.select({ after: stockMovements.qtyAfter }).from(stockMovements).orderBy(stockMovements.createdAt, stockMovements.id);
    expect(rows.map((r) => r.after)).toEqual([10, 7]);
  });

  it('lockVariants returns the locked rows and rejects unknown ids', async () => {
    const { db, variantId } = await fixture();
    const locked = await db.transaction((tx) => lockVariants(tx, [variantId]));
    expect(locked.get(variantId)).toEqual({ quantity: 0, costPrice: null });
    let err: unknown;
    try {
      await db.transaction((tx) => lockVariants(tx, [variantId, '00000000-0000-4000-8000-000000000000']));
    } catch (e) {
      err = e;
    }
    expect((err as AppError).code).toBe('NOT_FOUND');
    expect((err as AppError).fields?.['00000000-0000-4000-8000-000000000000']).toBeTypeOf('string');
  });

  it('applyMovements locks all variants then applies in input order', async () => {
    const { db, variantId: a } = await fixture();
    const [b] = await db.insert(variants).values({ productId: (await db.select().from(variants))[0]!.productId, size: 'M', colorName: 'Black', colorHex: '#000000', sku: 'NO-CHI-M-BLACK', sellPrice: 1000 }).returning();
    const results = await db.transaction((tx) =>
      applyMovements(tx, [
        { variantId: b!.id, type: 'INITIAL', qtyDelta: 4, unitCost: 100, userId: null },
        { variantId: a, type: 'INITIAL', qtyDelta: 2, unitCost: 100, userId: null },
        { variantId: b!.id, type: 'SALE', qtyDelta: -1, userId: null },
      ]),
    );
    expect(results.map((r) => r.quantity)).toEqual([4, 2, 3]);
    expect((await qty(b!.id)).quantity).toBe(3);
    expect((await qty(a)).quantity).toBe(2);
  });

  it('nextNumber allocates zero-padded sequential numbers per prefix', async () => {
    const db = getDb();
    expect(await db.transaction((tx) => nextNumber(tx, 'PO'))).toBe('PO-000001');
    expect(await db.transaction((tx) => nextNumber(tx, 'PO'))).toBe('PO-000002');
    expect(await db.transaction((tx) => nextNumber(tx, 'SC'))).toBe('SC-000001');
  });
});

describe('applyMovement int4 lower bound', () => {
  it('rejects quantity below -2^31 with VALIDATION', async () => {
    const { db, variantId } = await fixture();
    await db.insert(settings).values({ allowNegativeStock: true });
    await db.transaction((tx) => applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: -2_147_483_647, userId: null }));
    let err: unknown;
    try {
      await db.transaction((tx) => applyMovement(tx, { variantId, type: 'SALE', qtyDelta: -100, userId: null }));
    } catch (e) {
      err = e;
    }
    expect((err as AppError).code).toBe('VALIDATION');
  });
});
