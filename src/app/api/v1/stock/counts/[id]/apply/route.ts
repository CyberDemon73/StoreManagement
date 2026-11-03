import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { countApplyBody } from '@/schemas/counts';
import { forRole } from '@/serializers/catalog';
import { applyCount } from '@/services/counts';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'stock.count.manage' }, async (req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  const body = await parse(countApplyBody, req);
  const actor = requireUser(user);
  const out = await applyCount(db, actor, id, body, ctx);
  return json(forRole(out, actor.role));
});
