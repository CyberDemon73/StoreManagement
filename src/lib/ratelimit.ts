import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getEnv } from './env';
import { AppError } from './errors';
import { logger } from './logger';

export interface LimitResult {
  success: boolean;
  remaining: number;
  /** Epoch milliseconds when the window resets. */
  reset: number;
}

export interface Limiter {
  limit(key: string): Promise<LimitResult>;
}

let warnedMemoryFallback = false;

// Shared across in-memory limiters so tests can wipe state between cases.
const memoryBuckets = new Map<string, number[]>();

function memoryLimiter(name: string, tokens: number, windowMs: number): Limiter {
  return {
    async limit(key) {
      const now = Date.now();
      const id = `${name}:${key}`;
      const hits = (memoryBuckets.get(id) ?? []).filter((t) => t > now - windowMs);
      if (hits.length >= tokens) {
        memoryBuckets.set(id, hits);
        return { success: false, remaining: 0, reset: (hits[0] ?? now) + windowMs };
      }
      hits.push(now);
      memoryBuckets.set(id, hits);
      return { success: true, remaining: tokens - hits.length, reset: (hits[0] ?? now) + windowMs };
    },
  };
}

function upstashLimiter(name: string, tokens: number, windowMs: number, url: string, token: string): Limiter {
  const rl = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(tokens, `${windowMs} ms`),
    prefix: `as:rl:${name}`,
  });
  return {
    async limit(key) {
      const r = await rl.limit(key);
      return { success: r.success, remaining: r.remaining, reset: r.reset };
    },
  };
}

/** Sliding-window limiter: Upstash when configured, otherwise process memory (dev/tests). */
export function createLimiter(name: string, tokens: number, windowMs: number): Limiter {
  const env = getEnv();
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = env;
  if (url && token) return upstashLimiter(name, tokens, windowMs, url, token);
  if (env.NODE_ENV === 'production' && !warnedMemoryFallback) {
    // Per-instance memory is not shared across serverless instances: limits are effectively off.
    warnedMemoryFallback = true;
    logger.error('Upstash not configured: falling back to in-memory rate limiting');
  }
  return memoryLimiter(name, tokens, windowMs);
}

export async function enforce(limiter: Limiter, key: string): Promise<void> {
  const r = await limiter.limit(key);
  if (r.success) return;
  const retryAfter = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
  throw new AppError('RATE_LIMITED', 'Too many requests', { retryAfter });
}

export function resetMemoryLimiters(): void {
  memoryBuckets.clear();
}

// Limits from docs/SECURITY.md.
export const loginIpLimiter = createLimiter('login-ip', 5, 60_000);
export const loginEmailLimiter = createLimiter('login-email', 10, 3_600_000);
export const forgotEmailLimiter = createLimiter('forgot-email', 3, 3_600_000);
export const apiUserLimiter = createLimiter('api-user', 120, 60_000);
/** Public auth endpoints (setup, forgot, reset): coarse per-IP cap against token brute force and email bombing. */
export const publicIpLimiter = createLimiter('public-ip', 20, 3_600_000);
