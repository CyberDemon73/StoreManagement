import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as READ_ONE } from '@/app/api/v1/notifications/[id]/read/route';
import { POST as READ_ALL } from '@/app/api/v1/notifications/read-all/route';
import { GET as LIST } from '@/app/api/v1/notifications/route';
import { getDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

async function seed(userId: string, title: string, minutesAgo: number, read = false) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const [row] = await getDb()
    .insert(notifications)
    .values({ userId, kind: 'LOW_STOCK', title, body: `${title} body`, href: '/stock/low', actionLabel: 'Receive', createdAt: at, readAt: read ? at : null, dedupeKey: `k:${title}`, payload: { secret: 1 } })
    .returning();
  return row!;
}

async function setup() {
  const db = getDb();
  const manager = await createUser(db, { role: 'MANAGER' });
  const seller = await createUser(db, { role: 'SELLER' });
  return { db, manager, seller, cookie: await sessionCookieFor(db, manager.id), sellerCookie: await sessionCookieFor(db, seller.id) };
}

const list = async (cookie: string | null) => {
  const res = await call(LIST, { path: '/api/v1/notifications', cookie });
  return { status: res.status, body: await res.json() };
};
const readOne = async (cookie: string | null, id: string) => {
  const res = await call(READ_ONE, { method: 'POST', path: `/api/v1/notifications/${id}/read`, params: { id }, cookie });
  return { status: res.status, body: await res.json() };
};
const readAll = async (cookie: string | null) => {
  const res = await call(READ_ALL, { method: 'POST', path: '/api/v1/notifications/read-all', cookie });
  return { status: res.status, body: await res.json() };
};

describe('GET /notifications', () => {
  it('returns only own rows, unread first then newest, in the Notification shape', async () => {
    const { manager, seller, cookie } = await setup();
    await seed(manager.id, 'old-unread', 30);
    await seed(manager.id, 'new-read', 1, true);
    await seed(manager.id, 'new-unread', 5);
    await seed(seller.id, 'seller-only', 0);
    const { status, body } = await list(cookie);
    expect(status).toBe(200);
    expect(body.map((n: { title: string }) => n.title)).toEqual(['new-unread', 'old-unread', 'new-read']);
    expect(Object.keys(body[0]).sort()).toEqual(['actionLabel', 'body', 'createdAt', 'href', 'id', 'kind', 'title']);
    expect(body[2].readAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('dedupe');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('caps the list at 50', async () => {
    const { db, manager, cookie } = await setup();
    await db.insert(notifications).values(Array.from({ length: 55 }, (_, i) => ({ userId: manager.id, kind: 'COUNT_APPLIED' as const, title: `n${i}`, body: 'b' })));
    expect((await list(cookie)).body).toHaveLength(50);
  });

  it('SELLER reads own notifications', async () => {
    const { seller, sellerCookie } = await setup();
    await seed(seller.id, 'mine', 0);
    const { status, body } = await list(sellerCookie);
    expect(status).toBe(200);
    expect(body.map((n: { title: string }) => n.title)).toEqual(['mine']);
  });

  it('anonymous → 401', async () => {
    expect((await list(null)).status).toBe(401);
    expect((await readAll(null)).status).toBe(401);
    expect((await readOne(null, '00000000-0000-4000-8000-000000000000')).status).toBe(401);
  });
});

describe('POST /notifications/:id/read', () => {
  it('marks one own notification read and returns the list', async () => {
    const { db, manager, cookie } = await setup();
    const a = await seed(manager.id, 'a', 2);
    await seed(manager.id, 'b', 1);
    const { status, body } = await readOne(cookie, a.id);
    expect(status).toBe(200);
    expect(body.map((n: { title: string; readAt?: string }) => [n.title, !!n.readAt])).toEqual([
      ['b', false],
      ['a', true],
    ]);
    const [row] = await db.select().from(notifications).where(eq(notifications.id, a.id));
    expect(row!.readAt).toBeInstanceOf(Date);
  });

  it("another user's notification or an unknown id → 404 and nothing changes", async () => {
    const { db, seller, cookie } = await setup();
    const foreign = await seed(seller.id, 'theirs', 0);
    expect((await readOne(cookie, foreign.id)).status).toBe(404);
    expect((await readOne(cookie, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const [row] = await db.select().from(notifications).where(eq(notifications.id, foreign.id));
    expect(row!.readAt).toBeNull();
  });

  it('a malformed id → 400', async () => {
    const { cookie } = await setup();
    expect((await readOne(cookie, 'nope')).status).toBe(400);
  });
});

describe('POST /notifications/read-all', () => {
  it('marks every own unread notification read, leaving other users untouched', async () => {
    const { db, manager, seller, cookie } = await setup();
    await seed(manager.id, 'a', 2);
    await seed(manager.id, 'b', 1);
    const theirs = await seed(seller.id, 'theirs', 0);
    const { status, body } = await readAll(cookie);
    expect(status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body.every((n: { readAt?: string }) => typeof n.readAt === 'string')).toBe(true);
    const [row] = await db.select().from(notifications).where(eq(notifications.id, theirs.id));
    expect(row!.readAt).toBeNull();
  });
});
