import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/health/route';
import { call } from './helpers/http';

describe('GET /health', () => {
  it('reports ok with the database up, without a session', async () => {
    const res = await call(GET, { path: '/api/v1/health' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: 'up' });
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });
});
