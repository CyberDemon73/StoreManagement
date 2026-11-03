import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { returnBody } from '@/schemas/sales';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { createReturn } from '@/services/returns';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'returns.create' }, async (req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  const input = await parse(returnBody, req);
  const actor = requireUser(user);
  const out = await createReturn(db, actor, id, input, ctx);
  return json(forRole(out, actor.role), 201);
});
