import { neonConfig, Pool } from '@neondatabase/serverless';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import * as schema from './schema';

/**
 * Driver-agnostic database handle. Runtime uses the Neon WebSocket pool (interactive
 * transactions, needed for SELECT ... FOR UPDATE in Sprint 2); tests inject PGlite.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let current: Db | null = null;

export function getDb(): Db {
  if (current) return current;
  const url = getEnv().DATABASE_URL;
  // A missing URL is reported at query time (the pool throws a clear error), not here:
  // that lets /health answer "db down" instead of the whole request failing.
  if (!url) logger.warn('DATABASE_URL is not set; database queries will fail');
  // Node has no global WebSocket on older runtimes; Vercel's Node runtime is fine with ws.
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 });
  // An idle client erroring (e.g. Neon closing the socket) must not crash the process.
  pool.on('error', (err: Error) => logger.error({ err: { name: err.name, message: err.message } }, 'pg pool error'));
  current = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Db;
  return current;
}

/** Test seam: swap in a PGlite-backed instance. Pass null to drop the cached handle. */
export function setDb(db: Db | null): void {
  current = db;
}

export { schema };
