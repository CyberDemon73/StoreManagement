import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import {
  brands,
  categories,
  idempotencyKeys,
  products,
  purchaseItems,
  purchases,
  saleCounters,
  stockCountItems,
  stockCounts,
  stockMovements,
  variants,
} from '@/db/schema';
import { createUser } from '../helpers/users';

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return ((e as Error).cause as { code?: string } | undefined)?.code;
  }
  return undefined;
}

async function fixture() {
  const db = getDb();
  const [b] = await db.insert(brands).values({ name: 'Northline' }).returning();
  const [c] = await db.insert(categories).values({ name: 'Tops' }).returning();
  const [p] = await db.insert(products).values({ name: 'Chino', brandId: b!.id, categoryId: c!.id, baseSku: 'NO-CHI', defaultPrice: 1000 }).returning();
  const [v] = await db.insert(variants).values({ productId: p!.id, size: 'S', colorName: 'Black', colorHex: '#000000', sku: 'NO-CHI-S-BLACK', sellPrice: 1000 }).returning();
  return { db, variantId: v!.id };
}

describe('stock schema (sprint 2)', () => {
  it('creates purchases, counts, counters and idempotency tables', async () => {
    const db = getDb();
    for (const t of [purchases, purchaseItems, stockCounts, stockCountItems, saleCounters, idempotencyKeys]) {
      expect(await db.select().from(t)).toEqual([]);
    }
  });

  it('requires qty_after on movements', async () => {
    const { db, variantId } = await fixture();
    const code = await pgCode(db.execute(`insert into stock_movements (variant_id, type, qty_delta) values ('${variantId}', 'INITIAL', 1)`));
    expect(code).toBe('23502');
    await db.insert(stockMovements).values({ variantId, type: 'INITIAL', qtyDelta: 1, qtyAfter: 1 });
  });

  it('enforces one count item per variant and one idempotency key per user', async () => {
    const { db, variantId } = await fixture();
    const u = await createUser(db, { role: 'MANAGER' });
    const [count] = await db.insert(stockCounts).values({ number: 'SC-000001', startedBy: u.id }).returning();
    await db.insert(stockCountItems).values({ countId: count!.id, variantId, systemQty: 0 });
    expect(await pgCode(db.insert(stockCountItems).values({ countId: count!.id, variantId, systemQty: 0 }))).toBe('23505');
    await db.insert(idempotencyKeys).values({ userId: u.id, key: 'k1', requestHash: 'h', status: 201, response: { ok: true } });
    expect(await pgCode(db.insert(idempotencyKeys).values({ userId: u.id, key: 'k1', requestHash: 'h2', status: 201, response: {} }))).toBe('23505');
    expect(count!.status).toBe('OPEN');
    expect(count!.scope).toBe('all');
  });

  it('counters default next to 1 and purchases have unique numbers', async () => {
    const db = getDb();
    const [c] = await db.insert(saleCounters).values({ prefix: 'PO' }).returning();
    expect(c!.next).toBe(1);
    await db.insert(purchases).values({ number: 'PO-000001', total: 0, receivedAt: new Date() });
    expect(await pgCode(db.insert(purchases).values({ number: 'PO-000001', total: 0, receivedAt: new Date() }))).toBe('23505');
  });
});
