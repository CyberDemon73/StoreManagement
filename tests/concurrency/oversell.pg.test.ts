import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/sales/route';
import { getDb, setDb, type Db } from '@/db/client';
import * as schema from '@/db/schema';
import { verifyStock } from '@/services/stock-verify';
import { truncateAll } from '../helpers/db';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

/**
 * Real-Postgres race test (PGlite is single-connection, so it cannot race; DECISIONS 2026-11-03).
 * Runs only with DATABASE_URL_TEST pointing at a throwaway database: it TRUNCATEs every table.
 *   DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/avenue_test pnpm vitest run tests/concurrency
 */
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('concurrency on real Postgres', () => {
  let pool: Pool;
  let db: Db;
  let previous: Db | null = null;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 25 });
    const pg = drizzle(pool, { schema, casing: 'snake_case' });
    await migrate(pg, { migrationsFolder: 'drizzle' });
    db = pg as unknown as Db;
    previous = getDb();
    setDb(db);
  }, 120_000);

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    setDb(previous);
    await pool?.end();
  });

  async function sellerCookies(n: number): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const u = await createUser(db, { role: 'SELLER', name: `Seller ${i}` });
      out.push(await sessionCookieFor(db, u.id));
    }
    return out;
  }

  const sell = (cookie: string, items: { variantId: string; qty: number }[]) =>
    call(POST, { method: 'POST', path: '/api/v1/sales', cookie, body: { items, paymentMethod: 'CASH' } });

  it('20 parallel sales of qty 1 on a variant with 5 in stock: exactly 5 succeed, the rest 409', async () => {
    const manager = await createUser(db, { role: 'MANAGER' });
    const { variants } = await stockFixture(db, manager.id);
    const b = variants[1]; // quantity 5
    expect(b.quantity).toBe(5);
    // Several sellers so the per-user rate limit is not what serialises the requests.
    const cookies = await sellerCookies(4);

    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => sell(cookies[i % cookies.length]!, [{ variantId: b.id, qty: 1 }])));
    const statuses = responses.map((r) => r.status).sort();
    const counts = statuses.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
    expect(counts).toEqual({ 201: 5, 409: 15 });
    for (const r of responses.filter((x) => x.status === 409)) {
      expect((await r.json()).error.code).toBe('INSUFFICIENT_STOCK');
    }

    const [row] = await db.select({ q: schema.variants.quantity }).from(schema.variants).where(sql`${schema.variants.id} = ${b.id}`);
    expect(row!.q).toBe(0);
    const ledger = await db.execute(sql`select count(*)::int as n, coalesce(sum(qty_delta), 0)::int as delta,
      min(qty_after)::int as min_after from stock_movements where variant_id = ${b.id} and type = 'SALE'`);
    expect((ledger as unknown as { rows: { n: number; delta: number; min_after: number }[] }).rows[0]).toEqual({ n: 5, delta: -5, min_after: 0 });
    const saleCount = await db.execute(sql`select count(*)::int as n from sales`);
    expect((saleCount as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(5);
    expect(await verifyStock(db)).toEqual({ ok: true, mismatches: [] });
  }, 60_000);

  it('opposite-order multi-variant sales never deadlock (lockVariants sorts ids)', async () => {
    const manager = await createUser(db, { role: 'MANAGER' });
    const { variants } = await stockFixture(db, manager.id);
    const [a, b] = variants; // A 10, B 5
    const cookies = await sellerCookies(4);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        sell(
          cookies[i % cookies.length]!,
          i % 2 === 0
            ? [{ variantId: a.id, qty: 1 }, { variantId: b.id, qty: 1 }]
            : [{ variantId: b.id, qty: 1 }, { variantId: a.id, qty: 1 }],
        ),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 500)).toEqual([]);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5); // B (5) is the bottleneck
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(await verifyStock(db)).toEqual({ ok: true, mismatches: [] });
  }, 60_000);
});
