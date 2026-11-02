import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/audit/route';
import { getDb } from '@/db/client';
import { audit } from '@/lib/audit';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

describe('GET /audit', () => {
  it('lists entries newest first with pagination for a MANAGER', async () => {
    const db = getDb();
    const m = await createUser(db, { role: 'MANAGER' });
    await audit(db, { userId: m.id }, 'first.action', 'user', m.id, null, null);
    await audit(db, { userId: m.id }, 'second.action', 'user', m.id, null, { x: 1 });
    const res = await call(GET, { path: '/api/v1/audit?pageSize=1', cookie: await sessionCookieFor(db, m.id) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ action: 'second.action', entity: 'user', userId: m.id, after: { x: 1 } });
    expect(body.data[0].createdAt).toBeTypeOf('string');
  });

  it('returns 403 for a SELLER and 401 anonymously', async () => {
    const db = getDb();
    const s = await createUser(db, { role: 'SELLER' });
    const forbidden = await call(GET, { path: '/api/v1/audit', cookie: await sessionCookieFor(db, s.id) });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('FORBIDDEN');
    expect((await call(GET, { path: '/api/v1/audit' })).status).toBe(401);
  });

  it('rejects an out-of-range pageSize', async () => {
    const db = getDb();
    const m = await createUser(db, { role: 'ADMIN' });
    const res = await call(GET, { path: '/api/v1/audit?pageSize=500', cookie: await sessionCookieFor(db, m.id) });
    expect(res.status).toBe(400);
  });
});
