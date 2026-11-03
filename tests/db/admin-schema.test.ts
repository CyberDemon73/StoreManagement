import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { knownDevices, notifications, settings, users } from '@/db/schema';
import { toPublicUser } from '@/serializers/user';
import { createUser } from '../helpers/users';

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return ((e as Error).cause as { code?: string } | undefined)?.code;
  }
  return undefined;
}

describe('sprint 5 schema', () => {
  it('has notifications and known_devices tables and the new settings fields', async () => {
    const db = getDb();
    expect(await db.select().from(notifications)).toEqual([]);
    expect(await db.select().from(knownDevices)).toEqual([]);
    const [s] = await db.insert(settings).values({}).returning();
    expect(s).toMatchObject({ dateFormat: 'DD/MM/YYYY', requirePhoneOnTransfer: false, receiptShowLogo: true, largeRefundAlert: 100000 });
  });

  it('allows the INVITED user status', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    await db.update(users).set({ status: 'INVITED' }).where(eq(users.id, u.id));
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row?.status).toBe('INVITED');
  });

  it('dedupes unread notifications per user and key, but allows a new one after it was read', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    const base = { userId: u.id, kind: 'LOW_STOCK' as const, title: 't', body: 'b', dedupeKey: 'low:x' };
    await db.insert(notifications).values(base);
    expect(await pgCode(db.insert(notifications).values(base))).toBe('23505');
    await db.update(notifications).set({ readAt: new Date() });
    await db.insert(notifications).values(base);
    expect(await db.select().from(notifications)).toHaveLength(2);
    await db.insert(notifications).values({ ...base, dedupeKey: null });
    await db.insert(notifications).values({ ...base, dedupeKey: null });
  });

  it('exposes roles as a one-element list on the public user', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(toPublicUser(row!).roles).toEqual(['SELLER']);
  });
});
