import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv, resetEnvForTests } from '@/lib/env';

describe('getEnv Upstash variable names', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it('falls back to the KV_REST_API_* names injected by the Vercel Upstash integration', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example.upstash.io');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    resetEnvForTests();
    expect(getEnv().UPSTASH_REDIS_REST_URL).toBe('https://kv.example.upstash.io');
    expect(getEnv().UPSTASH_REDIS_REST_TOKEN).toBe('kv-token');
  });

  it('prefers explicit UPSTASH_REDIS_REST_* values', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://explicit.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'explicit');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example.upstash.io');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    resetEnvForTests();
    expect(getEnv().UPSTASH_REDIS_REST_URL).toBe('https://explicit.upstash.io');
    expect(getEnv().UPSTASH_REDIS_REST_TOKEN).toBe('explicit');
  });
});
