import { neonConfig, Pool } from '@neondatabase/serverless';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { getEnv } from '@/lib/env';
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
  if (!url) throw new Error('DATABASE_URL is not set');
  // Node has no global WebSocket on older runtimes; Vercel's Node runtime is fine with ws.
  neonConfig.webSocketConstructor = ws;
  current = drizzle(new Pool({ connectionString: url }), { schema, casing: 'snake_case' }) as unknown as Db;
  return current;
}

/** Test seam: swap in a PGlite-backed instance. Pass null to drop the cached handle. */
export function setDb(db: Db | null): void {
  current = db;
}

export { schema };
