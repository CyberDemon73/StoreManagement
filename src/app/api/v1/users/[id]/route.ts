import { withAuth } from '@/lib/auth';
import { json, noContent } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { patchUserBody } from '@/schemas/users';
import { requireUser } from '@/services/products';
import { deleteUser, updateUser } from '@/services/users';

export const runtime = 'nodejs';

export const PATCH = withAuth({ permission: 'users.manage' }, async (req, { db, user, params, req: ctx }) => {
  const actor = requireUser(user);
  const { id } = await parse(idParams, params);
  const body = await parse(patchUserBody, req);
  return json({ user: await updateUser(db, actor, id, body, ctx) });
});

/** Only for accounts with no sales or stock history; everyone else is disabled instead. */
export const DELETE = withAuth({ permission: 'users.manage' }, async (_req, { db, user, params, req: ctx }) => {
  const actor = requireUser(user);
  const { id } = await parse(idParams, params);
  await deleteUser(db, actor, id, ctx);
  return noContent();
});
