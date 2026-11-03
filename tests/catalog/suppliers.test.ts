import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/v1/suppliers/route';
import { PATCH } from '@/app/api/v1/suppliers/[id]/route';
import { getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const MISSING_ID = '00000000-0000-4000-8000-0000000000ff';

async function manager() {
  const db = getDb();
  const m = await createUser(db, { role: 'MANAGER' });
  return { db, m, cookie: await sessionCookieFor(db, m.id) };
}

describe('suppliers', () => {
  it('MANAGER creates a supplier (201, isActive:true) and writes an audit row', async () => {
    const { db, m, cookie } = await manager();
    const res = await call(POST, {
      method: 'POST',
      path: '/api/v1/suppliers',
      cookie,
      body: { name: 'Delta Textiles', phone: '+20 100 000 0000' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      name: 'Delta Textiles',
      phone: '+20 100 000 0000',
      isActive: true,
      purchaseCount: 0,
      lastPurchaseAt: null,
    });
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'supplier.create'), eq(auditLog.entityId, body.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: m.id, entity: 'supplier' });
  });

  it('list returns suppliers with purchaseCount 0 and lastPurchaseAt null', async () => {
    const { cookie } = await manager();
    await call(POST, { method: 'POST', path: '/api/v1/suppliers', cookie, body: { name: 'Delta' } });
    const res = await call(GET, { path: '/api/v1/suppliers', cookie });
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Delta', purchaseCount: 0, lastPurchaseAt: null });
  });

  it('duplicate name returns 409 with fields.name', async () => {
    const { cookie } = await manager();
    await call(POST, { method: 'POST', path: '/api/v1/suppliers', cookie, body: { name: 'Delta' } });
    const res = await call(POST, { method: 'POST', path: '/api/v1/suppliers', cookie, body: { name: 'Delta' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.name).toBeDefined();
  });

  it('PATCH isActive:false keeps the supplier listed and audits before/after', async () => {
    const { db, cookie } = await manager();
    const created = await (await call(POST, { method: 'POST', path: '/api/v1/suppliers', cookie, body: { name: 'Delta' } })).json();
    const res = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/suppliers/${created.id}`,
      cookie,
      params: { id: created.id },
      body: { isActive: false, notes: 'Slow' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, isActive: false, notes: 'Slow' });
    const list = await (await call(GET, { path: '/api/v1/suppliers', cookie })).json();
    expect(list[0]).toMatchObject({ id: created.id, isActive: false });
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'supplier.update'));
    expect(rows[0]).toMatchObject({ entityId: created.id, before: { isActive: true }, after: { isActive: false } });
  });

  it('SELLER can GET (200) but not POST (403)', async () => {
    const db = getDb();
    const s = await createUser(db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(db, s.id);
    expect((await call(GET, { path: '/api/v1/suppliers', cookie })).status).toBe(200);
    expect((await call(POST, { method: 'POST', path: '/api/v1/suppliers', cookie, body: { name: 'X' } })).status).toBe(403);
  });

  it('PATCH unknown id returns 404; extra field returns 400', async () => {
    const { cookie } = await manager();
    const res = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/suppliers/${MISSING_ID}`,
      cookie,
      params: { id: MISSING_ID },
      body: { name: 'Y' },
    });
    expect(res.status).toBe(404);
    const bad = await call(POST, { method: 'POST', path: '/api/v1/suppliers', cookie, body: { name: 'X', email: 'a@b.c' } });
    expect(bad.status).toBe(400);
  });

  it('SELLER list omits phone and notes; MANAGER list includes them', async () => {
    const { db, cookie } = await manager();
    await call(POST, { method: 'POST', path: '/api/v1/suppliers', cookie, body: { name: 'Delta', phone: '123', notes: 'n' } });
    const mList = await (await call(GET, { path: '/api/v1/suppliers', cookie })).json();
    expect(mList[0]).toMatchObject({ phone: '123', notes: 'n' });
    const s = await createUser(db, { role: 'SELLER' });
    const sCookie = await sessionCookieFor(db, s.id);
    const sList = await (await call(GET, { path: '/api/v1/suppliers', cookie: sCookie })).json();
    expect(sList[0].name).toBe('Delta');
    expect(sList[0]).not.toHaveProperty('phone');
    expect(sList[0]).not.toHaveProperty('notes');
  });
});

describe('suppliers with purchases', () => {
  it('list shows purchaseCount 1 and lastPurchaseAt once a purchase names the supplier', async () => {
    const { db, m, cookie } = await manager();
    const { stockFixture } = await import('../helpers/stock');
    const { POST: createPurchase } = await import('@/app/api/v1/stock/purchases/route');
    const fx = await stockFixture(db, m.id);
    const created = await (await call(POST, { method: 'POST', path: '/api/v1/suppliers', cookie, body: { name: 'Omega' } })).json();
    const res = await call(createPurchase, {
      method: 'POST',
      path: '/api/v1/stock/purchases',
      cookie,
      body: { supplierId: created.id, receivedAt: '2024-03-05T10:00:00Z', items: [{ variantId: fx.variants[0].id, qty: 1, unitCost: 100 }] },
    });
    expect(res.status).toBe(201);
    const list = await (await call(GET, { path: '/api/v1/suppliers', cookie })).json();
    const omega = list.find((s: { id: string }) => s.id === created.id);
    expect(omega).toMatchObject({ purchaseCount: 1, lastPurchaseAt: '2024-03-05T10:00:00.000Z' });
    const delta = list.find((s: { name: string }) => s.name === 'Delta Textiles');
    expect(delta).toMatchObject({ purchaseCount: 0, lastPurchaseAt: null });
  });
});
