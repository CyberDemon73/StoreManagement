import 'dotenv/config';
import { count } from 'drizzle-orm';
import { buildSku, defaultBaseSku } from '@/lib/sku';
import { applyMovement } from '@/services/stock';
import { getDb, type Db } from './client';
import { brands, categories, products, settings, stockMovements, suppliers, variants } from './schema';

export interface SeedCounts {
  brands: number;
  categories: number;
  products: number;
  variants: number;
  movements: number;
}

export interface SeedOptions {
  /** Recorded as the author of the seeded products and INITIAL movements. */
  userId?: string | null;
}

/** Small deterministic PRNG so every seed run produces the same catalogue. */
function mulberry32(seedValue: number): () => number {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRANDS = ['Northline', 'Casa Lino', 'Verano'] as const;
const SUPPLIERS = [
  { name: 'Delta Textiles', phone: '+20 2 2345 6789', notes: 'Cotton and linen basics, Mahalla' },
  { name: 'Nile Footwear Co.', phone: '+20 3 4567 8901', notes: 'Leather shoes and accessories, Alexandria' },
];

type CategoryName = 'Tops' | 'Bottoms' | 'Dresses' | 'Outerwear' | 'Shoes' | 'Accessories';
const CATEGORIES: CategoryName[] = ['Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Accessories'];

const APPAREL_SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const SIZES: Record<CategoryName, string[]> = {
  Tops: APPAREL_SIZES,
  Dresses: APPAREL_SIZES,
  Outerwear: APPAREL_SIZES,
  Bottoms: ['28', '30', '32', '34', '36'],
  Shoes: ['38', '39', '40', '41', '42', '43', '44', '45'],
  Accessories: ['ONE'],
};
/** How many sizes a product carries ([min, max]), taken as a contiguous run of its category's sizes. */
const SIZE_SPAN: Record<CategoryName, [number, number]> = {
  Tops: [2, 4],
  Dresses: [2, 4],
  Outerwear: [2, 4],
  Bottoms: [2, 4],
  Shoes: [4, 6],
  Accessories: [1, 1],
};

const PRODUCTS: { name: string; category: CategoryName }[] = [
  { name: 'Linen Camp Shirt', category: 'Tops' },
  { name: 'Oxford Button-Down', category: 'Tops' },
  { name: 'Essential Crew Tee', category: 'Tops' },
  { name: 'Ribbed Tank', category: 'Tops' },
  { name: 'Pique Polo', category: 'Tops' },
  { name: 'Merino Crewneck', category: 'Tops' },
  { name: 'Striped Breton Top', category: 'Tops' },
  { name: 'Silk Blouse', category: 'Tops' },
  { name: 'Chino Slim', category: 'Bottoms' },
  { name: 'Relaxed Denim', category: 'Bottoms' },
  { name: 'Pleated Trousers', category: 'Bottoms' },
  { name: 'Cargo Pants', category: 'Bottoms' },
  { name: 'Linen Drawstring Pants', category: 'Bottoms' },
  { name: 'Tailored Shorts', category: 'Bottoms' },
  { name: 'Wide Leg Jeans', category: 'Bottoms' },
  { name: 'Wrap Midi Dress', category: 'Dresses' },
  { name: 'Slip Dress', category: 'Dresses' },
  { name: 'Shirt Dress', category: 'Dresses' },
  { name: 'Tiered Maxi Dress', category: 'Dresses' },
  { name: 'Knit Sweater Dress', category: 'Dresses' },
  { name: 'Trench Coat', category: 'Outerwear' },
  { name: 'Denim Jacket', category: 'Outerwear' },
  { name: 'Quilted Vest', category: 'Outerwear' },
  { name: 'Wool Overcoat', category: 'Outerwear' },
  { name: 'Bomber Jacket', category: 'Outerwear' },
  { name: 'Leather Loafer', category: 'Shoes' },
  { name: 'Canvas Sneaker', category: 'Shoes' },
  { name: 'Suede Chelsea Boot', category: 'Shoes' },
  { name: 'Leather Sandal', category: 'Shoes' },
  { name: 'Running Trainer', category: 'Shoes' },
  { name: 'Leather Belt', category: 'Accessories' },
  { name: 'Canvas Tote', category: 'Accessories' },
  { name: 'Wool Scarf', category: 'Accessories' },
  { name: 'Baseball Cap', category: 'Accessories' },
  { name: 'Bucket Hat', category: 'Accessories' },
  { name: 'Leather Wallet', category: 'Accessories' },
  { name: 'Silk Square Scarf', category: 'Accessories' },
  { name: 'Crossbody Bag', category: 'Accessories' },
  { name: 'Cotton Socks Pack', category: 'Accessories' },
  { name: 'Beanie', category: 'Accessories' },
];

const PALETTE: { name: string; hex: string }[] = [
  { name: 'Black', hex: '#1A1A1A' },
  { name: 'White', hex: '#F5F5F0' },
  { name: 'Navy', hex: '#1F2A44' },
  { name: 'Sand', hex: '#D8C8A8' },
  { name: 'Olive', hex: '#6B6B3A' },
  { name: 'Burgundy', hex: '#6D1F2C' },
  { name: 'Stone', hex: '#A8A49C' },
  { name: 'Rust', hex: '#A0522D' },
  { name: 'Sky Blue', hex: '#8EB8D8' },
  { name: 'Charcoal', hex: '#3C3F44' },
];

/** EAN-13: append the standard check digit (weights 1,3,1,3,… from the left) to a 12-digit base. */
function ean13(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error(`ean13 needs 12 digits, got ${base12}`);
  const sum = [...base12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return base12 + String((10 - (sum % 10)) % 10);
}

/** GS1 prefix for Egypt. */
const BARCODE_PREFIX = '622';

/** Products and variants are inserted in chunks to keep each statement a reasonable size. */
const BATCH = 100;

async function currentCounts(db: Db): Promise<SeedCounts> {
  const n = async (table: typeof brands | typeof categories | typeof products | typeof variants | typeof stockMovements) =>
    (await db.select({ n: count() }).from(table))[0]?.n ?? 0;
  return {
    brands: await n(brands),
    categories: await n(categories),
    products: await n(products),
    variants: await n(variants),
    movements: await n(stockMovements),
  };
}

/**
 * Idempotent demo catalogue: ensures the settings row, then (only when no brand exists yet)
 * creates brands, categories, suppliers and 40 products with ~250 variants, recording each
 * variant's opening stock as an INITIAL movement through applyMovement (CLAUDE.md rule 1).
 * Deterministic: the fixed PRNG seed always yields the same catalogue.
 */
export async function seed(db: Db = getDb(), opts: SeedOptions = {}): Promise<SeedCounts> {
  const userId = opts.userId ?? null;
  await db.insert(settings).values({}).onConflictDoNothing();

  const [existing] = await db.select({ id: brands.id }).from(brands).limit(1);
  if (existing) return currentCounts(db);

  const rand = mulberry32(42);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  await db.transaction(async (tx) => {
    const brandRows = await tx.insert(brands).values(BRANDS.map((name) => ({ name }))).returning();
    const categoryRows = await tx.insert(categories).values(CATEGORIES.map((name) => ({ name }))).returning();
    await tx.insert(suppliers).values(SUPPLIERS);
    const categoryId = new Map(categoryRows.map((c) => [c.name, c.id]));

    // Plan every product and variant up front (consuming the PRNG in a fixed order), then insert in batches.
    const usedBaseSkus = new Set<string>();
    const planned = PRODUCTS.map((p, i) => {
      const brand = brandRows[i % brandRows.length]!;
      const stem = defaultBaseSku(brand.name, p.name);
      let baseSku = stem;
      for (let suffix = 2; usedBaseSkus.has(baseSku); suffix++) baseSku = `${stem}${suffix}`;
      usedBaseSkus.add(baseSku);

      const price = int(3, 25) * 10_000 - 100; // 299.00 .. 2,499.00 EGP in piastres
      const cost = Math.round((price * int(55, 70)) / 100 / 100) * 100; // 55–70 % of price, whole pounds

      const allSizes = SIZES[p.category];
      const [minSpan, maxSpan] = SIZE_SPAN[p.category];
      const span = Math.min(allSizes.length, int(minSpan, maxSpan));
      const start = int(0, allSizes.length - span);
      const sizes = allSizes.slice(start, start + span);

      const shuffled = [...PALETTE];
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = int(0, j);
        [shuffled[j], shuffled[k]] = [shuffled[k]!, shuffled[j]!];
      }
      const colours = shuffled.slice(0, int(2, 3));

      const vars = sizes.flatMap((size) =>
        colours.map((c) => ({
          size,
          colorName: c.name,
          colorHex: c.hex,
          sku: buildSku(baseSku, size, c.name),
          sellPrice: price,
          openingQty: rand() < 0.08 ? 0 : int(1, 40),
        })),
      );

      return {
        row: {
          name: p.name,
          brandId: brand.id,
          categoryId: categoryId.get(p.category)!,
          baseSku,
          defaultCost: cost,
          defaultPrice: price,
          createdBy: userId,
        },
        cost,
        vars,
      };
    });

    const productIds: string[] = [];
    for (let i = 0; i < planned.length; i += BATCH) {
      const rows = await tx
        .insert(products)
        .values(planned.slice(i, i + BATCH).map((p) => p.row))
        .returning({ id: products.id });
      productIds.push(...rows.map((r) => r.id));
    }

    // Explicit, strictly increasing timestamps in matrix order so createdAt ordering (sizes/colours) is deterministic.
    const baseTime = Date.now();
    const variantPlan = planned
      .flatMap((p, i) => p.vars.map((v) => ({ v, productId: productIds[i]!, cost: p.cost })))
      .map(({ v: { openingQty, ...v }, productId, cost }, n) => {
        const at = new Date(baseTime + n);
        const barcode = ean13(BARCODE_PREFIX + String(n + 1).padStart(9, '0'));
        return { values: { ...v, productId, barcode, createdAt: at, updatedAt: at }, openingQty, cost };
      });
    for (let i = 0; i < variantPlan.length; i += BATCH) {
      const chunk = variantPlan.slice(i, i + BATCH);
      const rows = await tx
        .insert(variants)
        .values(chunk.map((v) => v.values))
        .returning({ id: variants.id });
      for (const [j, row] of rows.entries()) {
        const v = chunk[j]!;
        if (v.openingQty === 0) continue;
        await applyMovement(tx, { variantId: row.id, type: 'INITIAL', qtyDelta: v.openingQty, unitCost: v.cost, reason: 'Seed', userId });
      }
    }
  });

  return currentCounts(db);
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed()
    .then((counts) => {
      console.log('seed complete', counts);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
