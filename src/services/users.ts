import { randomBytes, randomInt } from 'node:crypto';
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { passwordResetTokens, sessions, users } from '@/db/schema';
import { audit } from '@/lib/audit';
import { createSession, generateToken, hashToken, revokeAllSessions, type AuthUser, type NewSession, type ReqCtx } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { inviteEmail, resetLinkEmail, resetNoticeEmail, type RenderedEmail } from '@/lib/email-templates';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { describeError } from '@/lib/http';
import { logger } from '@/lib/logger';
import { hashPassword } from '@/lib/password';
import { enforce, publicIpLimiter } from '@/lib/ratelimit';
import type { AcceptInviteInput, CreateUserInput, PatchUserInput, ResetPasswordInput } from '@/schemas/users';
import { toPublicUser, type PublicUser } from '@/serializers/user';
import { notifyAdmins, recordLoginDevice } from './notifications';
import { actorOf } from './products';

const INVITE_TTL_MS = 48 * 3_600_000;
const RESET_TTL_MS = 30 * 60_000;
// No 0/O, 1/l/I: the password is read aloud or copied off a screen.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_LENGTH = 16;

type UserRow = typeof users.$inferSelect;
export type UserWithSessions = PublicUser & { sessions: number };

export function generateTemporaryPassword(): string {
  let out = '';
  for (let i = 0; i < TEMP_LENGTH; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}

function appUrl(path: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, '')}${path}`;
}

/** Mail failures are logged, not surfaced: the account change is already committed. */
async function sendSafely(to: string, mail: RenderedEmail, userId: string): Promise<void> {
  try {
    await sendEmail({ to, ...mail });
  } catch (err) {
    logger.error({ err: describeError(err), userId }, 'user admin email failed');
  }
}

function isUniqueViolation(err: unknown): boolean {
  const cause = (err instanceof Error ? err.cause : undefined) as { code?: string } | undefined;
  return cause?.code === '23505' || (err as { code?: string } | undefined)?.code === '23505';
}

const EMAIL_TAKEN = 'Email already in use';

/** Only an ADMIN may touch an ADMIN account or hand out the ADMIN role (stops manager self-promotion). */
function requireAdminFor(actor: AuthUser, involvesAdmin: boolean): void {
  if (involvesAdmin && actor.role !== 'ADMIN') {
    throw new AppError('FORBIDDEN', 'Only an admin can manage admin accounts');
  }
}

/**
 * Serialise every change that could remove an active admin, so two concurrent demotions
 * cannot both see "another admin remains" and leave the store with none.
 */
async function lockAdminSet(tx: Db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('avenue:admins'))`);
}

async function loadForUpdate(tx: Db, id: string): Promise<UserRow> {
  const [row] = await tx.select().from(users).where(eq(users.id, id)).for('update');
  if (!row) throw new AppError('NOT_FOUND', 'User not found');
  return row;
}

async function assertAnotherActiveAdmin(tx: Db, excludeId: string): Promise<void> {
  const [other] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'ACTIVE'), ne(users.id, excludeId)))
    .limit(1);
  if (!other) throw new AppError('CONFLICT', 'The last active admin cannot be disabled or demoted');
}

/**
 * Kill every outstanding RESET link for the user. Called whenever the account's state changes
 * underneath a link (disable, admin reset, role change, own password change).
 */
export async function invalidateResetTokens(tx: Db, userId: string): Promise<void> {
  await tx
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), eq(passwordResetTokens.purpose, 'RESET'), isNull(passwordResetTokens.usedAt)));
}

/** Issue a fresh INVITE token (older ones die) and return the raw value for the email. */
async function issueInviteToken(tx: Db, userId: string): Promise<string> {
  await tx
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), eq(passwordResetTokens.purpose, 'INVITE'), isNull(passwordResetTokens.usedAt)));
  const raw = generateToken();
  await tx.insert(passwordResetTokens).values({
    userId,
    tokenHash: hashToken(raw),
    purpose: 'INVITE',
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return raw;
}

function inviteMail(name: string, actorName: string, token: string): RenderedEmail {
  return inviteEmail({ name, actorName, link: appUrl(`/set-password?token=${token}`) });
}

/**
 * Accepting an invitation stamps lastLoginAt, so an account invited but never signed in has an
 * INVITE token row and a null lastLoginAt. ("Has a used INVITE token" cannot tell acceptance
 * apart: a re-sent invitation marks the superseded token used as well.)
 */
async function neverAcceptedInvite(tx: Db, row: UserRow): Promise<boolean> {
  if (row.lastLoginAt) return false;
  const [invite] = await tx
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, row.id), eq(passwordResetTokens.purpose, 'INVITE')))
    .limit(1);
  return Boolean(invite);
}

export async function listUsers(db: Db): Promise<UserWithSessions[]> {
  const rows = await db
    .select({ user: users, sessions: sql<number>`count(${sessions.id})::int` })
    .from(users)
    .leftJoin(sessions, and(eq(sessions.userId, users.id), gt(sessions.expiresAt, sql`now()`), gt(sessions.idleExpiresAt, sql`now()`)))
    .groupBy(users.id)
    .orderBy(asc(users.name), asc(users.email));
  return rows.map((r) => ({ ...toPublicUser(r.user), sessions: Number(r.sessions) }));
}

export async function createUser(
  db: Db,
  actor: AuthUser,
  input: CreateUserInput,
  ctx: ReqCtx,
): Promise<{ user: PublicUser; temporaryPassword?: string }> {
  requireAdminFor(actor, input.role === 'ADMIN');

  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (taken) throw new AppError('CONFLICT', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });

  const temporaryPassword = input.mode === 'TEMP' ? generateTemporaryPassword() : undefined;
  // An invited account gets a hash of 32 random bytes nobody knows, so it is unusable until accepted.
  const passwordHash = await hashPassword(temporaryPassword ?? randomBytes(32).toString('base64url'));
  const inviteToken = input.mode === 'INVITE' ? generateToken() : undefined;

  let user: PublicUser;
  try {
    user = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          role: input.role,
          passwordHash,
          status: inviteToken ? 'INVITED' : 'ACTIVE',
          mustChangePassword: Boolean(temporaryPassword),
        })
        .returning();
      if (!row) throw new Error('user insert returned no row');
      if (inviteToken) {
        await tx.insert(passwordResetTokens).values({
          userId: row.id,
          tokenHash: hashToken(inviteToken),
          purpose: 'INVITE',
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        });
      }
      const created = toPublicUser(row);
      await audit(tx, actorOf(actor, ctx), 'user.create', 'user', row.id, null, { ...created, mode: input.mode });
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });
    throw err;
  }

  if (inviteToken) {
    await sendSafely(user.email, inviteMail(user.name, actor.name, inviteToken), user.id);
  }
  return temporaryPassword ? { user, temporaryPassword } : { user };
}

export async function updateUser(db: Db, actor: AuthUser, id: string, patch: PatchUserInput, ctx: ReqCtx): Promise<PublicUser> {
  return db.transaction(async (tx) => {
    await lockAdminSet(tx);
    const before = await loadForUpdate(tx, id);
    const roleChanges = patch.role !== undefined && patch.role !== before.role;
    const nameChanges = patch.name !== undefined && patch.name !== before.name;
    // 403s before 409s: a manager trying to self-promote is told "not allowed", not "not on yourself".
    requireAdminFor(actor, before.role === 'ADMIN' || patch.role === 'ADMIN');
    if (roleChanges) {
      if (before.id === actor.id) throw new AppError('CONFLICT', 'You cannot change your own role');
      if (before.role === 'ADMIN' && before.status === 'ACTIVE') await assertAnotherActiveAdmin(tx, before.id);
    }
    // Nothing differs: no write, no audit row, no session revocation.
    if (!roleChanges && !nameChanges) return toPublicUser(before);

    const [after] = await tx
      .update(users)
      .set({ ...(nameChanges && { name: patch.name }), ...(roleChanges && { role: patch.role }), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!after) throw new AppError('NOT_FOUND', 'User not found');
    // Sessions carry no role, but a role change must not leave an old-privilege browser signed in.
    if (roleChanges) {
      await revokeAllSessions(tx, id);
      await invalidateResetTokens(tx, id);
    }
    await audit(tx, actorOf(actor, ctx), 'user.update', 'user', id, toPublicUser(before), toPublicUser(after));
    return toPublicUser(after);
  });
}

export async function setUserStatus(
  db: Db,
  actor: AuthUser,
  id: string,
  status: 'ACTIVE' | 'DISABLED',
  ctx: ReqCtx,
): Promise<PublicUser> {
  return db.transaction(async (tx) => {
    await lockAdminSet(tx);
    const before = await loadForUpdate(tx, id);
    requireAdminFor(actor, before.role === 'ADMIN');
    if (status === 'DISABLED') {
      if (before.id === actor.id) throw new AppError('CONFLICT', 'You cannot disable your own account');
      if (before.role === 'ADMIN' && before.status === 'ACTIVE') await assertAnotherActiveAdmin(tx, before.id);
    } else if (before.status === 'INVITED') {
      throw new AppError('CONFLICT', 'The invitation has not been accepted yet');
    }

    // A disabled invitee who never accepted goes back to waiting on the invitation, not to ACTIVE.
    const next = status === 'ACTIVE' && before.status === 'DISABLED' && (await neverAcceptedInvite(tx, before)) ? 'INVITED' : status;
    const [after] = await tx.update(users).set({ status: next, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    if (!after) throw new AppError('NOT_FOUND', 'User not found');
    if (status === 'DISABLED') {
      await revokeAllSessions(tx, id);
      await invalidateResetTokens(tx, id);
    }
    await audit(
      tx,
      actorOf(actor, ctx),
      status === 'DISABLED' ? 'user.disable' : 'user.enable',
      'user',
      id,
      toPublicUser(before),
      toPublicUser(after),
    );
    return toPublicUser(after);
  });
}

export async function resetUserPassword(
  db: Db,
  actor: AuthUser,
  id: string,
  input: ResetPasswordInput,
  ctx: ReqCtx,
): Promise<{ temporaryPassword?: string }> {
  const temporaryPassword = input.mode === 'TEMP' ? generateTemporaryPassword() : undefined;
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : undefined;
  const resetToken = input.mode === 'EMAIL' ? generateToken() : undefined;

  const result = await db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    requireAdminFor(actor, row.role === 'ADMIN');
    if (row.status === 'INVITED') {
      // EMAIL on a stuck invitation re-sends it; a temp password would bypass the invitation.
      if (input.mode !== 'EMAIL') throw new AppError('CONFLICT', 'The invitation has not been accepted yet');
      const inviteToken = await issueInviteToken(tx, id);
      await audit(tx, actorOf(actor, ctx), 'user.resend_invite', 'user', id, null, { targetRole: row.role });
      return { target: row, inviteToken };
    }

    // Older links must not outlive the reset an admin just made.
    await invalidateResetTokens(tx, id);
    if (passwordHash) {
      await tx.update(users).set({ passwordHash, mustChangePassword: true, updatedAt: new Date() }).where(eq(users.id, id));
    }
    if (resetToken) {
      await tx.insert(passwordResetTokens).values({
        userId: id,
        tokenHash: hashToken(resetToken),
        purpose: 'RESET',
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      });
    }
    await revokeAllSessions(tx, id);
    // A reset hands the account to whoever holds the new secret, so other admins must see it.
    await notifyAdmins(
      tx,
      {
        kind: 'ACCOUNT_RESET',
        title: `Password reset by ${actor.name}`,
        body: `${row.name} (${row.email}) had their password reset (${input.mode === 'TEMP' ? 'temporary password' : 'email link'}).`,
        href: '/users',
        payload: { userId: id, actorId: actor.id, mode: input.mode },
      },
      actor.id,
    );
    await audit(tx, actorOf(actor, ctx), 'user.reset_password', 'user', id, null, { mode: input.mode, targetRole: row.role });
    return { target: row, inviteToken: undefined };
  });

  const { target, inviteToken } = result;
  if (inviteToken) {
    await sendSafely(target.email, inviteMail(target.name, actor.name, inviteToken), target.id);
    return {};
  }
  if (resetToken) {
    await sendSafely(target.email, resetLinkEmail({ name: target.name, actorName: actor.name, link: appUrl(`/reset?token=${resetToken}`) }), target.id);
  } else {
    // Never include the temporary password: it is handed over in person.
    await sendSafely(target.email, resetNoticeEmail({ name: target.name, actorName: actor.name }), target.id);
  }
  return temporaryPassword ? { temporaryPassword } : {};
}

export async function revokeUserSessions(db: Db, actor: AuthUser, id: string, ctx: ReqCtx): Promise<{ revoked: number }> {
  return db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    requireAdminFor(actor, row.role === 'ADMIN');
    const live = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, id));
    await revokeAllSessions(tx, id);
    await audit(tx, actorOf(actor, ctx), 'user.revoke_sessions', 'user', id, null, { revoked: live.length });
    return { revoked: live.length };
  });
}

const INVALID_INVITE = 'Invalid or expired invitation';

/** Single-use invitation: sets the password, activates the account and signs the user in. */
export async function acceptInvite(db: Db, input: AcceptInviteInput, ctx: ReqCtx): Promise<{ user: PublicUser; session: NewSession }> {
  await enforce(publicIpLimiter, ctx.ip ?? 'unknown');
  const now = new Date();
  const [token] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(input.token)),
        eq(passwordResetTokens.purpose, 'INVITE'),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .limit(1);
  if (!token) throw new AppError('VALIDATION', INVALID_INVITE);

  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.id, token.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (!claimed) throw new AppError('VALIDATION', INVALID_INVITE);
    // Only an account still waiting on its invitation can be activated: a disabled one stays disabled.
    const [row] = await tx
      .update(users)
      .set({ passwordHash, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: now, updatedAt: now })
      .where(and(eq(users.id, token.userId), eq(users.status, 'INVITED')))
      .returning();
    if (!row) throw new AppError('VALIDATION', INVALID_INVITE);
    const accepted = toPublicUser(row);
    await audit(tx, { userId: row.id, ip: ctx.ip, userAgent: ctx.userAgent }, 'user.accept_invite', 'user', row.id, null, accepted);
    return accepted;
  });

  // The accepting device is the user's first known device, so their first login there stays silent.
  await recordLoginDevice(db, user.id, ctx.userAgent);
  const session = await createSession(db, { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, remember: false });
  return { user, session };
}
