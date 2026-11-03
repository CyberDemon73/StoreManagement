import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as LOGIN } from '@/app/api/v1/auth/login/route';
import { getDb } from '@/db/client';
import { knownDevices, notifications, settings } from '@/db/schema';
import { resetMemoryLimiters } from '@/lib/ratelimit';
import { createAdjustments } from '@/services/adjustments';
import { applyCount, saveCountItems, startCount } from '@/services/counts';
import { markRead } from '@/services/notifications';
import { createReturn } from '@/services/returns';
import { createSale } from '@/services/sales';
import { call } from '../helpers/http';
import { authUserOf, saleFixture } from '../helpers/sales';
import { createUser } from '../helpers/users';

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

beforeEach(() => resetMemoryLimiters());

/** saleFixture leaves A at 8 and B at 4 (threshold 3); adds an admin, a disabled manager and a second seller. */
async function setup() {
  const db = getDb();
  const fx = await saleFixture(db);
  const admin = await createUser(db, { role: 'ADMIN', name: 'Ada' });
  const disabled = await createUser(db, { role: 'MANAGER', name: 'Gone', status: 'DISABLED' });
  const seller2 = await createUser(db, { role: 'SELLER', name: 'Sid' });
  return { db, ...fx, admin, disabled, seller2, sellerAuth: authUserOf(fx.seller, 'Sam'), managerAuth: authUserOf(fx.manager, 'Mona') };
}

async function rowsFor(userId: string, kind?: 'LOW_STOCK' | 'LARGE_REFUND' | 'NEW_DEVICE_LOGIN' | 'COUNT_APPLIED') {
  const db = getDb();
  const where = kind ? and(eq(notifications.userId, userId), eq(notifications.kind, kind)) : eq(notifications.userId, userId);
  return db.select().from(notifications).where(where).orderBy(notifications.createdAt);
}

describe('LOW_STOCK producer', () => {
  it('a sale taking a variant to its threshold notifies each ACTIVE manager/admin exactly once; sellers and disabled users get none', async () => {
    const { db, sellerAuth, variants: [, b], manager, admin, disabled, seller, seller2 } = await setup();
    await createSale(db, sellerAuth, { items: [{ variantId: b.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);

    for (const u of [manager, admin]) {
      const rows = await rowsFor(u.id, 'LOW_STOCK');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: 'Low stock: Chino Slim M/Black', href: '/stock/low', dedupeKey: `low:${b.id}`, readAt: null });
      expect(rows[0]!.body).toContain('3');
    }
    for (const u of [disabled, seller, seller2]) expect(await rowsFor(u.id)).toHaveLength(0);
    expect(await db.select().from(notifications)).toHaveLength(2);
  });

  it('a second qualifying sale while unread adds none; after markRead the next one notifies again', async () => {
    const { db, sellerAuth, managerAuth, variants: [, b], manager, admin } = await setup();
    await createSale(db, sellerAuth, { items: [{ variantId: b.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
    await createSale(db, sellerAuth, { items: [{ variantId: b.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
    expect(await rowsFor(manager.id, 'LOW_STOCK')).toHaveLength(1);
    expect(await rowsFor(admin.id, 'LOW_STOCK')).toHaveLength(1);

    await markRead(db, managerAuth);
    await createSale(db, sellerAuth, { items: [{ variantId: b.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
    const mine = await rowsFor(manager.id, 'LOW_STOCK');
    expect(mine).toHaveLength(2);
    expect(mine.filter((n) => n.readAt === null)).toHaveLength(1);
    // The admin never read theirs, so still exactly one.
    expect(await rowsFor(admin.id, 'LOW_STOCK')).toHaveLength(1);
  });

  it('a variant at or below zero uses the out-of-stock wording', async () => {
    const { db, sellerAuth, variants: [a], manager } = await setup();
    await createSale(db, sellerAuth, { items: [{ variantId: a.id, qty: 8 }], paymentMethod: 'CASH' }, CTX);
    const [n] = await rowsFor(manager.id, 'LOW_STOCK');
    expect(n).toMatchObject({ title: 'Out of stock: Chino Slim S/Black', href: '/stock/low', dedupeKey: `low:${a.id}` });
  });

  it('a sale that stays above the threshold notifies nobody', async () => {
    const { db, sellerAuth, variants: [a] } = await setup();
    await createSale(db, sellerAuth, { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CASH' }, CTX);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it('an adjustment down to the threshold notifies managers', async () => {
    const { db, managerAuth, variants: [a], manager, admin } = await setup();
    await createAdjustments(db, managerAuth, { items: [{ variantId: a.id, newQty: 2, reason: 'DAMAGED' }] }, CTX);
    for (const u of [manager, admin]) {
      const rows = await rowsFor(u.id, 'LOW_STOCK');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: 'Low stock: Chino Slim S/Black', dedupeKey: `low:${a.id}` });
    }
  });
});

describe('LARGE_REFUND producer', () => {
  it('a return above settings.largeRefundAlert notifies managers with a link to the sale', async () => {
    const { db, sale, managerAuth, manager, admin, seller } = await setup();
    await db.update(settings).set({ largeRefundAlert: 500 });
    const itemA = sale.items.find((i) => i.qty === 2)!;
    await createReturn(db, managerAuth, sale.id, { items: [{ saleItemId: itemA.id, qty: 1, restock: false }], refundMethod: 'CASH', reason: 'Too big' }, CTX);
    for (const u of [manager, admin]) {
      const rows = await rowsFor(u.id, 'LARGE_REFUND');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ href: `/sales?open=${sale.id}` });
      expect(rows[0]!.body).toContain(sale.number);
    }
    expect(await rowsFor(seller.id)).toHaveLength(0);
  });

  it('a return at or below the alert notifies nobody', async () => {
    const { db, sale, managerAuth } = await setup();
    const itemA = sale.items.find((i) => i.qty === 2)!;
    await createReturn(db, managerAuth, sale.id, { items: [{ saleItemId: itemA.id, qty: 1, restock: false }], refundMethod: 'CASH', reason: 'Too big' }, CTX);
    expect(await db.select().from(notifications).where(eq(notifications.kind, 'LARGE_REFUND'))).toHaveLength(0);
  });
});

describe('COUNT_APPLIED producer', () => {
  it('applying a count notifies managers once and raises LOW_STOCK for variants it took to the threshold', async () => {
    const { db, managerAuth, variants: [a], manager, admin, seller } = await setup();
    const count = await startCount(db, managerAuth, { scope: 'all' }, CTX);
    await saveCountItems(db, managerAuth, count.id, { items: [{ variantId: a.id, countedQty: 2 }] }, CTX);
    await applyCount(db, managerAuth, count.id, {}, CTX);
    for (const u of [manager, admin]) {
      const applied = await rowsFor(u.id, 'COUNT_APPLIED');
      expect(applied).toHaveLength(1);
      expect(applied[0]).toMatchObject({ href: '/stock/count' });
      expect(applied[0]!.body).toContain(count.number);
      const low = await rowsFor(u.id, 'LOW_STOCK');
      expect(low.map((n) => n.dedupeKey)).toEqual([`low:${a.id}`]);
    }
    expect(await rowsFor(seller.id)).toHaveLength(0);
  });
});

describe('NEW_DEVICE_LOGIN producer', () => {
  function login(email: string, password: string, ua: string) {
    return call(LOGIN, { method: 'POST', path: '/api/v1/auth/login', body: { email, password }, headers: { 'user-agent': ua } });
  }

  it('first login records the device silently; same UA again is silent; a new UA notifies only that user', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const other = await createUser(db, { role: 'MANAGER' });

    expect((await login(u.email, u.password, 'Mozilla/5.0 (DeviceA)')).status).toBe(200);
    expect(await db.select().from(knownDevices).where(eq(knownDevices.userId, u.id))).toHaveLength(1);
    expect(await db.select().from(notifications)).toHaveLength(0);

    expect((await login(u.email, u.password, 'Mozilla/5.0 (DeviceA)')).status).toBe(200);
    expect(await db.select().from(knownDevices).where(eq(knownDevices.userId, u.id))).toHaveLength(1);
    expect(await db.select().from(notifications)).toHaveLength(0);

    // The raw UA is attacker-controlled: only a parsed label reaches the notification body.
    const longUa = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36 VISIT-evil.example ${'x'.repeat(300)}`;
    expect((await login(u.email, u.password, longUa)).status).toBe(200);
    expect(await db.select().from(knownDevices).where(eq(knownDevices.userId, u.id))).toHaveLength(2);
    const rows = await rowsFor(u.id, 'NEW_DEVICE_LOGIN');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('New sign-in');
    expect(rows[0]!.body).toContain('Chrome on Windows');
    expect(rows[0]!.body).not.toContain('Mozilla');
    expect(rows[0]!.body).not.toContain('evil.example');

    expect((await login(u.email, u.password, 'curl/8.0 (DeviceC)')).status).toBe(200);
    const after = await rowsFor(u.id, 'NEW_DEVICE_LOGIN');
    expect(after).toHaveLength(2);
    expect(after.some((n) => n.body.includes('a new browser') && !n.body.includes('DeviceC'))).toBe(true);
    expect(await rowsFor(other.id)).toHaveLength(0);
  });

  it('a failed login records no device', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    expect((await login(u.email, 'Wrong-password-123', 'Mozilla/5.0 (DeviceA)')).status).toBe(401);
    expect(await db.select().from(knownDevices)).toHaveLength(0);
  });
});
