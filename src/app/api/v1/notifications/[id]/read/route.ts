import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { markRead } from '@/services/notifications';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const POST = withAuth({ auth: true }, async (_req, { db, user, params }) => {
  const { id } = await parse(idParams, params);
  return json(await markRead(db, requireUser(user), id));
});
