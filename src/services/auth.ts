import { timingSafeEqual } from 'node:crypto';
import type { Db } from '@/db/client';
import { users } from '@/db/schema';
import { audit } from '@/lib/audit';
import { createSession, type NewSession, type ReqCtx } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { hashPassword } from '@/lib/password';
import type { SetupInput } from '@/schemas/auth';
import { toPublicUser, type PublicUser } from '@/serializers/user';
import { ensureSettings } from './settings';

function tokenMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** First-run bootstrap: creates the admin and the settings row. Only valid while `users` is empty. */
export async function setup(db: Db, input: SetupInput, ctx: ReqCtx): Promise<{ user: PublicUser; session: NewSession }> {
  if (!tokenMatches(input.setupToken, getEnv().SETUP_TOKEN)) {
    throw new AppError('FORBIDDEN', 'Invalid setup token');
  }

  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
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
