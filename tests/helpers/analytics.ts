import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, categories, products, returns, sales, settings, variants, type VariantRow } from '@/db/schema';
import { createReturn } from '@/services/returns';
import { createSale } from '@/services/sales';
import { voidSale } from '@/services/sale-void';
import { applyMovement } from '@/services/stock';
import { authUserOf } from './sales';
import { createUser, type CreatedUser } from './users';

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

/**
 * Hand-computed analytics fixture (store timezone Africa/Cairo, UTC+3 in June).
 *
 * S1 2026-06-10 10:00 Cairo (07:00Z), seller A, CASH: N1×2 → 2000, cost 800
 * S2 2026-06-10 23:30 Cairo (20:30Z), seller B, CARD: N2×1 + C1×2, AMOUNT 200 → subtotal 3000, total 2800, cost 1400
 * S3 2026-06-11 00:30 Cairo (2026-06-10 21:30Z), seller A, CASH: C1×1 → 500, cost 200  (counts on 06-11)
 * S4 2026-06-11 12:00 Cairo (09:00Z), seller A, CASH: N1×1 → 1000, then VOID (counts nowhere)
 * R1 2026-06-11 15:00 Cairo (12:00Z) on S2: C1×1 restock, refund round(500 × 2800 / 3000) = 467, CARD
 */
export const EXPECTED = {
  range: { from: '2026-06-10', to: '2026-06-11' },
  revenue: 4833,
  cogs: 2200,
  profit: 2633,
  marginPct: 54.5,
  salesCount: 3,
  unitsSold: 5,
  avgBasket: 1767,
  cashByMethod: { CASH: 2500, CARD: 2333, WALLET: 0, TRANSFER: 0 },
  day10: { bucket: '2026-06-10', revenue: 4800, cogs: 2200, profit: 2600, count: 2 },
  day11: { bucket: '2026-06-11', revenue: 33, cogs: 0, profit: 33, count: 1 },
  refund: 467,
} as const;

export interface AnalyticsFixture {
  sellerA: CreatedUser;
  sellerB: CreatedUser;
  manager: CreatedUser;
  brandN: { id: string };
  brandC: { id: string };
  categoryT: { id: string };
  productPN: { id: string };
  productPC: { id: string };
  n1: VariantRow;
  n2: VariantRow;
  c1: VariantRow;
  saleIds: { s1: string; s2: string; s3: string; s4: string };
  returnId: string;
}

async function setCreatedAt(db: Db, saleId: string, iso: string) {
  await db.update(sales).set({ createdAt: new Date(iso) }).where(eq(sales.id, saleId));
}

export async function analyticsFixture(db: Db): Promise<AnalyticsFixture> {
  await db.insert(settings).values({}).onConflictDoNothing();
  const sellerA = await createUser(db, { role: 'SELLER', name: 'Amira' });
  const sellerB = await createUser(db, { role: 'SELLER', name: 'Bassem' });
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });

  const [brandN] = await db.insert(brands).values({ name: 'Northline' }).returning();
  const [brandC] = await db.insert(brands).values({ name: 'Casa' }).returning();
  const [categoryT] = await db.insert(categories).values({ name: 'Tops' }).returning();
  const [productPN] = await db
    .insert(products)
    .values({ name: 'North Shirt', baseSku: 'NO-SHI', brandId: brandN!.id, categoryId: categoryT!.id, defaultPrice: 1000, defaultCost: 400 })
    .returning();
  const [productPC] = await db
    .insert(products)
    .values({ name: 'Casa Tee', baseSku: 'CA-TEE', brandId: brandC!.id, categoryId: categoryT!.id, defaultPrice: 500, defaultCost: 200 })
    .returning();
  const vs = await db
    .insert(variants)
    .values([
      { productId: productPN!.id, size: 'S', colorName: 'Black', colorHex: '#111111', sku: 'NO-SHI-S-BLACK', sellPrice: 1000 },
      { productId: productPN!.id, size: 'M', colorName: 'Black', colorHex: '#111111', sku: 'NO-SHI-M-BLACK', sellPrice: 2000 },
      { productId: productPC!.id, size: 'S', colorName: 'White', colorHex: '#FAFAFA', sku: 'CA-TEE-S-WHITE', sellPrice: 500 },
    ])
    .returning();
  const [n1, n2, c1] = vs as [VariantRow, VariantRow, VariantRow];
  await db.transaction(async (tx) => {
    await applyMovement(tx, { variantId: n1.id, type: 'INITIAL', qtyDelta: 20, unitCost: 400, userId: manager.id });
    await applyMovement(tx, { variantId: n2.id, type: 'INITIAL', qtyDelta: 10, unitCost: 1000, userId: manager.id });
    await applyMovement(tx, { variantId: c1.id, type: 'INITIAL', qtyDelta: 10, unitCost: 200, userId: manager.id });
  });

  const a = authUserOf(sellerA, 'Amira');
  const b = authUserOf(sellerB, 'Bassem');
  const m = authUserOf(manager, 'Mona');
  const s1 = await createSale(db, a, { items: [{ variantId: n1.id, qty: 2 }], paymentMethod: 'CASH' }, CTX);
  const s2 = await createSale(
    db,
    b,
    { items: [{ variantId: n2.id, qty: 1 }, { variantId: c1.id, qty: 2 }], discount: { type: 'AMOUNT', value: 200 }, paymentMethod: 'CARD' },
    CTX,
  );
  const s3 = await createSale(db, a, { items: [{ variantId: c1.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
  const s4 = await createSale(db, a, { items: [{ variantId: n1.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
  await voidSale(db, m, s4.id, { reason: 'test void' }, CTX);
  await setCreatedAt(db, s1.id, '2026-06-10T07:00:00Z');
  await setCreatedAt(db, s2.id, '2026-06-10T20:30:00Z');
  await setCreatedAt(db, s3.id, '2026-06-10T21:30:00Z');
  await setCreatedAt(db, s4.id, '2026-06-11T09:00:00Z');

  const c1Line = s2.items.find((i) => i.variantId === c1.id)!;
  const afterReturn = await createReturn(db, m, s2.id, { items: [{ saleItemId: c1Line.id, qty: 1, restock: true }], refundMethod: 'CARD', reason: 'Too small' }, CTX);
  const returnId = afterReturn.returns[0]!.id;
  await db.update(returns).set({ createdAt: new Date('2026-06-11T12:00:00Z') }).where(eq(returns.id, returnId));

  return {
    sellerA,
    sellerB,
    manager,
    brandN: brandN!,
    brandC: brandC!,
    categoryT: categoryT!,
    productPN: productPN!,
    productPC: productPC!,
    n1,
    n2,
    c1,
    saleIds: { s1: s1.id, s2: s2.id, s3: s3.id, s4: s4.id },
    returnId,
  };
}
