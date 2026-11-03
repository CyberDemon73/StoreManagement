import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as acceptInvite } from '@/app/api/v1/auth/accept-invite/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as createUserRoute } from '@/app/api/v1/users/route';
import { getDb } from '@/db/client';
import { passwordResetTokens, users } from '@/db/schema';
import { SESSION_COOKIE } from '@/lib/auth';
import { setEmailTransportForTests, type OutgoingEmail } from '@/lib/email';
import { resetMemoryLimiters } from '@/lib/ratelimit';
import { call, cookiePair } from '../helpers/http';
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

const PASSWORD = 'Vx7!river-copper-lamp';

function tokenFrom(mail: OutgoingEmail | undefined): string {
  const m = mail?.text.match(/\/set-password\?token=([A-Za-z0-9_-]+)/);
  if (!m?.[1]) throw new Error('no token in email');
  return m[1];
}

async function invite(email = 'invitee@example.com') {
  const db = getDb();
  const m = await createUser(db, { role: 'MANAGER' });
  const cookie = await sessionCookieFor(db, m.id);
  const res = await call(createUserRoute, {
    method: 'POST',
    path: '/api/v1/users',
    cookie,
    body: { name: 'Invitee', email, role: 'SELLER', mode: 'INVITE' },
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return { userId: body.user.id as string, token: tokenFrom(sent.at(-1)) };
}

function accept(body: unknown) {
  return call(acceptInvite, { method: 'POST', path: '/api/v1/auth/accept-invite', body });
}

describe('POST /auth/accept-invite', () => {
  it('login before accepting → 403 Invitation not accepted', async () => {
    await invite();
    // The invited user's hash is random, so any password is wrong — but a correct one is impossible
    // to know; force a known hash to prove the status check fires after a valid password.
    const known = await createUser(getDb(), { role: 'SELLER', email: 'known@example.com' });
    await getDb().update(users).set({ status: 'INVITED' }).where(eq(users.id, known.id));
    const res = await call(login, { method: 'POST', path: '/api/v1/auth/login', body: { email: known.email, password: known.password } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toBe('Invitation not accepted');
  });

  it('sets the password, activates the user, creates a session; reuse → 400', async () => {
    const { userId, token } = await invite();
    const res = await accept({ token, password: PASSWORD });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(userId);
    expect(body.user.status).toBe('ACTIVE');
    const cookie = cookiePair(res, SESSION_COOKIE);
    expect(cookie).toBeTruthy();
    expect((await call(me, { path: '/api/v1/auth/me', cookie })).status).toBe(200);

    const [tok] = await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    expect(tok?.usedAt).not.toBeNull();

    const loginRes = await call(login, { method: 'POST', path: '/api/v1/auth/login', body: { email: 'invitee@example.com', password: PASSWORD } });
    expect(loginRes.status).toBe(200);

    const again = await accept({ token, password: PASSWORD });
    expect(again.status).toBe(400);
    expect((await again.json()).error.message).toBe('Invalid or expired invitation');
  });

  it('expired token → 400', async () => {
    const { userId, token } = await invite();
    await getDb().update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetTokens.userId, userId));
    const res = await accept({ token, password: PASSWORD });
    expect(res.status).toBe(400);
    const [row] = await getDb().select().from(users).where(eq(users.id, userId));
    expect(row?.status).toBe('INVITED');
  });

  it('a RESET token cannot be used as an invitation', async () => {
    const { userId } = await invite();
    const fake = 'r'.repeat(43);
    const { hashToken } = await import('@/lib/auth');
    await getDb().insert(passwordResetTokens).values({ userId, tokenHash: hashToken(fake), purpose: 'RESET', expiresAt: new Date(Date.now() + 60_000) });
    expect((await accept({ token: fake, password: PASSWORD })).status).toBe(400);
  });

  it('unknown token → 400, weak password → 400, unknown keys → 400', async () => {
    expect((await accept({ token: 'x'.repeat(43), password: PASSWORD })).status).toBe(400);
    const { token } = await invite();
    expect((await accept({ token, password: 'short' })).status).toBe(400);
    expect((await accept({ token, password: PASSWORD, role: 'ADMIN' })).status).toBe(400);
  });
});
