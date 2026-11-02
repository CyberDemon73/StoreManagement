import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/auth/login/route';
import { getDb } from '@/db/client';
import { auditLog, failedLogins, sessions, users } from '@/db/schema';
import { hashToken } from '@/lib/auth';
import { resetMemoryLimiters } from '@/lib/ratelimit';
import { call, readSetCookie } from '../helpers/http';
import { createUser, DEFAULT_PASSWORD, sessionCookieFor } from '../helpers/users';

function login(body: unknown, extra: { cookie?: string; ip?: string } = {}) {
  return call(POST, { method: 'POST', path: '/api/v1/auth/login', body, ...extra });
}

beforeEach(() => resetMemoryLimiters());

describe('POST /auth/login', () => {
  it('logs in with correct credentials and sets the session cookie', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER', email: 'seller@example.com' });
    const res = await login({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: u.email, role: 'SELLER' });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    const cookie = readSetCookie(res, '__Host-as_session');
    expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(cookie).not.toContain('Max-Age');
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row?.lastLoginAt).toBeInstanceOf(Date);
    const [a] = await db.select().from(auditLog);
    expect(a).toMatchObject({ action: 'auth.login', userId: u.id });
  });

  it('remember=true sets Max-Age on the cookie', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    const res = await login({ email: u.email, password: u.password, remember: true });
    expect(readSetCookie(res, '__Host-as_session')).toContain('Max-Age=');
  });

  it('matches email case-insensitively', async () => {
    const u = await createUser(getDb(), { role: 'SELLER', email: 'mixed@case.com' });
    const res = await login({ email: 'MIXED@Case.com', password: u.password });
    expect(res.status).toBe(200);
  });

  it('returns the same 401 body for a wrong password and an unknown email', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    const wrong = await login({ email: u.email, password: 'definitely-not-it-123' });
    const unknown = await login({ email: 'nobody@example.com', password: 'definitely-not-it-123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('rejects a disabled user with 403 even with the right password', async () => {
    const u = await createUser(getDb(), { role: 'SELLER', status: 'DISABLED' });
    const res = await login({ email: u.email, password: u.password });
    expect(res.status).toBe(403);
  });

  it('rotates the session when a valid cookie is already present', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const oldCookie = await sessionCookieFor(db, u.id);
    const oldId = hashToken(oldCookie.split('=')[1] ?? '');
    const res = await login({ email: u.email, password: u.password }, { cookie: oldCookie });
    expect(res.status).toBe(200);
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(oldId);
  });

  it('rejects unknown fields', async () => {
    const res = await login({ email: 'a@b.com', password: 'x'.repeat(12), admin: true });
    expect(res.status).toBe(400);
  });
});

describe('lockout and rate limits', () => {
  it('locks the account after 10 failures and returns 423 with retryAfter', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    for (let i = 0; i < 10; i++) {
      resetMemoryLimiters(); // isolate lockout from the per-IP limiter
      const r = await login({ email: u.email, password: 'wrong-password-123' }, { ip: `10.0.0.${i}` });
      expect(r.status).toBe(401);
    }
    resetMemoryLimiters();
    const locked = await login({ email: u.email, password: u.password }, { ip: '10.0.1.1' });
    expect(locked.status).toBe(423);
    const body = await locked.json();
    expect(body.error.code).toBe('LOCKED');
    expect(body.error.retryAfter).toBeGreaterThan(0);
    expect(locked.headers.get('Retry-After')).toBeTruthy();
    const [fl] = await db.select().from(failedLogins);
    expect(fl?.count).toBe(10);
    expect(fl?.lockedUntil).toBeInstanceOf(Date);
  });

  it('counts failures for the same email regardless of case', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER', email: 'foo@x.com' });
    await login({ email: 'Foo@X.com', password: 'wrong-password-123' }, { ip: '10.0.2.1' });
    await login({ email: 'foo@x.com', password: 'wrong-password-123' }, { ip: '10.0.2.2' });
    const rows = await db.select().from(failedLogins);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(u.email).toBe('foo@x.com');
  });

  it('clears the failure counter after a successful login', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    await login({ email: u.email, password: 'wrong-password-123' });
    expect((await login({ email: u.email, password: u.password })).status).toBe(200);
    expect(await db.select().from(failedLogins)).toHaveLength(0);
  });

  it('limits login attempts per IP to 5 per minute', async () => {
    const db = getDb();
    await createUser(db, { role: 'SELLER' });
    for (let i = 0; i < 5; i++) {
      const r = await login({ email: `u${i}@example.com`, password: DEFAULT_PASSWORD }, { ip: '10.0.3.1' });
      expect(r.status).toBe(401);
    }
    const sixth = await login({ email: 'u6@example.com', password: DEFAULT_PASSWORD }, { ip: '10.0.3.1' });
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe('RATE_LIMITED');
    const otherIp = await login({ email: 'u7@example.com', password: DEFAULT_PASSWORD }, { ip: '10.0.3.2' });
    expect(otherIp.status).toBe(401);
  });
});
