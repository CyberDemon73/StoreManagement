import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/v1/stock/purchases/route';
import { GET as GET_ONE } from '@/app/api/v1/stock/purchases/[id]/route';
import { getDb } from '@/db/client';
import { auditLog, stockMovements, suppliers, variants } from '@/db/schema';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

const KEY = '11111111-1111-4111-8111-111111111111';
const MISSING_ID = '00000000-0000-4000-8000-0000000000ff';

async function fixture() {
  const db = getDb();
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  const fx = await stockFixture(db, manager.id);
  const [supplier] = await db.select().from(suppliers);
  if (!supplier) throw new Error('fixture supplier missing');
  return { db, manager, supplier, cookie: await sessionCookieFor(db, manager.id), ...fx };
}

function body(fx: Awaited<ReturnType<typeof fixture>>) {
  const [a, b] = fx.variants;
  return {
    invoiceRef: 'INV-7',
    items: [
      { variantId: a.id, qty: 10, unitCost: 700 },
      { variantId: b.id, qty: 3, unitCost: 400 },
    ],
  };
}

async function post(cookie: string, payload: unknown, headers?: Record<string, string>) {
  const res = await call(POST, { method: 'POST', path: '/api/v1/stock/purchases', cookie, body: payload, headers });
  return { res, status: res.status, body: await res.json() };
}

describe('POST /stock/purchases', () => {
  it('creates a purchase: PO-000001, totals, moved quantities, re-averaged cost, PURCHASE movements, audit', async () => {
    const fx = await fixture();
    const { db, cookie, manager } = fx;
    const [a, b] = fx.variants;
    const { status, body: out } = await post(cookie, body(fx));
    expect(status).toBe(201);
    expect(out).toMatchObject({
      number: 'PO-000001',
      invoiceRef: 'INV-7',
      lineCount: 2,
      unitCount: 13,
      total: 10 * 700 + 3 * 400,
      createdBy: manager.id,
      createdByName: 'Mona',
    });
    // Items come back ordered by variantId (there is no position column), so compare as a set.
    expect(out.items).toHaveLength(2);
    expect(out.items).toEqual(
      expect.arrayContaining([
        { variantId: a.id, qty: 10, unitCost: 700 },
        { variantId: b.id, qty: 3, unitCost: 400 },
      ]),
    );
    expect(typeof out.receivedAt).toBe('string');
    expect(out).not.toHaveProperty('supplierId');

    const fresh = await db.select().from(variants);
    const byId = new Map(fresh.map((v) => [v.id, v]));
    expect(byId.get(a.id)).toMatchObject({ quantity: 20, costPrice: 600 });
    expect(byId.get(b.id)).toMatchObject({ quantity: 8 });

    const moves = await db.select().from(stockMovements).where(eq(stockMovements.type, 'PURCHASE'));
    expect(moves).toHaveLength(2);
    for (const m of moves) {
      expect(m).toMatchObject({ referenceKind: 'purchase', referenceId: out.id, userId: manager.id, reason: 'Purchase PO-000001 · INV-7' });
    }
    expect(moves.find((m) => m.variantId === a.id)).toMatchObject({ qtyDelta: 10, qtyAfter: 20, unitCost: 700 });

    const rows = await db.select().from(auditLog).where(and(eq(auditLog.action, 'purchase.create'), eq(auditLog.entityId, out.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: manager.id, entity: 'purchase', after: { number: 'PO-000001' } });
  });

  it('numbers purchases sequentially and records the supplier', async () => {
    const fx = await fixture();
    const [a] = fx.variants;
    const first = await post(fx.cookie, body(fx));
    expect(first.body.number).toBe('PO-000001');
    const second = await post(fx.cookie, { supplierId: fx.supplier.id, items: [{ variantId: a.id, qty: 1, unitCost: 100 }] });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ number: 'PO-000002', supplierId: fx.supplier.id, supplierName: 'Delta Textiles' });
  });

  it('replays the same Idempotency-Key + body with the identical response and no second movement', async () => {
    const fx = await fixture();
    const first = await post(fx.cookie, body(fx), { 'idempotency-key': KEY });
    expect(first.status).toBe(201);
    expect(first.res.headers.get('Idempotent-Replayed')).toBeNull();
    const again = await post(fx.cookie, body(fx), { 'idempotency-key': KEY });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.res.headers.get('Idempotent-Replayed')).toBe('true');
    const moves = await fx.db.select().from(stockMovements).where(eq(stockMovements.type, 'PURCHASE'));
    expect(moves).toHaveLength(2);
  });

  it('same key with a different body → 409; malformed key → 400', async () => {
    const fx = await fixture();
    await post(fx.cookie, body(fx), { 'idempotency-key': KEY });
    const other = await post(fx.cookie, { ...body(fx), invoiceRef: 'INV-8' }, { 'idempotency-key': KEY });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('CONFLICT');
    const bad = await post(fx.cookie, body(fx), { 'idempotency-key': 'not-a-uuid' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/Idempotency-Key/);
  });

  it('validates: empty items → 400; qty 0 → 400 fields["items.0.qty"]; nothing inserted', async () => {
    const fx = await fixture();
    const [a] = fx.variants;
    const empty = await post(fx.cookie, { items: [] });
    expect(empty.status).toBe(400);
    const zero = await post(fx.cookie, { items: [{ variantId: a.id, qty: 0, unitCost: 100 }] });
    expect(zero.status).toBe(400);
    expect(zero.body.error.fields['items.0.qty']).toBeDefined();
    const big = await post(fx.cookie, { items: [{ variantId: a.id, qty: 1, unitCost: 3_000_000_000 }] });
    expect(big.status).toBe(400);
    expect(big.body.error.fields['items.0.unitCost']).toBeDefined();
    expect(await fx.db.select().from(stockMovements).where(eq(stockMovements.type, 'PURCHASE'))).toHaveLength(0);
  });

  it('unknown variant → 404 and nothing inserted; unknown supplier → 404', async () => {
    const fx = await fixture();
    const [a] = fx.variants;
    const res = await post(fx.cookie, { items: [{ variantId: a.id, qty: 1, unitCost: 100 }, { variantId: MISSING_ID, qty: 1, unitCost: 100 }] });
    expect(res.status).toBe(404);
    expect(res.body.error.fields[MISSING_ID]).toBeDefined();
    expect(await fx.db.select().from(stockMovements).where(eq(stockMovements.type, 'PURCHASE'))).toHaveLength(0);
    const sup = await post(fx.cookie, { supplierId: MISSING_ID, items: [{ variantId: a.id, qty: 1, unitCost: 100 }] });
    expect(sup.status).toBe(404);
  });

  it('SELLER → 403 on create, list and get', async () => {
    const fx = await fixture();
    const s = await createUser(fx.db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(fx.db, s.id);
    expect((await post(cookie, body(fx))).status).toBe(403);
    expect((await call(GET, { path: '/api/v1/stock/purchases', cookie })).status).toBe(403);
    expect((await call(GET_ONE, { path: `/api/v1/stock/purchases/${MISSING_ID}`, cookie, params: { id: MISSING_ID } })).status).toBe(403);
  });
});

describe('GET /stock/purchases', () => {
  it('lists newest receivedAt first with aggregates and names; GET /:id returns the purchase; unknown → 404', async () => {
    const fx = await fixture();
    const [a] = fx.variants;
    const older = await post(fx.cookie, { receivedAt: '2024-01-01T00:00:00Z', supplierId: fx.supplier.id, items: [{ variantId: a.id, qty: 2, unitCost: 100 }] });
    const newer = await post(fx.cookie, body(fx));
    const res = await call(GET, { path: '/api/v1/stock/purchases?pageSize=10', cookie: fx.cookie });
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toMatchObject({ page: 1, pageSize: 10, total: 2 });
    expect(list.data.map((p: { id: string }) => p.id)).toEqual([newer.body.id, older.body.id]);
    expect(list.data[1]).toMatchObject({ number: 'PO-000001', supplierName: 'Delta Textiles', createdByName: 'Mona', lineCount: 1, unitCount: 2, total: 200, receivedAt: '2024-01-01T00:00:00.000Z' });
    expect(list.data[0].items).toHaveLength(2);

    const one = await call(GET_ONE, { path: `/api/v1/stock/purchases/${newer.body.id}`, cookie: fx.cookie, params: { id: newer.body.id } });
    expect(one.status).toBe(200);
    expect(await one.json()).toEqual(newer.body);

    const missing = await call(GET_ONE, { path: `/api/v1/stock/purchases/${MISSING_ID}`, cookie: fx.cookie, params: { id: MISSING_ID } });
    expect(missing.status).toBe(404);

    const badPage = await call(GET, { path: '/api/v1/stock/purchases?pageSize=500', cookie: fx.cookie });
    expect(badPage.status).toBe(400);
  });
});
