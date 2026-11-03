import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { resetPasswordBody } from '@/schemas/users';
import { requireUser } from '@/services/products';
import { resetUserPassword } from '@/services/users';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'users.manage' }, async (req, { db, user, params, req: ctx }) => {
  const actor = requireUser(user);
  const { id } = await parse(idParams, params);
  const body = await parse(resetPasswordBody, req);
  return json(await resetUserPassword(db, actor, id, body, ctx));
});
