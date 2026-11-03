import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/stock/adjustments/route';
import { getDb } from '@/db/client';
import { auditLog, stockMovements, variants } from '@/db/schema';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

async function fixture() {
  const db = getDb();
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  const fx = await stockFixture(db, manager.id);
  return { db, manager, cookie: await sessionCookieFor(db, manager.id), ...fx };
}

async function adjust(cookie: string | null, body: unknown) {
  const res = await call(POST, { method: 'POST', path: '/api/v1/stock/adjustments', cookie, body });
  return { status: res.status, body: await res.json() };
}

const qtyOf = async (id: string) => (await getDb().select({ q: variants.quantity }).from(variants).where(eq(variants.id, id)))[0]!.q;
const adjustmentRows = () => getDb().select().from(stockMovements).where(eq(stockMovements.type, 'ADJUSTMENT'));

describe('POST /stock/adjustments', () => {
  it('books qtyDelta -4 on A(10) as an ADJUSTMENT with qtyAfter 6 and audits it', async () => {
    const { db, cookie, manager, variants: [a], product } = await fixture();
    const { status, body } = await adjust(cookie, { items: [{ variantId: a.id, qtyDelta: -4, reason: 'DAMAGED', note: 'water' }] });
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      variantId: a.id,
      type: 'ADJUSTMENT',
      qtyDelta: -4,
      qtyAfter: 6,
      reason: 'DAMAGED: water',
      userId: manager.id,
      userName: 'Mona',
      variant: { sku: a.sku, productName: product.name },
    });
    expect(body[0].unitCost).toBeUndefined();
    expect(await qtyOf(a.id)).toBe(6);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'stock.adjust'));
    expect(entry).toMatchObject({ entity: 'variant', userId: manager.id, after: { items: [{ variantId: a.id, qtyDelta: -4, reason: 'DAMAGED' }] } });
  });

  it('returns [] and writes no row when newQty equals the current quantity', async () => {
    const { cookie, variants: [a] } = await fixture();
    const { status, body } = await adjust(cookie, { items: [{ variantId: a.id, newQty: 10, reason: 'CORRECTION' }] });
    expect(status).toBe(200);
    expect(body).toEqual([]);
    expect(await adjustmentRows()).toHaveLength(0);
    expect(await qtyOf(a.id)).toBe(10);
  });

  it('computes the delta from newQty (B: 5 -> 2 is -3) and tracks running quantity within one request', async () => {
    const { cookie, variants: [a, b] } = await fixture();
    const { status, body } = await adjust(cookie, {
      items: [
        { variantId: b.id, newQty: 2, reason: 'LOST' },
        { variantId: a.id, qtyDelta: 3, reason: 'FOUND' },
        { variantId: a.id, newQty: 13, reason: 'CORRECTION' },
      ],
    });
    expect(status).toBe(200);
    // The third item is a no-op because the second already brought A to 13.
    expect(body.map((m: { variantId: string; qtyDelta: number; qtyAfter: number; reason: string }) => [m.variantId, m.qtyDelta, m.qtyAfter, m.reason])).toEqual([
      [b.id, -3, 2, 'LOST'],
      [a.id, 3, 13, 'FOUND'],
    ]);
    expect(await qtyOf(b.id)).toBe(2);
    expect(await qtyOf(a.id)).toBe(13);
  });

  it('rejects an adjustment below zero with 409 INSUFFICIENT_STOCK and writes nothing', async () => {
    const { cookie, variants: [a, b] } = await fixture();
    const { status, body } = await adjust(cookie, {
      items: [
        { variantId: b.id, qtyDelta: -1, reason: 'LOST' },
        { variantId: a.id, qtyDelta: -20, reason: 'LOST' },
      ],
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(body.error.fields).toHaveProperty(a.id);
    expect(await adjustmentRows()).toHaveLength(0);
    expect(await qtyOf(b.id)).toBe(5);
  });

  it('returns 404 for an unknown variant', async () => {
    const { cookie } = await fixture();
    const { status } = await adjust(cookie, { items: [{ variantId: '00000000-0000-4000-8000-000000000001', qtyDelta: 1, reason: 'FOUND' }] });
    expect(status).toBe(404);
  });

  it('validates: both or neither of qtyDelta/newQty, qtyDelta 0, empty items, unknown keys -> 400', async () => {
    const { cookie, variants: [a] } = await fixture();
    const bad = [
      { items: [{ variantId: a.id, qtyDelta: 1, newQty: 1, reason: 'FOUND' }] },
      { items: [{ variantId: a.id, reason: 'FOUND' }] },
      { items: [{ variantId: a.id, qtyDelta: 0, reason: 'FOUND' }] },
      { items: [{ variantId: a.id, qtyDelta: 1, reason: 'BROKEN' }] },
      { items: [] },
      { items: [{ variantId: a.id, qtyDelta: 1, reason: 'FOUND' }], extra: true },
    ];
    for (const body of bad) {
      const res = await adjust(cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
    expect(await adjustmentRows()).toHaveLength(0);
  });

  it('returns 403 for a SELLER and 401 anonymously', async () => {
    const { db, variants: [a] } = await fixture();
    const s = await createUser(db, { role: 'SELLER' });
    const body = { items: [{ variantId: a.id, qtyDelta: 1, reason: 'FOUND' }] };
    const forbidden = await adjust(await sessionCookieFor(db, s.id), body);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect((await adjust(null, body)).status).toBe(401);
    expect(await qtyOf(a.id)).toBe(10);
  });
});
