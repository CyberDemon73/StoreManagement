import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { createAdjustments } from '@/services/adjustments';
import { applyCount, saveCountItems, startCount } from '@/services/counts';
import { markRead } from '@/services/notifications';
import { authUserOf, saleFixture } from '../helpers/sales';

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

/** saleFixture leaves A at 8 and B at 4 (threshold 3). */
async function setup() {
  const db = getDb();
  const fx = await saleFixture(db);
  return { db, ...fx, managerAuth: authUserOf(fx.manager, 'Mona') };
}

async function lowFor(userId: string) {
  return getDb()
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.kind, 'LOW_STOCK')));
}

describe('LOW_STOCK only on decreases', () => {
  it('a positive adjustment into a still-low variant does not re-alert; a negative one does', async () => {
    const { db, managerAuth, manager, variants: [a] } = await setup();
    await createAdjustments(db, managerAuth, { items: [{ variantId: a.id, newQty: 1, reason: 'DAMAGED' }] }, CTX);
    expect(await lowFor(manager.id)).toHaveLength(1);
    await markRead(db, managerAuth);

    await createAdjustments(db, managerAuth, { items: [{ variantId: a.id, qtyDelta: 1, reason: 'FOUND' }] }, CTX);
    expect(await lowFor(manager.id)).toHaveLength(1);

    await createAdjustments(db, managerAuth, { items: [{ variantId: a.id, qtyDelta: -1, reason: 'LOST' }] }, CTX);
    const rows = await lowFor(manager.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((n) => n.readAt === null)).toHaveLength(1);
  });

  it('a count apply raising a still-low variant does not re-alert', async () => {
    const { db, managerAuth, manager, variants: [a] } = await setup();
    await createAdjustments(db, managerAuth, { items: [{ variantId: a.id, newQty: 1, reason: 'DAMAGED' }] }, CTX);
    await markRead(db, managerAuth);

    const count = await startCount(db, managerAuth, { scope: 'all' }, CTX);
    await saveCountItems(db, managerAuth, count.id, { items: [{ variantId: a.id, countedQty: 2 }] }, CTX);
    await applyCount(db, managerAuth, count.id, {}, CTX);
    expect(await lowFor(manager.id)).toHaveLength(1);
  });
});
