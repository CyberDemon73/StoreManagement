import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/slow-movers/route';
import { getDb, type Db } from '@/db/client';
import { brands, categories, products, settings, stockMovements, variants, type VariantRow } from '@/db/schema';
import { slowMovers } from '@/analytics/slow-movers';
import { createSale } from '@/services/sales';
import { applyMovement } from '@/services/stock';
import { call } from '../helpers/http';
import { authUserOf } from '../helpers/sales';
import { createUser, sessionCookieFor } from '../helpers/users';

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

async function backdateMovements(db: Db, variantId: string, days: number) {
  await db
    .update(stockMovements)
    .set({ createdAt: sql`now() - make_interval(days => ${days})` })
    .where(eq(stockMovements.variantId, variantId));
}

/**
 * old:   INITIAL 10 @300, movements 100 days ago → Markdown 20%, value 3000
 * mid:   INITIAL 5 @200, sold 1 today, movements backdated 65 days → Move to front, value 800, sold 1
 * fresh: INITIAL 4 @100 today → not slow
 */
async function slowFixture(db: Db) {
  await db.insert(settings).values({}).onConflictDoNothing();
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  const seller = await createUser(db, { role: 'SELLER', name: 'Sami' });
  const [brand] = await db.insert(brands).values({ name: 'Oldie' }).returning();
  const [cat] = await db.insert(categories).values({ name: 'Bottoms' }).returning();
  const [product] = await db
    .insert(products)
    .values({ name: 'Old Jeans', baseSku: 'OL-JEA', brandId: brand!.id, categoryId: cat!.id, defaultPrice: 900 })
    .returning();
  const vs = await db
    .insert(variants)
    .values([
      { productId: product!.id, size: '30', colorName: 'Blue', colorHex: '#0000FF', sku: 'OL-JEA-30-BLUE', sellPrice: 900 },
      { productId: product!.id, size: '32', colorName: 'Blue', colorHex: '#0000FF', sku: 'OL-JEA-32-BLUE', sellPrice: 900 },
      { productId: product!.id, size: '34', colorName: 'Blue', colorHex: '#0000FF', sku: 'OL-JEA-34-BLUE', sellPrice: 900 },
    ])
    .returning();
  const [old, mid, fresh] = vs as [VariantRow, VariantRow, VariantRow];
  await db.transaction(async (tx) => {
    await applyMovement(tx, { variantId: old.id, type: 'INITIAL', qtyDelta: 10, unitCost: 300, userId: manager.id });
    await applyMovement(tx, { variantId: mid.id, type: 'INITIAL', qtyDelta: 5, unitCost: 200, userId: manager.id });
    await applyMovement(tx, { variantId: fresh.id, type: 'INITIAL', qtyDelta: 4, unitCost: 100, userId: manager.id });
  });
  await createSale(db, authUserOf(seller, 'Sami'), { items: [{ variantId: mid.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
  await backdateMovements(db, old.id, 100);
  await backdateMovements(db, mid.id, 65);
  return { manager, seller, old, mid, fresh };
}

describe('slow movers', () => {
  it('flags stock without a recent sale, with suggestion and value at cost', async () => {
    const db = getDb();
    const fx = await slowFixture(db);
    const rows = await slowMovers(db, { days: 60 });
    expect(rows).toEqual([
      {
        variantId: fx.old.id,
        productName: 'Old Jeans',
        brand: 'Oldie',
        size: '30',
        color: { name: 'Blue', hex: '#0000FF' },
        sku: 'OL-JEA-30-BLUE',
        qty: 10,
        daysSinceLastSale: 100,
        valueAtCost: 3000,
        soldLast90d: 0,
        suggestion: 'Markdown 20%',
      },
      {
        variantId: fx.mid.id,
        productName: 'Old Jeans',
        brand: 'Oldie',
        size: '32',
        color: { name: 'Blue', hex: '#0000FF' },
        sku: 'OL-JEA-32-BLUE',
        qty: 4,
        daysSinceLastSale: 65,
        valueAtCost: 800,
        soldLast90d: 1,
        suggestion: 'Move to front',
      },
    ]);
    expect((await slowMovers(db, { days: 90 })).map((r) => r.variantId)).toEqual([fx.old.id]);
  });

  it('GET: manager 200 with private cache, SELLER 403, days=0 400', async () => {
    const db = getDb();
    const fx = await slowFixture(db);
    const manager = await sessionCookieFor(db, fx.manager.id);
    const ok = await call(GET, { path: '/api/v1/analytics/slow-movers?days=90', cookie: manager });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect((await ok.json()).map((r: { suggestion: string }) => r.suggestion)).toEqual(['Markdown 20%']);
    expect((await call(GET, { path: '/api/v1/analytics/slow-movers', cookie: manager })).status).toBe(200);

    const seller = await sessionCookieFor(db, fx.seller.id);
    expect((await call(GET, { path: '/api/v1/analytics/slow-movers', cookie: seller })).status).toBe(403);
    expect((await call(GET, { path: '/api/v1/analytics/slow-movers?days=0', cookie: manager })).status).toBe(400);
    expect((await call(GET, { path: '/api/v1/analytics/slow-movers?days=366', cookie: manager })).status).toBe(400);
  });
});
