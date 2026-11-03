import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { listNotifications } from '@/services/notifications';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const GET = withAuth({ auth: true }, async (_req, { db, user }) => {
  return json(await listNotifications(db, requireUser(user)));
});
