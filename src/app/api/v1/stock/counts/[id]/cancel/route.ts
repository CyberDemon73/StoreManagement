import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { forRole } from '@/serializers/catalog';
import { cancelCount } from '@/services/counts';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'stock.count.manage' }, async (_req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  const actor = requireUser(user);
  const out = await cancelCount(db, actor, id, ctx);
  return json(forRole(out, actor.role));
});
