import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { createUserBody } from '@/schemas/users';
import { requireUser } from '@/services/products';
import { createUser, listUsers } from '@/services/users';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'users.manage' }, async (_req, { db }) => {
  return json(await listUsers(db));
});

export const POST = withAuth({ permission: 'users.manage' }, async (req, { db, user, req: ctx }) => {
  const actor = requireUser(user);
  const body = await parse(createUserBody, req);
  return json(await createUser(db, actor, body, ctx), 201);
});
