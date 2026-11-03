import { createHash, timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';
import { AppError } from './errors';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Compare SHA-256 digests so the
 * check is constant-time even when lengths differ. Unset secret → cron routes are closed.
 */
export function requireCronSecret(req: Request): void {
  const secret = getEnv().CRON_SECRET;
  const header = req.headers.get('authorization') ?? '';
  const ok = !!secret && header.startsWith('Bearer ') && timingSafeEqual(digest(header.slice(7)), digest(secret));
  if (!ok) throw new AppError('UNAUTHENTICATED', 'Invalid cron credentials');
}
