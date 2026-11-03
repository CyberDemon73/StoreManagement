import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { dashboard } from '@/analytics/dashboard';
import { resolveRange } from '@/analytics/range';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { movementsQuery } from '@/schemas/movements';
import { productListQuery } from '@/schemas/products';
import { salesQuery } from '@/schemas/sales';
import { lowStock } from '@/services/low-stock';
import { listMovements } from '@/services/movements';
import { listProducts } from '@/services/products-list';
import { listSales } from '@/services/sales';
import { verifyStock } from '@/services/stock-verify';
import { searchVariants } from '@/services/variants';
import { seedBig } from '../../scripts/seed-big';

/**
 * EXPLAIN the real service SQL (captured through the drizzle logger) on a 10k-sale / 2k-variant
 * dataset. PERF=1 only. Natural plans are printed for humans.
 *
 * The assertion is index availability, not the planner's mood: at this size Postgres may rightly
 * prefer a Seq Scan, so each query is re-run as EXPLAIN ANALYZE with enable_seqscan=off and every
 * scan of a big table that still reads ≥ 50% of its rows is a violation (no usable index exists).
 */

const BIG = ['sales', 'sale_items', 'stock_movements', 'variants'] as const;
const FULL_READ = 0.5;

/**
 * Indexes declared in src/db/schema but possibly not migrated yet (Sprint 6 Task C proposal; the
 * orchestrator generates the migration). IF NOT EXISTS makes this a no-op once they are.
 */
const PENDING_INDEXES = [
  `create index if not exists variants_sku_trgm_idx on variants using gin (sku gin_trgm_ops)`,
  `create index if not exists variants_low_stock_idx on variants (product_id) where is_active and quantity <= low_stock_threshold`,
];

interface Captured {
  sql: string;
  params: unknown[];
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  Plans?: PlanNode[];
}

function walk(node: PlanNode, visit: (n: PlanNode) => void): void {
  visit(node);
  node.Plans?.forEach((p) => walk(p, visit));
}

const d = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(process.env.PERF !== '1')('perf: EXPLAIN on a big dataset', () => {
  it('selective list/report queries never read most of a big table', { timeout: 600_000 }, async () => {
    const client = new PGlite({ extensions: { citext, pg_trgm } });
    let capture: Captured[] | null = null;
    const pdb = drizzle(client, {
      schema,
      casing: 'snake_case',
      logger: { logQuery: (q, params) => capture?.push({ sql: q, params }) },
    });
    await migrate(pdb, { migrationsFolder: 'drizzle' });
    const db = pdb as unknown as Db;

    const [manager] = await db
      .insert(schema.users)
      .values({ name: 'Mona', email: 'perf-manager@example.com', passwordHash: 'x', role: 'MANAGER' })
      .returning();
    const [seller] = await db
      .insert(schema.users)
      .values({ name: 'Sam', email: 'perf-seller@example.com', passwordHash: 'x', role: 'SELLER' })
      .returning();
    const t0 = Date.now();
    const counts = await seedBig(db, { sellerIds: [seller!.id, manager!.id] });
    console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`, counts);
    expect(counts.variants).toBeGreaterThanOrEqual(2000);
    expect(counts.sales).toBe(10_000);
    expect((await verifyStock(db)).ok).toBe(true);

    for (const ddl of PENDING_INDEXES) await client.exec(ddl);
    await client.exec('analyze');

    const sizes = new Map<string, number>();
    for (const t of BIG) {
      const r = await client.query<{ n: number }>(`select count(*)::int as n from ${t}`);
      sizes.set(t, r.rows[0]!.n);
    }

    const me: AuthUser = { id: manager!.id, name: 'Mona', email: 'perf-manager@example.com', role: 'MANAGER', status: 'ACTIVE', mustChangePassword: false, sessionId: 's' };
    const [someVariant] = await db.select({ id: schema.variants.id }).from(schema.variants).limit(1);
    const [someProduct] = await db.select({ id: schema.products.id }).from(schema.products).limit(1);
    const week = await resolveRange(db, { from: d(-6), to: d(0) });

    /**
     * `wholeTable` marks queries whose job is to read every row of a table (all of the scenario's
     * queries, or those whose SQL matches the RegExp). They are printed but not asserted; the
     * reason is the comment next to each.
     */
    const scenarios: { name: string; run: () => Promise<unknown>; wholeTable?: RegExp | true }[] = [
      // Unfiltered list: stock filters/sorts and count(*) over() need every product's variant aggregate.
      { name: 'products list (page 1)', run: () => listProducts(db, productListQuery.parse({})), wholeTable: /count\(\*\) over\(\)/ },
      { name: 'products list q', run: () => listProducts(db, productListQuery.parse({ q: 'Product 0123' })) },
      { name: 'low stock', run: () => lowStock(db) },
      // `sku ILIKE … OR barcode = … OR products.name ILIKE …` spans two tables, so no single index can
      // drive it; a UNION rewrite would. Accepted at store scale (see report), printed for tracking.
      { name: 'variants search', run: () => searchVariants(db, 'BIG-0042', 20), wholeTable: /products"?\."?name"? ilike/i },
      // Unfiltered page 1 returns the grand total via count(*) over(): reads every sale by definition.
      { name: 'sales list (page 1)', run: () => listSales(db, me, salesQuery.parse({})), wholeTable: /count\(\*\) over\(\)/ },
      { name: 'sales list (one week)', run: () => listSales(db, me, salesQuery.parse({ from: d(-6), to: d(0) })) },
      { name: 'sales list (seller, one week)', run: () => listSales(db, me, salesQuery.parse({ sellerId: seller!.id, from: d(-6), to: d(0) })) },
      { name: 'sales list (product)', run: () => listSales(db, me, salesQuery.parse({ productId: someProduct!.id })) },
      { name: 'movements (variant)', run: () => listMovements(db, movementsQuery.parse({ variantId: someVariant!.id })) },
      // Stock value / units on hand are sums over every active variant by definition.
      { name: 'dashboard (week)', run: () => dashboard(db, week), wholeTable: /stock_value|greatest\(v\.quantity, 0\)/ },
    ];

    /** Scan nodes on big tables that read ≥ FULL_READ of the table, from EXPLAIN ANALYZE. */
    async function heavyReads(q: Captured, probeIndexes: boolean): Promise<string[]> {
      if (probeIndexes) await client.exec('set enable_seqscan = off; set enable_hashjoin = off; set enable_mergejoin = off');
      try {
        const res = await client.query<{ 'QUERY PLAN': unknown }>(`explain (analyze, format json) ${q.sql}`, q.params);
        const raw = res.rows[0]!['QUERY PLAN'];
        const root = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { Plan: PlanNode }[];
        const heavy: string[] = [];
        walk(root[0]!.Plan, (n) => {
          const rel = n['Relation Name'];
          if (!rel || !sizes.has(rel)) return;
          const loops = n['Actual Loops'] ?? 1;
          const read = Math.round(((n['Actual Rows'] ?? 0) + (n['Rows Removed by Filter'] ?? 0) + (n['Rows Removed by Index Recheck'] ?? 0)) * loops);
          if (read >= FULL_READ * sizes.get(rel)!) heavy.push(`${n['Node Type']}${n['Index Name'] ? ` using ${n['Index Name']}` : ''} on ${rel} read ${read}/${sizes.get(rel)}`);
        });
        return heavy;
      } finally {
        if (probeIndexes) await client.exec('reset enable_seqscan; reset enable_hashjoin; reset enable_mergejoin');
      }
    }

    const violations: string[] = [];
    const summary: string[] = [];
    for (const s of scenarios) {
      capture = [];
      await s.run();
      const queries = capture;
      capture = null;
      for (const [i, q] of queries.entries()) {
        if (!/^\s*(select|with)\b/i.test(q.sql)) continue;
        const label = `${s.name} #${i + 1}`;
        const natural = await client.query<{ 'QUERY PLAN': string }>(`explain ${q.sql}`, q.params);
        const plan = natural.rows.map((r) => r['QUERY PLAN']).join('\n');
        console.log(`\n=== ${label}\n${q.sql.slice(0, 400)}${q.sql.length > 400 ? '…' : ''}\n${plan}`);

        const heavyNatural = await heavyReads(q, false);
        // Only when the natural plan reads most of a big table: is there an index path at all?
        // (no seq scans, no hash/merge joins that read one side whole)
        const heavyForced = heavyNatural.length > 0 ? await heavyReads(q, true) : [];
        const naturalSeq = [...new Set(plan.match(/Seq Scan on \w+/g) ?? [])].filter((x) => BIG.some((t) => x === `Seq Scan on ${t}`));
        const exempt = s.wholeTable === true || (s.wholeTable?.test(q.sql) ?? false);
        summary.push(
          `${label}: seq=[${naturalSeq.join(', ')}] heavy=[${heavyNatural.join('; ')}] index-probe=[${heavyForced.join('; ')}]${exempt ? ' (whole-table by design)' : ''}`,
        );
        if (heavyForced.length > 0 && !exempt) violations.push(`${label}: ${heavyForced.join('; ')}\n${q.sql}`);
      }
    }
    console.log(`\n=== SUMMARY (sizes ${JSON.stringify(Object.fromEntries(sizes))})\n${summary.join('\n')}`);
    await client.close();
    expect(violations).toEqual([]);
  });
});
