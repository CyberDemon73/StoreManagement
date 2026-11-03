import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { markRead } from '@/services/notifications';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const POST = withAuth({ auth: true }, async (_req, { db, user }) => {
  return json(await markRead(db, requireUser(user)));
});
