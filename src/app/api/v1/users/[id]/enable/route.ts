import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { requireUser } from '@/services/products';
import { setUserStatus } from '@/services/users';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'users.manage' }, async (_req, { db, user, params, req: ctx }) => {
  const actor = requireUser(user);
  const { id } = await parse(idParams, params);
  return json({ user: await setUserStatus(db, actor, id, 'ACTIVE', ctx) });
});
