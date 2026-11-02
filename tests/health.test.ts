import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/health/route';
import { getDb, setDb } from '@/db/client';
import { call } from './helpers/http';

describe('GET /health', () => {
  it('reports ok with the database up, without a session', async () => {
    const res = await call(GET, { path: '/api/v1/health' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: 'up' });
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('reports db down with 503 when the database is unreachable', async () => {
    const saved = getDb();
    setDb(null); // DATABASE_URL is empty in tests → runtime pool cannot connect
    try {
      const res = await call(GET, { path: '/api/v1/health' });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, db: 'down' });
    } finally {
      setDb(saved);
    }
  });
});
