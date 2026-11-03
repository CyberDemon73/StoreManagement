import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';

export interface TestDb {
  db: Db;
  close(): Promise<void>;
}

/** In-process Postgres with the real migrations applied. One per test file. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite({ extensions: { citext, pg_trgm } });
  const pglite = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(pglite, { migrationsFolder: 'drizzle' });
  return { db: pglite as unknown as Db, close: () => client.close() };
}

const TABLES = ['notifications', 'known_devices', 'return_items', 'returns', 'sale_items', 'sales', 'parked_sales', 'idempotency_keys', 'stock_count_items', 'stock_counts', 'purchase_items', 'purchases', 'sale_counters', 'stock_movements', 'variants', 'products', 'suppliers', 'categories', 'brands', 'audit_log', 'password_reset_tokens', 'sessions', 'failed_logins', 'settings', 'users'];

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`));
}
