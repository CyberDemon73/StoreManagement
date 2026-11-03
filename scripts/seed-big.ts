/**
 * Load-test dataset: ~2k variants and 10k completed sales with items, ledger-consistent.
 *
 *   pnpm db:seed-big                       (uses DATABASE_URL; never in production)
 *   import { seedBig } from 'scripts/seed-big'   (tests/perf seeds PGlite with it)
 *
 * Why bulk inserts instead of createSale(): 10k sales through the service take minutes and the
 * goal is query plans, not service behaviour. The ledger invariant still holds by construction:
 * every variant is inserted with quantity = Σ of the movements written for it (one INITIAL plus
 * one SALE per sale line, qty_after running), so `pnpm stock:verify` passes. No UPDATE of
 * variants.quantity happens here (CLAUDE.md rule 1).
 */
import { like, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, categories, products, saleItems, sales, stockMovements, users, variants } from '@/db/schema';

export interface SeedBigOptions {
  sellerIds: string[];
  products?: number;
  sales?: number;
  /** Days back from now over which sales are spread. */
  days?: number;
}

export interface SeedBigCounts {
  products: number;
  variants: number;
  sales: number;
  saleItems: number;
  movements: number;
}

const SIZES = ['S', 'M', 'L', 'XL'] as const;
const COLORS = [
  { name: 'Black', hex: '#000000' },
  { name: 'Navy', hex: '#1f2a44' },
] as const;
const PAYMENTS = ['CASH', 'CARD', 'WALLET', 'TRANSFER'] as const;
const CHUNK = 1000;
const DAY_MS = 86_400_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export async function seedBig(db: Db, opts: SeedBigOptions): Promise<SeedBigCounts> {
  const productCount = opts.products ?? 250;
  const saleCount = opts.sales ?? 10_000;
  const days = opts.days ?? 365;
  if (opts.sellerIds.length === 0) throw new Error('seedBig needs at least one seller id');
  const rand = mulberry32(20261103);
  const now = Date.now();

  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: products.id }).from(products).where(like(products.baseSku, 'BIG-%')).limit(1);
    if (existing.length > 0) throw new Error('seed-big already applied (products BIG-* exist)');

    const brandRows = await tx
      .insert(brands)
      .values(Array.from({ length: 12 }, (_, i) => ({ name: `Big Brand ${pad(i + 1, 2)}` })))
      .returning({ id: brands.id });
    const catRows = await tx
      .insert(categories)
      .values(Array.from({ length: 8 }, (_, i) => ({ name: `Big Category ${pad(i + 1, 2)}` })))
      .returning({ id: categories.id });

    const productValues = Array.from({ length: productCount }, (_, i) => ({
      name: `Big Product ${pad(i + 1, 4)}`,
      baseSku: `BIG-${pad(i + 1, 4)}`,
      brandId: brandRows[i % brandRows.length]!.id,
      categoryId: catRows[i % catRows.length]!.id,
      defaultPrice: 50_00 + (i % 20) * 25_00,
      defaultCost: 25_00 + (i % 20) * 10_00,
      // 5% archived so status filters are selective.
      status: i % 20 === 19 ? ('ARCHIVED' as const) : ('ACTIVE' as const),
    }));
    const productRows: { id: string; baseSku: string }[] = [];
    await insertChunks(productValues, async (chunk) => {
      productRows.push(...(await tx.insert(products).values(chunk).returning({ id: products.id, baseSku: products.baseSku })));
    });

    interface PlannedVariant {
      productId: string;
      size: string;
      colorName: string;
      colorHex: string;
      sku: string;
      barcode: string;
      sellPrice: number;
      costPrice: number;
      lowStockThreshold: number;
    }
    const planned: PlannedVariant[] = [];
    productRows.forEach((p, pi) => {
      for (const size of SIZES) {
        for (const color of COLORS) {
          const n = planned.length;
          planned.push({
            productId: p.id,
            size,
            colorName: color.name,
            colorHex: color.hex,
            sku: `${p.baseSku}-${size}-${color.name.toUpperCase()}`,
            barcode: `29${pad(n + 1, 11)}`,
            sellPrice: productValues[pi]!.defaultPrice,
            costPrice: productValues[pi]!.defaultCost,
            lowStockThreshold: 3,
          });
        }
      }
    });

    // Plan every sale line first, so each variant's opening stock covers what it sells.
    interface PlannedLine {
      sale: number;
      variant: number;
      qty: number;
    }
    const lines: PlannedLine[] = [];
    for (let s = 0; s < saleCount; s++) {
      const n = 1 + Math.floor(rand() * 3);
      const used = new Set<number>();
      for (let j = 0; j < n; j++) {
        const v = Math.floor(rand() * planned.length);
        if (used.has(v)) continue;
        used.add(v);
        lines.push({ sale: s, variant: v, qty: 1 + Math.floor(rand() * 2) });
      }
    }
    const sold = new Array<number>(planned.length).fill(0);
    for (const l of lines) sold[l.variant]! += l.qty;
    // ~3% of variants end at or below threshold (half of those out of stock) so low-stock is selective.
    const opening = planned.map((_, i) => (i % 33 === 0 ? sold[i]! + (i % 2) * 2 : sold[i]! + 20 + (i % 40)));

    const variantRows: { id: string; sku: string }[] = [];
    await insertChunks(
      planned.map((v, i) => ({ ...v, quantity: opening[i]! - sold[i]! })),
      async (chunk) => {
        variantRows.push(...(await tx.insert(variants).values(chunk).returning({ id: variants.id, sku: variants.sku })));
      },
    );
    const idBySku = new Map(variantRows.map((r) => [r.sku, r.id]));
    const variantIds = planned.map((v) => idBySku.get(v.sku)!);

    const openedAt = new Date(now - (days + 5) * DAY_MS);
    const movements: (typeof stockMovements.$inferInsert)[] = planned.map((v, i) => ({
      variantId: variantIds[i]!,
      type: 'INITIAL' as const,
      qtyDelta: opening[i]!,
      qtyAfter: opening[i]!,
      unitCost: v.costPrice,
      reason: 'seed-big',
      userId: opts.sellerIds[0]!,
      createdAt: openedAt,
    }));

    // Sales oldest → newest; number order follows time like the real counter.
    const linesBySale = new Map<number, PlannedLine[]>();
    for (const l of lines) {
      const arr = linesBySale.get(l.sale);
      if (arr) arr.push(l);
      else linesBySale.set(l.sale, [l]);
    }
    const saleValues: (typeof sales.$inferInsert)[] = [];
    const saleTimes: Date[] = [];
    for (let s = 0; s < saleCount; s++) {
      const at = new Date(now - days * DAY_MS + Math.floor(((s + rand()) / saleCount) * days * DAY_MS));
      saleTimes.push(at);
      const subtotal = (linesBySale.get(s) ?? []).reduce((sum, l) => sum + planned[l.variant]!.sellPrice * l.qty, 0);
      const discount = s % 10 === 0 ? Math.floor(subtotal / 10) : 0;
      saleValues.push({
        number: `BG-${pad(s + 1, 6)}`,
        sellerId: opts.sellerIds[s % opts.sellerIds.length]!,
        subtotal,
        discount,
        total: subtotal - discount,
        paymentMethod: PAYMENTS[s % PAYMENTS.length]!,
        customerName: s % 7 === 0 ? `Customer ${pad(s, 5)}` : null,
        customerPhone: s % 7 === 0 ? `010${pad(s, 8)}` : null,
        createdAt: at,
      });
    }
    const saleIds: string[] = [];
    await insertChunks(saleValues, async (chunk) => {
      saleIds.push(...(await tx.insert(sales).values(chunk).returning({ id: sales.id })).map((r) => r.id));
    });

    const running = [...opening];
    const itemValues: (typeof saleItems.$inferInsert)[] = [];
    for (const l of lines) {
      const v = planned[l.variant]!;
      itemValues.push({
        saleId: saleIds[l.sale]!,
        variantId: variantIds[l.variant]!,
        qty: l.qty,
        unitPrice: v.sellPrice,
        unitCost: v.costPrice,
        lineTotal: v.sellPrice * l.qty,
      });
      running[l.variant]! -= l.qty;
      movements.push({
        variantId: variantIds[l.variant]!,
        type: 'SALE',
        qtyDelta: -l.qty,
        qtyAfter: running[l.variant]!,
        unitCost: v.costPrice,
        referenceKind: 'sale',
        referenceId: saleIds[l.sale]!,
        userId: saleValues[l.sale]!.sellerId,
        createdAt: saleTimes[l.sale]!,
      });
    }
    await insertChunks(itemValues, (chunk) => tx.insert(saleItems).values(chunk));
    await insertChunks(movements, (chunk) => tx.insert(stockMovements).values(chunk));
    await tx.execute(sql`analyze`);

    return {
      products: productRows.length,
      variants: variantRows.length,
      sales: saleIds.length,
      saleItems: itemValues.length,
      movements: movements.length,
    };
  });
}

async function main(): Promise<void> {
  await import('dotenv/config');
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('seed-big refuses to run against production');
  }
  const { getDb } = await import('@/db/client');
  const db = getDb();
  const sellers = await db.select({ id: users.id }).from(users).where(sql`${users.status} = 'ACTIVE'`);
  if (sellers.length === 0) throw new Error('No active users: run /setup or pnpm db:seed first');
  const started = Date.now();
  const counts = await seedBig(db, { sellerIds: sellers.map((u) => u.id) });
  console.log(`seed-big done in ${((Date.now() - started) / 1000).toFixed(1)}s`, counts);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/seed-big.ts')) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
