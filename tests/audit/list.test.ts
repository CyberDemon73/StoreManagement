import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/audit/route';
import { getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { audit } from '@/lib/audit';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

async function list(cookie: string, qs = '') {
  const res = await call(GET, { path: `/api/v1/audit${qs}`, cookie });
  return { status: res.status, body: await res.json() };
}

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

  it('rejects an out-of-range pageSize and unknown query keys', async () => {
    const db = getDb();
    const m = await createUser(db, { role: 'ADMIN' });
    const cookie = await sessionCookieFor(db, m.id);
    expect((await list(cookie, '?pageSize=500')).status).toBe(400);
    expect((await list(cookie, '?sort=asc')).status).toBe(400);
    expect((await list(cookie, '?userId=nope')).status).toBe(400);
    expect((await list(cookie, '?from=2026-13-01')).status).toBe(400);
  });

  it('shapes rows as AuditEntry: userName, entityLabel, summary', async () => {
    const db = getDb();
    const m = await createUser(db, { role: 'MANAGER', name: 'Mona' });
    const saleId = '00000000-0000-4000-8000-0000000000aa';
    const productId = 'abcdef12-0000-4000-8000-000000000001';
    await audit(db, { userId: m.id, ip: '203.0.113.7', userAgent: 'ua' }, 'sale.create', 'sale', saleId, null, { number: 'AS-000001', total: 100 });
    await audit(db, { userId: m.id }, 'product.update', 'product', productId, { name: 'Tee', price: 1, cost: 1 }, { price: 2, cost: 1 });
    await audit(db, { userId: null }, 'settings.update', 'settings', null, { storeName: 'A' }, { storeName: 'B' });
    await audit(db, { userId: m.id }, 'thing.touch', 'thing', productId, null, null);

    const { status, body } = await list(await sessionCookieFor(db, m.id));
    expect(status).toBe(200);
    const byAction = Object.fromEntries(body.data.map((r: { action: string }) => [r.action, r]));

    expect(byAction['sale.create']).toMatchObject({
      userId: m.id,
      userName: 'Mona',
      entityId: saleId,
      entityLabel: 'AS-000001',
      summary: 'sale.create',
      ip: '203.0.113.7',
      userAgent: 'ua',
    });
    expect(byAction['sale.create']).not.toHaveProperty('before');
    // Label falls back to before.name; summary lists keys whose value changed.
    expect(byAction['product.update']).toMatchObject({ entityLabel: 'Tee', summary: 'product.update: name, price' });
    expect(byAction['settings.update']).toMatchObject({ userName: 'System', entityLabel: 'settings', summary: 'settings.update: storeName' });
    expect(byAction['settings.update']).not.toHaveProperty('userId');
    expect(byAction['settings.update']).not.toHaveProperty('entityId');
    expect(byAction['thing.touch']).toMatchObject({ entityLabel: 'abcdef12', summary: 'thing.touch' });
  });

  it('filters by q, userId, entity, action and local date range', async () => {
    const db = getDb();
    const m = await createUser(db, { role: 'MANAGER' });
    const other = await createUser(db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(db, m.id);
    const productId = '12345678-0000-4000-8000-000000000001';
    await audit(db, { userId: m.id }, 'product.update', 'product', productId, null, { name: 'Tee' });
    await audit(db, { userId: other.id }, 'sale.create', 'sale', null, null, { number: 'AS-000002' });
    await audit(db, { userId: m.id }, 'settings.update', 'settings', null, null, { storeName: 'B' });
    // Store tz is Africa/Cairo (UTC+2 in January): 23:00Z on the 10th is the 11th locally.
    await db.insert(auditLog).values([
      { action: 'old.inside', entity: 'x', createdAt: new Date('2026-01-10T23:00:00Z') },
      { action: 'old.before', entity: 'x', createdAt: new Date('2026-01-10T21:00:00Z') },
      { action: 'old.after', entity: 'x', createdAt: new Date('2026-01-11T22:30:00Z') },
    ]);

    const actions = async (qs: string) => {
      const r = await list(cookie, qs);
      expect(r.status).toBe(200);
      return r.body.data.map((d: { action: string }) => d.action).sort();
    };

    expect(await actions('?q=PRODUCT')).toEqual(['product.update']);
    expect(await actions('?q=12345678')).toEqual(['product.update']);
    expect(await actions('?q=%25')).toEqual([]);
    expect(await actions(`?userId=${other.id}`)).toEqual(['sale.create']);
    expect(await actions('?entity=settings')).toEqual(['settings.update']);
    expect(await actions('?action=sale.create')).toEqual(['sale.create']);
    expect(await actions('?from=2026-01-11&to=2026-01-11')).toEqual(['old.inside']);
    const totalOnly = await list(cookie, '?entity=x&pageSize=1');
    expect(totalOnly.body.total).toBe(3);
  });
});
