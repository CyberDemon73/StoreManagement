import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { users } from '@/db/schema';
import { audit } from '@/lib/audit';
import { createSession, revokeAllSessions, type AuthUser, type NewSession, type ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { hashPassword, verifyPassword } from '@/lib/password';
import type { MeInput, PasswordChangeInput } from '@/schemas/profile';
import { toPublicUser, type PublicUser } from '@/serializers/user';

const actorOf = (user: AuthUser, ctx: ReqCtx) => ({ userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent });

export async function updateProfile(db: Db, user: AuthUser, ctx: ReqCtx, input: MeInput): Promise<PublicUser> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, user.id)).for('update').limit(1);
    if (!current) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    if (current.name === input.name) return toPublicUser(current);
    const [updated] = await tx.update(users).set({ name: input.name, updatedAt: new Date() }).where(eq(users.id, user.id)).returning();
    if (!updated) throw new Error('user update returned no row');
    await audit(tx, actorOf(user, ctx), 'user.update', 'user', user.id, { name: current.name }, { name: updated.name });
    return toPublicUser(updated);
  });
}

/**
 * Change the caller's own password. Every session (this one included) is revoked and a fresh
 * one is issued, so a stolen cookie dies with the old password while this device stays signed in.
 */
export async function changePassword(db: Db, user: AuthUser, ctx: ReqCtx, input: PasswordChangeInput): Promise<NewSession> {
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  if (!(await verifyPassword(row.passwordHash, input.current))) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: { current: 'Incorrect password' } });
  }
  if (input.next === input.current) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: { next: 'New password must differ from the current one' } });
  }

  const passwordHash = await hashPassword(input.next);
  return db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, user.id));
    await revokeAllSessions(tx, user.id);
    const session = await createSession(tx, { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, remember: false });
    await audit(tx, actorOf(user, ctx), 'user.password_change', 'user', user.id, null, null);
    return session;
  });
}
