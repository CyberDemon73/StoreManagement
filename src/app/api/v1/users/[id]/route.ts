import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { patchUserBody } from '@/schemas/users';
import { requireUser } from '@/services/products';
import { updateUser } from '@/services/users';

export const runtime = 'nodejs';

export const PATCH = withAuth({ permission: 'users.manage' }, async (req, { db, user, params, req: ctx }) => {
  const actor = requireUser(user);
  const { id } = await parse(idParams, params);
  const body = await parse(patchUserBody, req);
  return json({ user: await updateUser(db, actor, id, body, ctx) });
});
