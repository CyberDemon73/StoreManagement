import { count, gt, isNull, and } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { brands, categories, products, settings, stockMovements, suppliers, variants } from '@/db/schema';
import { seed } from '@/db/seed';
import { verifyStock } from '@/db/verify-stock';

const SKU_RE = /^[A-Z0-9]+(-[A-Z0-9]+){2,3}$/;

async function tableCounts() {
  const db = getDb();
  const n = async (t: typeof brands | typeof categories | typeof products | typeof variants | typeof stockMovements | typeof suppliers) =>
    (await db.select({ n: count() }).from(t))[0]!.n;
  return {
    brands: await n(brands),
    categories: await n(categories),
    suppliers: await n(suppliers),
    products: await n(products),
    variants: await n(variants),
    movements: await n(stockMovements),
  };
}

describe('seed', () => {
  it('builds a deterministic, ledger-consistent catalogue and is idempotent', async () => {
    const db = getDb();
    const first = await seed(db);

    expect(first.brands).toBe(3);
    expect(first.categories).toBe(6);
    expect(first.products).toBe(40);
    expect(first.variants).toBeGreaterThanOrEqual(200);
    expect(first.variants).toBeLessThanOrEqual(320);

    const stocked = (await db.select({ n: count() }).from(variants).where(gt(variants.quantity, 0)))[0]!.n;
    expect(first.movements).toBe(stocked);
    expect(stocked).toBeLessThan(first.variants); // some variants are left at 0

    const before = await tableCounts();
    expect(before).toMatchObject({ ...first, suppliers: 2 });
    expect(await db.select().from(settings)).toHaveLength(1);

    expect((await verifyStock(db)).ok).toBe(true);

    const all = await db.select({ sku: variants.sku }).from(variants);
    for (const { sku } of all) expect(sku).toMatch(SKU_RE);

    const uncosted = await db
      .select({ n: count() })
      .from(variants)
      .where(and(gt(variants.quantity, 0), isNull(variants.costPrice)));
    expect(uncosted[0]!.n).toBe(0);

    const second = await seed(db);
    expect(second).toEqual(first);
    expect(await tableCounts()).toEqual(before);
  });
});
