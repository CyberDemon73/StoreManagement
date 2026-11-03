import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DELETE as deleteUser } from '@/app/api/v1/users/[id]/route';
import { GET as listUsers } from '@/app/api/v1/users/route';
import { getDb } from '@/db/client';
import { auditLog, sessions, users } from '@/db/schema';
import { applyMovement } from '@/services/stock';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

async function actor(role: 'ADMIN' | 'MANAGER' | 'SELLER') {
  const db = getDb();
  const u = await createUser(db, { role });
  return { ...u, cookie: await sessionCookieFor(db, u.id) };
}

const del = (id: string, cookie: string) => call(deleteUser, { method: 'DELETE', path: `/api/v1/users/${id}`, params: { id }, cookie });

describe('DELETE /users/:id', () => {
  it('deletes a user with no history, ends their sessions and audits it', async () => {
    const db = getDb();
    const manager = await actor('MANAGER');
    const seller = await createUser(db, { role: 'SELLER' });
    await sessionCookieFor(db, seller.id);
    const res = await del(seller.id, manager.cookie);
    expect(res.status).toBe(204);
    expect(await db.select().from(users).where(eq(users.id, seller.id))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, seller.id))).toHaveLength(0);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'user.delete'));
    expect(row).toMatchObject({ entityId: seller.id, userId: manager.id });
    expect(row!.before).toMatchObject({ email: seller.email, role: 'SELLER' });
  });

  it('refuses with 409 once the user has stock history (and keeps them)', async () => {
    const db = getDb();
    const manager = await actor('MANAGER');
    const worker = await createUser(db, { role: 'MANAGER' });
    const fx = await stockFixture(db);
    await db.transaction((tx) => applyMovement(tx, { variantId: fx.variants[0].id, type: 'ADJUSTMENT', qtyDelta: 1, reason: 'FOUND', userId: worker.id }));
    const res = await del(worker.id, manager.cookie);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/disable/i);
    expect(await db.select().from(users).where(eq(users.id, worker.id))).toHaveLength(1);
  });

  it('follows the admin rules: not yourself, admins only by an admin, never the last admin', async () => {
    const db = getDb();
    const admin = await actor('ADMIN');
    const manager = await actor('MANAGER');
    expect((await del(admin.id, admin.cookie)).status).toBe(409);
    const otherAdmin = await createUser(db, { role: 'ADMIN' });
    expect((await del(otherAdmin.id, manager.cookie)).status).toBe(403);
    expect((await del(otherAdmin.id, admin.cookie)).status).toBe(204);
  });

  it('is manager-only (seller 403) and 404 for an unknown id', async () => {
    const seller = await actor('SELLER');
    const manager = await actor('MANAGER');
    expect((await del(manager.id, seller.cookie)).status).toBe(403);
    expect((await del('00000000-0000-4000-8000-000000000000', manager.cookie)).status).toBe(404);
  });

  it('GET /users marks who can be deleted', async () => {
    const db = getDb();
    const manager = await actor('MANAGER');
    const fresh = await createUser(db, { role: 'SELLER' });
    const worker = await createUser(db, { role: 'SELLER' });
    const fx = await stockFixture(db);
    await db.transaction((tx) => applyMovement(tx, { variantId: fx.variants[0].id, type: 'ADJUSTMENT', qtyDelta: 1, reason: 'FOUND', userId: worker.id }));
    const list = (await (await call(listUsers, { path: '/api/v1/users', cookie: manager.cookie })).json()) as { id: string; deletable: boolean }[];
    expect(list.find((u) => u.id === fresh.id)!.deletable).toBe(true);
    expect(list.find((u) => u.id === worker.id)!.deletable).toBe(false);
  });
});
