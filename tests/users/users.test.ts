import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as resetPassword } from '@/app/api/v1/users/[id]/reset-password/route';
import { POST as revokeSessions } from '@/app/api/v1/users/[id]/revoke-sessions/route';
import { POST as disable } from '@/app/api/v1/users/[id]/disable/route';
import { POST as enable } from '@/app/api/v1/users/[id]/enable/route';
import { PATCH as patchUser } from '@/app/api/v1/users/[id]/route';
import { GET as listUsers, POST as createUserRoute } from '@/app/api/v1/users/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { getDb } from '@/db/client';
import { auditLog, passwordResetTokens, sessions, users } from '@/db/schema';
import { setEmailTransportForTests, type OutgoingEmail } from '@/lib/email';
import { verifyPassword } from '@/lib/password';
import { resetMemoryLimiters } from '@/lib/ratelimit';
import type { AuthUser } from '@/lib/auth';
import { ROUTES } from '@/lib/route-manifest';
import { setUserStatus, updateUser } from '@/services/users';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const sent: OutgoingEmail[] = [];

beforeEach(() => {
  sent.length = 0;
  resetMemoryLimiters();
  setEmailTransportForTests(async (mail) => {
    sent.push(mail);
  });
});
afterEach(() => setEmailTransportForTests(null));

const TEMP_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{16}$/;

async function actor(role: 'ADMIN' | 'MANAGER' | 'SELLER') {
  const db = getDb();
  const u = await createUser(db, { role });
  return { ...u, cookie: await sessionCookieFor(db, u.id) };
}

async function roleOf(id: string) {
  const [row] = await getDb().select().from(users).where(eq(users.id, id));
  return row;
}

async function sessionCount(userId: string) {
  return (await getDb().select().from(sessions).where(eq(sessions.userId, userId))).length;
}

function post(handler: typeof disable, id: string, cookie: string, body?: unknown, sub = '') {
  return call(handler, { method: 'POST', path: `/api/v1/users/${id}${sub}`, params: { id }, cookie, body });
}

describe('GET /users', () => {
  it('lists users ordered by name with active session counts', async () => {
    const db = getDb();
    const admin = await createUser(db, { role: 'ADMIN', name: 'Zed' });
    const cookie = await sessionCookieFor(db, admin.id);
    const seller = await createUser(db, { role: 'SELLER', name: 'Amy' });
    await sessionCookieFor(db, seller.id);
    await sessionCookieFor(db, seller.id);
    const res = await call(listUsers, { path: '/api/v1/users', cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; sessions: number; roles: string[]; passwordHash?: string }>;
    expect(body.map((u) => u.name)).toEqual(['Amy', 'Zed']);
    expect(body[0]?.sessions).toBe(2);
    expect(body[0]?.roles).toEqual(['SELLER']);
    expect(body[1]?.sessions).toBe(1);
    expect(body[0]).not.toHaveProperty('passwordHash');
  });
});

describe('POST /users', () => {
  it('manager creates a seller with a temporary password', async () => {
    const m = await actor('MANAGER');
    const res = await call(createUserRoute, {
      method: 'POST',
      path: '/api/v1/users',
      cookie: m.cookie,
      body: { name: 'New Seller', email: 'New.Seller@Example.com', role: 'SELLER', mode: 'TEMP' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('new.seller@example.com');
    expect(body.user.status).toBe('ACTIVE');
    expect(body.user.mustChangePassword).toBe(true);
    expect(body.temporaryPassword).toMatch(TEMP_ALPHABET);
    const row = await roleOf(body.user.id);
    expect(await verifyPassword(row!.passwordHash, body.temporaryPassword)).toBe(true);
    const [entry] = await getDb().select().from(auditLog).where(eq(auditLog.action, 'user.create'));
    expect(entry?.entityId).toBe(body.user.id);
    expect(JSON.stringify(entry?.after)).not.toContain('passwordHash');
  });

  it('manager creating an ADMIN → 403', async () => {
    const m = await actor('MANAGER');
    const res = await call(createUserRoute, {
      method: 'POST',
      path: '/api/v1/users',
      cookie: m.cookie,
      body: { name: 'Boss', email: 'boss@example.com', role: 'ADMIN', mode: 'TEMP' },
    });
    expect(res.status).toBe(403);
    expect(await getDb().select().from(users).where(eq(users.email, 'boss@example.com'))).toHaveLength(0);
  });

  it('admin may create an ADMIN', async () => {
    const a = await actor('ADMIN');
    const res = await call(createUserRoute, {
      method: 'POST',
      path: '/api/v1/users',
      cookie: a.cookie,
      body: { name: 'Second', email: 'second@example.com', role: 'ADMIN', mode: 'TEMP' },
    });
    expect(res.status).toBe(201);
  });

  it('duplicate email → 409 fields.email', async () => {
    const m = await actor('MANAGER');
    const existing = await createUser(getDb(), { role: 'SELLER' });
    const res = await call(createUserRoute, {
      method: 'POST',
      path: '/api/v1/users',
      cookie: m.cookie,
      body: { name: 'Dup', email: existing.email.toUpperCase(), role: 'SELLER', mode: 'TEMP' },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.email).toBeTruthy();
  });

  it('rejects unknown keys', async () => {
    const m = await actor('MANAGER');
    const res = await call(createUserRoute, {
      method: 'POST',
      path: '/api/v1/users',
      cookie: m.cookie,
      body: { name: 'X', email: 'x@example.com', role: 'SELLER', mode: 'TEMP', password: 'nope' },
    });
    expect(res.status).toBe(400);
  });

  it('INVITE mode creates an INVITED user and emails a 48 h invitation link', async () => {
    const m = await actor('MANAGER');
    const res = await call(createUserRoute, {
      method: 'POST',
      path: '/api/v1/users',
      cookie: m.cookie,
      body: { name: 'Invitee', email: 'invitee@example.com', role: 'SELLER', mode: 'INVITE' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.status).toBe('INVITED');
    expect(body).not.toHaveProperty('temporaryPassword');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('invitee@example.com');
    expect(sent[0]?.text).toContain('http://localhost:3000/set-password?token=');
    const [tok] = await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, body.user.id));
    expect(tok?.purpose).toBe('INVITE');
    const ttl = tok!.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(47 * 3_600_000);
    expect(ttl).toBeLessThanOrEqual(48 * 3_600_000);
  });
});

describe('PATCH /users/:id', () => {
  it('manager renames a seller and sets a seller to MANAGER', async () => {
    const m = await actor('MANAGER');
    const s = await createUser(getDb(), { role: 'SELLER' });
    await sessionCookieFor(getDb(), s.id);
    const res = await call(patchUser, { method: 'PATCH', path: `/api/v1/users/${s.id}`, params: { id: s.id }, cookie: m.cookie, body: { name: 'Renamed', role: 'MANAGER' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe('Renamed');
    expect(body.user.role).toBe('MANAGER');
    expect(await sessionCount(s.id)).toBe(0);
  });

  it('manager promoting themselves to ADMIN → 4xx, role unchanged', async () => {
    const m = await actor('MANAGER');
    const res = await call(patchUser, { method: 'PATCH', path: `/api/v1/users/${m.id}`, params: { id: m.id }, cookie: m.cookie, body: { role: 'ADMIN' } });
    expect([403, 409]).toContain(res.status);
    expect((await roleOf(m.id))?.role).toBe('MANAGER');
  });

  it('manager promoting another user to ADMIN → 403', async () => {
    const m = await actor('MANAGER');
    const s = await createUser(getDb(), { role: 'SELLER' });
    const res = await call(patchUser, { method: 'PATCH', path: `/api/v1/users/${s.id}`, params: { id: s.id }, cookie: m.cookie, body: { role: 'ADMIN' } });
    expect(res.status).toBe(403);
    expect((await roleOf(s.id))?.role).toBe('SELLER');
  });

  it('manager renaming an ADMIN → 403', async () => {
    const m = await actor('MANAGER');
    const a = await createUser(getDb(), { role: 'ADMIN' });
    const res = await call(patchUser, { method: 'PATCH', path: `/api/v1/users/${a.id}`, params: { id: a.id }, cookie: m.cookie, body: { name: 'Hijack' } });
    expect(res.status).toBe(403);
  });

  it('admin changing own role → 409', async () => {
    const a = await actor('ADMIN');
    await createUser(getDb(), { role: 'ADMIN' });
    const res = await call(patchUser, { method: 'PATCH', path: `/api/v1/users/${a.id}`, params: { id: a.id }, cookie: a.cookie, body: { role: 'MANAGER' } });
    expect(res.status).toBe(409);
    expect((await roleOf(a.id))?.role).toBe('ADMIN');
  });

  it('demoting the last active admin → 409 (self via HTTP; service guard for any actor)', async () => {
    const a = await actor('ADMIN');
    // A DISABLED admin does not count towards "another active admin".
    await createUser(getDb(), { role: 'ADMIN', status: 'DISABLED' });
    const res = await call(patchUser, { method: 'PATCH', path: `/api/v1/users/${a.id}`, params: { id: a.id }, cookie: a.cookie, body: { role: 'MANAGER' } });
    expect(res.status).toBe(409);
    // Over HTTP the only actor able to target the last ADMIN is that ADMIN (self check fires first),
    // so exercise the last-admin guard directly with a distinct ADMIN actor.
    const ghost: AuthUser = {
      id: '00000000-0000-4000-8000-0000000000aa',
      name: 'Ghost',
      email: 'ghost@example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      mustChangePassword: false,
      sessionId: 'x',
    };
    const ctx = { ip: null, userAgent: null, requestId: 't' };
    await expect(updateUser(getDb(), ghost, a.id, { role: 'MANAGER' }, ctx)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(setUserStatus(getDb(), ghost, a.id, 'DISABLED', ctx)).rejects.toMatchObject({ code: 'CONFLICT' });
    const row = await roleOf(a.id);
    expect(row?.role).toBe('ADMIN');
    expect(row?.status).toBe('ACTIVE');
  });

  it('two admins: demoting one works and revokes their sessions; then the last one cannot be demoted', async () => {
    const a = await actor('ADMIN');
    const b = await actor('ADMIN');
    const res = await call(patchUser, { method: 'PATCH', path: `/api/v1/users/${b.id}`, params: { id: b.id }, cookie: a.cookie, body: { role: 'MANAGER' } });
    expect(res.status).toBe(200);
    expect((await roleOf(b.id))?.role).toBe('MANAGER');
    expect(await sessionCount(b.id)).toBe(0);
    expect((await call(me, { path: '/api/v1/auth/me', cookie: b.cookie })).status).toBe(401);
    const [entry] = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'user.update'), eq(auditLog.entityId, b.id)));
    expect((entry?.before as { role: string }).role).toBe('ADMIN');
    expect((entry?.after as { role: string }).role).toBe('MANAGER');
  });
});

describe('disable / enable', () => {
  it('manager disabling an ADMIN → 403', async () => {
    const m = await actor('MANAGER');
    const a = await createUser(getDb(), { role: 'ADMIN' });
    const res = await post(disable, a.id, m.cookie, undefined, '/disable');
    expect(res.status).toBe(403);
    expect((await roleOf(a.id))?.status).toBe('ACTIVE');
  });

  it('admin disabling self → 409', async () => {
    const a = await actor('ADMIN');
    await createUser(getDb(), { role: 'ADMIN' });
    const res = await post(disable, a.id, a.cookie, undefined, '/disable');
    expect(res.status).toBe(409);
  });

  it('disabling the last active admin → 409', async () => {
    // The only path for a non-self actor to target the last ADMIN is another ADMIN, which makes two.
    // So: admin A disables admin B (ok), then B is disabled and A is the last; A cannot disable self (409).
    const a = await actor('ADMIN');
    const b = await actor('ADMIN');
    expect((await post(disable, b.id, a.cookie, undefined, '/disable')).status).toBe(200);
    expect(await sessionCount(b.id)).toBe(0);
    expect((await post(disable, a.id, a.cookie, undefined, '/disable')).status).toBe(409);
  });

  it('manager disables and enables a seller; disable revokes sessions; audited', async () => {
    const m = await actor('MANAGER');
    const s = await createUser(getDb(), { role: 'SELLER' });
    const sCookie = await sessionCookieFor(getDb(), s.id);
    const off = await post(disable, s.id, m.cookie, undefined, '/disable');
    expect(off.status).toBe(200);
    expect((await off.json()).user.status).toBe('DISABLED');
    expect((await call(me, { path: '/api/v1/auth/me', cookie: sCookie })).status).toBe(401);
    expect(await sessionCount(s.id)).toBe(0);
    const on = await post(enable, s.id, m.cookie, undefined, '/enable');
    expect(on.status).toBe(200);
    expect((await on.json()).user.status).toBe('ACTIVE');
    const actions = (await getDb().select().from(auditLog).where(eq(auditLog.entityId, s.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['user.disable', 'user.enable']));
  });

  it('404 for an unknown user', async () => {
    const m = await actor('MANAGER');
    const id = '00000000-0000-4000-8000-000000000999';
    expect((await post(disable, id, m.cookie, undefined, '/disable')).status).toBe(404);
  });
});

describe('POST /users/:id/reset-password', () => {
  it('EMAIL mode sends a 30-min reset link and revokes sessions', async () => {
    const m = await actor('MANAGER');
    const s = await createUser(getDb(), { role: 'SELLER' });
    await sessionCookieFor(getDb(), s.id);
    const res = await post(resetPassword, s.id, m.cookie, { mode: 'EMAIL' }, '/reset-password');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(s.email);
    expect(sent[0]?.text).toContain('http://localhost:3000/reset?token=');
    const [tok] = await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, s.id));
    expect(tok?.purpose).toBe('RESET');
    expect(tok!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect(await sessionCount(s.id)).toBe(0);
  });

  it('TEMP mode returns a temporary password and forces a change', async () => {
    const m = await actor('MANAGER');
    const s = await createUser(getDb(), { role: 'SELLER' });
    const res = await post(resetPassword, s.id, m.cookie, { mode: 'TEMP' }, '/reset-password');
    expect(res.status).toBe(200);
    const { temporaryPassword } = await res.json();
    expect(temporaryPassword).toMatch(TEMP_ALPHABET);
    const row = await roleOf(s.id);
    expect(row?.mustChangePassword).toBe(true);
    expect(await verifyPassword(row!.passwordHash, temporaryPassword)).toBe(true);
    const [entry] = await getDb().select().from(auditLog).where(eq(auditLog.action, 'user.reset_password'));
    expect(JSON.stringify(entry)).not.toContain(temporaryPassword);
  });

  it('manager resetting an ADMIN → 403', async () => {
    const m = await actor('MANAGER');
    const a = await createUser(getDb(), { role: 'ADMIN' });
    const res = await post(resetPassword, a.id, m.cookie, { mode: 'TEMP' }, '/reset-password');
    expect(res.status).toBe(403);
  });
});

describe('POST /users/:id/revoke-sessions', () => {
  it('revokes all sessions and returns the count', async () => {
    const m = await actor('MANAGER');
    const s = await createUser(getDb(), { role: 'SELLER' });
    await sessionCookieFor(getDb(), s.id);
    await sessionCookieFor(getDb(), s.id);
    await sessionCookieFor(getDb(), s.id);
    const res = await post(revokeSessions, s.id, m.cookie, undefined, '/revoke-sessions');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: 3 });
    expect(await sessionCount(s.id)).toBe(0);
  });

  it('manager revoking an ADMIN → 403', async () => {
    const m = await actor('MANAGER');
    const a = await createUser(getDb(), { role: 'ADMIN' });
    expect((await post(revokeSessions, a.id, m.cookie, undefined, '/revoke-sessions')).status).toBe(403);
  });
});

describe('SELLER is forbidden everywhere', () => {
  it('403 on every users route', async () => {
    const s = await actor('SELLER');
    const other = await createUser(getDb(), { role: 'SELLER' });
    const id = other.id;
    const results = await Promise.all([
      call(listUsers, { path: '/api/v1/users', cookie: s.cookie }),
      call(createUserRoute, { method: 'POST', path: '/api/v1/users', cookie: s.cookie, body: { name: 'X', email: 'x@example.com', role: 'SELLER', mode: 'TEMP' } }),
      call(patchUser, { method: 'PATCH', path: `/api/v1/users/${id}`, params: { id }, cookie: s.cookie, body: { name: 'X' } }),
      post(disable, id, s.cookie, undefined, '/disable'),
      post(enable, id, s.cookie, undefined, '/enable'),
      post(resetPassword, id, s.cookie, { mode: 'TEMP' }, '/reset-password'),
      post(revokeSessions, id, s.cookie, undefined, '/revoke-sessions'),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
  });
});

describe('route manifest', () => {
  it('lists every users route with users.manage and accept-invite as public', () => {
    const find = (method: string, path: string) => ROUTES.find((r) => r.method === method && r.path === path);
    for (const [method, path] of [
      ['GET', '/users'],
      ['POST', '/users'],
      ['PATCH', '/users/:id'],
      ['POST', '/users/:id/disable'],
      ['POST', '/users/:id/enable'],
      ['POST', '/users/:id/reset-password'],
      ['POST', '/users/:id/revoke-sessions'],
    ] as const) {
      expect(find(method, path)?.access, `${method} ${path}`).toBe('users.manage');
    }
    expect(find('POST', '/auth/accept-invite')?.access).toBe('public');
  });
});
