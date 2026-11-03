import { Redis } from '@upstash/redis';
import { getEnv } from './env';
import { logger } from './logger';

/** Preview and production may share one Upstash database: scope every key by environment. */
function scope(): string {
  const env = getEnv();
  return `an:${env.VERCEL_ENV ?? env.NODE_ENV}:`;
}
const versionKey = () => `${scope()}version`;
const DEFAULT_TTL_SECONDS = 60;

type CacheStore = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  incr(key: string): Promise<number>;
};

let testStore: CacheStore | null = null;
let redis: Redis | null = null;

/** Test seam: an in-memory store standing in for Upstash. Pass null to restore. */
export function setCacheStoreForTests(store: CacheStore | null): void {
  testStore = store;
}

function store(): CacheStore | null {
  if (testStore) return testStore;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = getEnv();
  if (!url || !token) return null;
  redis ??= new Redis({ url, token });
  const r = redis;
  return {
    get: <T>(key: string) => r.get<T>(key),
    set: async (key, value, ttl) => {
      await r.set(key, value, { ex: ttl });
    },
    incr: (key) => r.incr(key),
  };
}

/**
 * Memoise an analytics result. Keys embed the current analytics version, so bumping the version
 * (on any sale/stock mutation) invalidates every cached report without pattern deletes.
 * Without Upstash this is a pass-through; cache failures never fail the request.
 */
export async function memo<T>(key: string, fn: () => Promise<T>, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<T> {
  const s = store();
  if (!s) return fn();
  let fullKey: string | null = null;
  try {
    const version = (await s.get<number>(versionKey())) ?? 0;
    fullKey = `${scope()}v${version}:${key}`;
    const hit = await s.get<T>(fullKey);
    if (hit !== null && hit !== undefined) return hit;
  } catch (err) {
    logger.warn({ err: { message: (err as Error).message } }, 'analytics cache read failed');
  }
  const value = await fn();
  if (fullKey) {
    try {
      await s.set(fullKey, value, ttlSeconds);
    } catch (err) {
      logger.warn({ err: { message: (err as Error).message } }, 'analytics cache write failed');
    }
  }
  return value;
}

/** Invalidate every cached report (call after commit of any sale/stock mutation). */
export async function bumpAnalyticsVersion(): Promise<void> {
  const s = store();
  if (!s) return;
  try {
    await s.incr(versionKey());
  } catch (err) {
    logger.warn({ err: { message: (err as Error).message } }, 'analytics cache bump failed');
  }
}
