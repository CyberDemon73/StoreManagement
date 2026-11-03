import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { GET as low } from '@/app/api/v1/stock/low/route';
import { getDb } from '@/db/client';
import { users } from '@/db/schema';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

describe('forced password change', () => {
  it('blocks business routes until the password is changed, but allows me and logout', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, u.id));
    const cookie = await sessionCookieFor(db, u.id);
    const blocked = await call(low, { path: '/api/v1/stock/low', cookie });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.fields.password).toBe('Password change required');
    const mine = await call(me, { path: '/api/v1/auth/me', cookie });
    expect(mine.status).toBe(200);
    expect((await mine.json()).user.mustChangePassword).toBe(true);
    expect((await call(logout, { method: 'POST', path: '/api/v1/auth/logout', cookie })).status).toBe(204);
  });
});
