import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as GET_ONE } from '@/app/api/v1/sales/[id]/route';
import { POST } from '@/app/api/v1/sales/[id]/returns/route';
import { getDb } from '@/db/client';
import { auditLog, returnItems, returns, saleItems, settings, stockMovements, variants } from '@/db/schema';
import { createSale } from '@/services/sales';
import { voidSale } from '@/services/sale-void';
import { expectNoSellerKeys } from '../helpers/catalog';
import { call } from '../helpers/http';
import { authUserOf, saleFixture } from '../helpers/sales';
import { createUser, sessionCookieFor } from '../helpers/users';

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

async function setup() {
  const db = getDb();
  await db.insert(settings).values({}).onConflictDoNothing();
  const fx = await saleFixture(db);
  const itemA = fx.sale.items.find((i) => i.variantId === fx.variants[0].id)!;
  const itemB = fx.sale.items.find((i) => i.variantId === fx.variants[1].id)!;
  return { db, ...fx, itemA, itemB, sellerCookie: await sessionCookieFor(db, fx.seller.id), managerCookie: await sessionCookieFor(db, fx.manager.id) };
}

function post(cookie: string, id: string, body: unknown) {
  return call(POST, { method: 'POST', path: `/api/v1/sales/${id}/returns`, cookie, body, params: { id } });
}

const body = (items: { saleItemId: string; qty: number; restock: boolean }[], extra: Record<string, unknown> = {}) => ({
  items,
  refundMethod: 'CASH',
  reason: 'Wrong size',
  ...extra,
});

async function qty(id: string) {
  const [r] = await getDb().select({ q: variants.quantity }).from(variants).where(eq(variants.id, id));
  return r?.q;
}

describe('POST /sales/:id/returns', () => {
  it('seller returns A x1 with restock: proportional refund, PARTIALLY_REFUNDED, RETURN movement at snapshot cost', async () => {
    const { db, sale, itemA, variants: [a], sellerCookie } = await setup();
    const res = await post(sellerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }]));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out).toMatchObject({ id: sale.id, status: 'PARTIALLY_REFUNDED' });
    expect(out.returns).toHaveLength(1);
    expect(out.returns[0]).toMatchObject({ saleId: sale.id, refundAmount: 1000, refundMethod: 'CASH', reason: 'Wrong size', createdBy: sale.sellerId });
    expect(out.returns[0].items[0]).toMatchObject({ saleItemId: itemA.id, qty: 1, restock: true });
    expect(out.items.find((i: { id: string }) => i.id === itemA.id).returnedQty).toBe(1);
    expectNoSellerKeys(out);
    expect(await qty(a.id)).toBe(9);
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.type, 'RETURN'));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ variantId: a.id, qtyDelta: 1, unitCost: 500, referenceKind: 'return', referenceId: out.returns[0].id, reason: `Return ${sale.number}` });
    const [itemRow] = await db.select().from(saleItems).where(eq(saleItems.id, itemA.id));
    expect(itemRow?.returnedQty).toBe(1);
    expect(await db.select().from(returns)).toHaveLength(1);
    expect(await db.select().from(returnItems)).toHaveLength(1);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'return.create'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({ saleId: sale.id, refundAmount: 1000 });
  });

  it('non-restock return leaves stock untouched and books no movement', async () => {
    const { db, sale, itemB, variants: [, b], sellerCookie } = await setup();
    const res = await post(sellerCookie, sale.id, body([{ saleItemId: itemB.id, qty: 1, restock: false }]));
    expect(res.status).toBe(201);
    expect(await qty(b.id)).toBe(4);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.type, 'RETURN'))).toHaveLength(0);
    expect((await res.json()).status).toBe('PARTIALLY_REFUNDED');
  });

  it('flips to REFUNDED once every line is fully returned', async () => {
    const { sale, itemA, itemB, sellerCookie } = await setup();
    expect((await post(sellerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }]))).status).toBe(201);
    expect((await post(sellerCookie, sale.id, body([{ saleItemId: itemB.id, qty: 1, restock: false }]))).status).toBe(201);
    const last = await post(sellerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }]));
    expect(last.status).toBe(201);
    const out = await last.json();
    expect(out.status).toBe('REFUNDED');
    expect(out.returns).toHaveLength(3);
    expect(out.returns.reduce((s: number, r: { refundAmount: number }) => s + r.refundAmount, 0)).toBe(3000);
  });

  it('rejects over-returns, foreign sale items and duplicate lines that exceed the remaining qty, writing nothing', async () => {
    const { db, sale, itemA, itemB, variants: [a], sellerCookie, seller } = await setup();
    const over = await post(sellerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 3, restock: true }]));
    expect(over.status).toBe(400);
    expect((await over.json()).error.fields['items.0.qty']).toBe('Only 2 returnable');

    const other = await createSale(db, authUserOf(seller), { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
    const foreign = await post(sellerCookie, sale.id, body([{ saleItemId: other.items[0]!.id, qty: 1, restock: true }]));
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error.fields['items.0.saleItemId']).toBeTypeOf('string');

    const dup = await post(
      sellerCookie,
      sale.id,
      body([
        { saleItemId: itemB.id, qty: 1, restock: true },
        { saleItemId: itemB.id, qty: 1, restock: false },
      ]),
    );
    expect(dup.status).toBe(400);
    expect((await dup.json()).error.fields['items.1.qty']).toBe('Only 1 returnable');

    expect(await db.select().from(returns)).toHaveLength(0);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.type, 'RETURN'))).toHaveLength(0);
    expect(await qty(a.id)).toBe(7);
  });

  it('hides other sellers sales (404) while managers can return any sale', async () => {
    const { db, sale, itemA, managerCookie } = await setup();
    const stranger = await createUser(db, { role: 'SELLER', name: 'Other' });
    const strangerCookie = await sessionCookieFor(db, stranger.id);
    expect((await post(strangerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }]))).status).toBe(404);
    expect(await db.select().from(returns)).toHaveLength(0);
    const mgr = await post(managerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }]));
    expect(mgr.status).toBe(201);
    const out = await mgr.json();
    // DATA-MODEL derived rule: the restocked unit's cost goes back to stock. cost 1500 - 500 = 1000; profit 3000 - 1000 refunded - 1000 = 1000.
    expect(out).toMatchObject({ cost: 1000, profit: 1000 });
    expect(out.items.find((i: { id: string }) => i.id === itemA.id).unitCost).toBe(500);
    expect((await post(managerCookie, '00000000-0000-4000-8000-000000000001', body([{ saleItemId: itemA.id, qty: 1, restock: true }]))).status).toBe(404);
  });

  it('refuses returns on a VOID sale and voids after a return', async () => {
    const { db, sale, itemA, manager, sellerCookie } = await setup();
    const voided = await createSale(db, authUserOf(manager), { items: [{ variantId: itemA.variantId, qty: 1 }], paymentMethod: 'CASH' }, CTX);
    await voidSale(db, authUserOf(manager), voided.id, { reason: 'oops' }, CTX);
    const mgrCookie = await sessionCookieFor(db, manager.id);
    const onVoid = await post(mgrCookie, voided.id, body([{ saleItemId: voided.items[0]!.id, qty: 1, restock: true }]));
    expect(onVoid.status).toBe(409);

    expect((await post(sellerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }]))).status).toBe(201);
    await expect(voidSale(db, authUserOf(manager), sale.id, { reason: 'late' }, CTX)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await db.select().from(stockMovements).where(and(eq(stockMovements.type, 'ADJUSTMENT'), eq(stockMovements.referenceId, sale.id)))).toHaveLength(0);
  });

  it('refunds the discounted share: PCT 10 on A x1 (1000 -> 900) returns 900', async () => {
    const { db, manager, managerCookie, variants: [a] } = await setup();
    const disc = await createSale(db, authUserOf(manager), { items: [{ variantId: a.id, qty: 1 }], discount: { type: 'PCT', value: 10 }, paymentMethod: 'CARD' }, CTX);
    expect(disc.total).toBe(900);
    const res = await post(managerCookie, disc.id, body([{ saleItemId: disc.items[0]!.id, qty: 1, restock: true }], { refundMethod: 'CARD', note: 'card refund' }));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.returns[0]).toMatchObject({ refundAmount: 900, refundMethod: 'CARD', note: 'card refund' });
    // Fully refunded and restocked: nothing sold, no profit or loss.
    expect(out).toMatchObject({ status: 'REFUNDED', cost: 0, profit: 0 });
  });

  it('never refunds more than was paid across several partial returns (rounding)', async () => {
    const { db, manager, managerCookie, variants: [a, b] } = await setup();
    const s = await createSale(db, authUserOf(manager), { items: [{ variantId: a.id, qty: 1, unitPrice: 333 }, { variantId: a.id, qty: 1, unitPrice: 333 }, { variantId: b.id, qty: 1, unitPrice: 334 }], discount: { type: 'PCT', value: 10 }, paymentMethod: 'CASH' }, CTX);
    expect(s.total).toBe(900);
    let refunded = 0;
    let last: { status: string } = { status: '' };
    for (const item of s.items) {
      const res = await post(managerCookie, s.id, body([{ saleItemId: item.id, qty: 1, restock: false }]));
      expect(res.status).toBe(201);
      last = await res.json();
      refunded = (last as unknown as { returns: { refundAmount: number }[] }).returns.reduce((t, x) => t + x.refundAmount, 0);
    }
    expect(last.status).toBe('REFUNDED');
    expect(refunded).toBe(900);
  });

  it('shows zero cost and profit on a VOID sale', async () => {
    const { db, manager, managerCookie, variants: [a] } = await setup();
    const s = await createSale(db, authUserOf(manager), { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
    await voidSale(db, authUserOf(manager), s.id, { reason: 'test' }, CTX);
    const res = await call(GET_ONE, { path: '/api/v1/sales/' + s.id, cookie: managerCookie, params: { id: s.id } });
    expect(await res.json()).toMatchObject({ status: 'VOID', cost: 0, profit: 0 });
  });

  it('validates the body', async () => {
    const { sale, itemA, sellerCookie } = await setup();
    expect((await post(sellerCookie, sale.id, body([]))).status).toBe(400);
    expect((await post(sellerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 0, restock: true }]))).status).toBe(400);
    expect((await post(sellerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }], { reason: '' }))).status).toBe(400);
    expect((await post(sellerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }], { extra: 1 }))).status).toBe(400);
  });
});

describe('returns hardening (review fixes)', () => {
  it('replays a retried return with the same Idempotency-Key instead of refunding twice', async () => {
    const { db, sale, itemA, sellerCookie } = await setup();
    const key = '33333333-2222-4333-8444-555555555555';
    const send = () => call(POST, { method: 'POST', path: `/api/v1/sales/${sale.id}/returns`, cookie: sellerCookie, body: body([{ saleItemId: itemA.id, qty: 1, restock: true }]), params: { id: sale.id }, headers: { 'idempotency-key': key } });
    const first = await send();
    expect(first.status).toBe(201);
    const second = await send();
    expect(second.status).toBe(201);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await db.select().from(returns)).toHaveLength(1);
    const bad = await call(POST, { method: 'POST', path: `/api/v1/sales/${sale.id}/returns`, cookie: sellerCookie, body: body([{ saleItemId: itemA.id, qty: 1, restock: true }]), params: { id: sale.id }, headers: { 'idempotency-key': 'nope' } });
    expect(bad.status).toBe(400);
  });

  it('refunds but does not restock a variant retired after the sale, and says so in the audit', async () => {
    const { db, sale, itemA, managerCookie, variants: [a] } = await setup();
    await db.update(variants).set({ isActive: false }).where(eq(variants.id, a.id));
    const res = await post(managerCookie, sale.id, body([{ saleItemId: itemA.id, qty: 1, restock: true }]));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.returns[0].items[0].restock).toBe(false);
    expect(await qty(a.id)).toBe(8);
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'return.create'));
    expect((rows[0]?.after as { skippedRestock?: string[] }).skippedRestock).toEqual([a.id]);
  });
});
