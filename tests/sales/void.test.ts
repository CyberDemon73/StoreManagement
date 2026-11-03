import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/sales/[id]/void/route';
import { getDb } from '@/db/client';
import { auditLog, sales, settings, stockMovements, variants } from '@/db/schema';
import { call } from '../helpers/http';
import { saleFixture } from '../helpers/sales';
import { sessionCookieFor } from '../helpers/users';

async function setup() {
  const db = getDb();
  await db.insert(settings).values({}).onConflictDoNothing();
  const fx = await saleFixture(db);
  return { db, ...fx, sellerCookie: await sessionCookieFor(db, fx.seller.id), managerCookie: await sessionCookieFor(db, fx.manager.id) };
}

function post(cookie: string, id: string, body: unknown) {
  return call(POST, { method: 'POST', path: `/api/v1/sales/${id}/void`, cookie, body, params: { id } });
}

async function qty(id: string) {
  const [r] = await getDb().select({ q: variants.quantity }).from(variants).where(eq(variants.id, id));
  return r?.q;
}

describe('POST /sales/:id/void', () => {
  it('voids a sale: status VOID, stock restored through ADJUSTMENT movements, audit row', async () => {
    const { db, sale, variants: [a, b], managerCookie } = await setup();
    expect(await qty(a.id)).toBe(8);
    const res = await post(managerCookie, sale.id, { reason: 'Customer changed mind' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: sale.id, status: 'VOID', voidReason: 'Customer changed mind' });
    expect(await qty(a.id)).toBe(10);
    expect(await qty(b.id)).toBe(5);
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.type, 'ADJUSTMENT'));
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.referenceKind === 'sale' && m.referenceId === sale.id && m.reason === `Void ${sale.number}`)).toBe(true);
    expect(moves.map((m) => m.qtyDelta).sort()).toEqual([1, 2]);
    const [row] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(row?.voidedAt).toBeInstanceOf(Date);
    expect(row?.voidedBy).toBeTypeOf('string');
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.action, 'sale.void'), eq(auditLog.entityId, sale.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({ status: 'VOID', reason: 'Customer changed mind' });
  });

  it('refuses to void twice', async () => {
    const { sale, managerCookie } = await setup();
    expect((await post(managerCookie, sale.id, { reason: 'x' })).status).toBe(200);
    const again = await post(managerCookie, sale.id, { reason: 'y' });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('CONFLICT');
  });

  it('is forbidden for sellers', async () => {
    const { sale, variants: [a], sellerCookie } = await setup();
    const res = await post(sellerCookie, sale.id, { reason: 'x' });
    expect(res.status).toBe(403);
    expect(await qty(a.id)).toBe(8);
  });

  it('validates the body and 404s unknown sales', async () => {
    const { sale, managerCookie } = await setup();
    expect((await post(managerCookie, sale.id, { reason: '' })).status).toBe(400);
    expect((await post(managerCookie, sale.id, {})).status).toBe(400);
    expect((await post(managerCookie, sale.id, { reason: 'x', extra: 1 })).status).toBe(400);
    expect((await post(managerCookie, '00000000-0000-4000-8000-000000000001', { reason: 'x' })).status).toBe(404);
    expect((await post(managerCookie, 'not-a-uuid', { reason: 'x' })).status).toBe(400);
  });
});
