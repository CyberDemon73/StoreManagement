import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { createLimiter, enforce, resetMemoryLimiters } from '@/lib/ratelimit';

afterEach(() => {
  vi.useRealTimers();
  resetMemoryLimiters();
});

describe('in-memory rate limiter', () => {
  it('allows `tokens` calls per window, then refuses', async () => {
    const limiter = createLimiter('t', 2, 1000);
    expect((await limiter.limit('k')).success).toBe(true);
    expect((await limiter.limit('k')).success).toBe(true);
    const third = await limiter.limit('k');
    expect(third.success).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('isolates keys', async () => {
    const limiter = createLimiter('t', 1, 1000);
    expect((await limiter.limit('a')).success).toBe(true);
    expect((await limiter.limit('b')).success).toBe(true);
    expect((await limiter.limit('a')).success).toBe(false);
  });

  it('allows again once the window has passed', async () => {
    vi.useFakeTimers();
    const limiter = createLimiter('t', 1, 1000);
    expect((await limiter.limit('k')).success).toBe(true);
    expect((await limiter.limit('k')).success).toBe(false);
    vi.advanceTimersByTime(1001);
    expect((await limiter.limit('k')).success).toBe(true);
  });

  it('enforce() throws RATE_LIMITED with retryAfter', async () => {
    const limiter = createLimiter('t', 1, 60_000);
    await enforce(limiter, 'k');
    try {
      await enforce(limiter, 'k');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.code).toBe('RATE_LIMITED');
      expect(err.status).toBe(429);
      expect(err.retryAfter).toBeGreaterThanOrEqual(1);
      expect(err.retryAfter).toBeLessThanOrEqual(60);
    }
  });
});

describe('fail-open when the limiter backend is down', () => {
  it('lets the request through (and does not throw) when Redis errors', async () => {
    const { withFailOpen } = await import('@/lib/ratelimit');
    const broken = withFailOpen('login', { limit: async () => { throw new Error('ECONNREFUSED'); } });
    const r = await broken.limit('someone');
    expect(r.success).toBe(true);
    await expect(enforce(broken, 'someone')).resolves.toBeUndefined();
  });

  it('still refuses when the backend answers "limited"', async () => {
    const { withFailOpen } = await import('@/lib/ratelimit');
    const limited = withFailOpen('login', { limit: async () => ({ success: false, remaining: 0, reset: Date.now() + 1000 }) });
    await expect(enforce(limited, 'someone')).rejects.toBeInstanceOf(AppError);
  });
});
