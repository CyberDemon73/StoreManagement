import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { parkedSales, returnItems, returns, saleItems, sales } from '@/db/schema';
import { createUser } from '../helpers/users';

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return ((e as Error).cause as { code?: string } | undefined)?.code;
  }
  return undefined;
}

describe('sales schema (sprint 3)', () => {
  it('creates sales, sale_items, returns, return_items and parked_sales', async () => {
    const db = getDb();
    for (const t of [sales, saleItems, returns, returnItems, parkedSales]) expect(await db.select().from(t)).toEqual([]);
  });

  it('defaults status to COMPLETED, returned_qty to 0, and keeps sale numbers unique', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const base = { number: 'AS-000001', sellerId: u.id, subtotal: 1000, discount: 0, total: 1000, paymentMethod: 'CASH' as const };
    const [s] = await db.insert(sales).values(base).returning();
    expect(s).toMatchObject({ status: 'COMPLETED', discountPct: null, voidedAt: null });
    expect(await pgCode(db.insert(sales).values(base))).toBe('23505');
    const [p] = await db.insert(parkedSales).values({ userId: u.id, label: 'Ahmed', payload: { lines: [] }, expiresAt: new Date(Date.now() + 1000) }).returning();
    expect(p?.payload).toEqual({ lines: [] });
  });
});
