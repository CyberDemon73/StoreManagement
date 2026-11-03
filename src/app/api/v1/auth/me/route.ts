import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { me } from '@/services/auth';

export const runtime = 'nodejs';

export const GET = withAuth({ auth: true }, async (_req, { db, user }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return json(await me(db, user));
});
