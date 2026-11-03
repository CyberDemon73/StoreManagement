import { timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { after } from 'next/server';
import type { Db } from '@/db/client';
import { passwordResetTokens, users } from '@/db/schema';
import { audit } from '@/lib/audit';
import {
  createSession,
  generateToken,
  hashToken,
  revokeAllSessions,
  revokeSession,
  type AuthUser,
  type NewSession,
  type ReqCtx,
} from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { describeError } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getDummyHash, hashPassword, verifyPassword } from '@/lib/password';
import { permissionsFor, type Permission } from '@/lib/permissions';
import { enforce, forgotEmailLimiter, loginEmailLimiter, loginIpLimiter, publicIpLimiter } from '@/lib/ratelimit';
import type { ForgotInput, LoginInput, ResetInput, SetupInput } from '@/schemas/auth';
import { toPublicSettings, type PublicSettings } from '@/serializers/settings';
import { toPublicUser, type PublicUser } from '@/serializers/user';
import { clearFailures, getLockRemaining, recordFailure } from './lockout';
import { recordLoginDevice } from './notifications';
import { ensureSettings, getSettings } from './settings';

function tokenMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** First-run bootstrap: creates the admin and the settings row. Only valid while `users` is empty. */
export async function setup(db: Db, input: SetupInput, ctx: ReqCtx): Promise<{ user: PublicUser; session: NewSession }> {
  await enforce(publicIpLimiter, ctx.ip ?? 'unknown');

  // Once a user exists the answer is always 409, so the token cannot be probed after setup.
  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  if (anyUser) throw new AppError('CONFLICT', 'Setup already completed');
  if (!tokenMatches(input.setupToken, getEnv().SETUP_TOKEN)) {
    throw new AppError('FORBIDDEN', 'Invalid setup token');
  }

  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    // Serialise concurrent setup calls: READ COMMITTED would let two of them both see an empty table.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('avenue:setup'))`);
    const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing) throw new AppError('CONFLICT', 'Setup already completed');

    const [row] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, passwordHash, role: 'ADMIN', lastLoginAt: new Date() })
      .returning();
    if (!row) throw new Error('user insert returned no row');

    await ensureSettings(tx, { storeName: input.storeName, currency: input.currency });
    const user = toPublicUser(row);
    await audit(tx, { userId: row.id, ip: ctx.ip, userAgent: ctx.userAgent }, 'setup.complete', 'user', row.id, null, user);
    return user;
  });

  const session = await createSession(db, { userId: created.id, ip: ctx.ip, userAgent: ctx.userAgent, remember: true });
  return { user: created, session };
}

const INVALID_CREDENTIALS = 'Invalid email or password';

/**
 * Login with rate limits, lockout, constant-time verification (dummy hash for unknown
 * emails) and session rotation when the caller already holds a session.
 */
export async function login(
  db: Db,
  input: LoginInput,
  ctx: ReqCtx,
  currentSessionId?: string,
): Promise<{ user: PublicUser; session: NewSession }> {
  await enforce(loginIpLimiter, ctx.ip ?? 'unknown');
  await enforce(loginEmailLimiter, input.email);

  const lockRemaining = await getLockRemaining(db, input.email);
  if (lockRemaining > 0) {
    throw new AppError('LOCKED', 'Account temporarily locked', { retryAfter: lockRemaining });
  }

  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);
  if (!user || !ok) {
    await recordFailure(db, input.email, ctx.ip);
    throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS);
  }
  if (user.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Account disabled');

  await clearFailures(db, input.email);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  if (currentSessionId) await revokeSession(db, currentSessionId);
  await recordLoginDevice(db, user.id, ctx.userAgent);
  const session = await createSession(db, { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, remember: input.remember });
  await audit(db, { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent }, 'auth.login', 'user', user.id, null, {
    remember: input.remember,
  });
  return { user: toPublicUser({ ...user, lastLoginAt: new Date() }), session };
}

export async function logout(db: Db, user: AuthUser, ctx: ReqCtx): Promise<void> {
  await revokeSession(db, user.sessionId);
  await audit(db, { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent }, 'auth.logout', 'user', user.id, null, null);
}

const RESET_TOKEN_TTL_MS = 30 * 60_000;

/** Always resolves (204 to the client) so the response never reveals whether the email exists. */
export async function forgot(db: Db, input: ForgotInput, ctx: ReqCtx): Promise<void> {
  await enforce(publicIpLimiter, ctx.ip ?? 'unknown');
  await enforce(forgotEmailLimiter, input.email);
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  // Same audit write for unknown emails keeps the DB work (and timing) symmetric.
  await audit(db, { userId: user?.id ?? null, ip: ctx.ip, userAgent: ctx.userAgent }, 'auth.forgot', 'user', user?.id ?? null, null, null);
  if (!user || user.status !== 'ACTIVE') return;

  const raw = generateToken();
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashToken(raw),
    purpose: 'RESET',
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  const link = `${getEnv().APP_URL.replace(/\/$/, '')}/reset?token=${raw}`;
  // The provider call runs after the response so its latency and failures never reveal
  // whether the address exists; the client always gets 204.
  deferred(async () => {
    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset your Avenue Stock password',
        text: `Hello ${user.name},\n\nUse this link within 30 minutes to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`,
      });
    } catch (err) {
      logger.error({ err: describeError(err), userId: user.id }, 'password reset email failed');
    }
  });
}

/** Run work after the response is sent (Next `after()`); outside a request scope (tests, scripts) run it inline. */
function deferred(fn: () => Promise<void>): void {
  try {
    after(fn);
  } catch {
    void fn();
  }
}

/** Single-use token: sets the password, marks the token used and revokes every session. */
export async function reset(db: Db, input: ResetInput, ctx: ReqCtx): Promise<void> {
  await enforce(publicIpLimiter, ctx.ip ?? 'unknown');
  const tokenHash = hashToken(input.token);
  const now = new Date();
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), eq(passwordResetTokens.purpose, 'RESET'), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
    .limit(1);
  if (!row) throw new AppError('VALIDATION', 'Invalid or expired token');

  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (!claimed) throw new AppError('VALIDATION', 'Invalid or expired token');
    // Any other outstanding reset links for this user die with this one.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, row.userId), eq(passwordResetTokens.purpose, 'RESET'), isNull(passwordResetTokens.usedAt)));
    await tx.update(users).set({ passwordHash, mustChangePassword: false, updatedAt: now }).where(eq(users.id, row.userId));
    await revokeAllSessions(tx, row.userId);
    await audit(tx, { userId: row.userId, ip: ctx.ip, userAgent: ctx.userAgent }, 'user.password_reset', 'user', row.userId, null, null);
  });
}

export interface MeResponse {
  user: PublicUser;
  permissions: Permission[];
  settingsPublic: PublicSettings;
}

export async function me(db: Db, user: AuthUser): Promise<MeResponse> {
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return {
    user: toPublicUser(row),
    permissions: permissionsFor(row.role),
    settingsPublic: toPublicSettings(await getSettings(db)),
  };
}
