import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { countItemsBody } from '@/schemas/counts';
import { forRole } from '@/serializers/catalog';
import { getCount, saveCountItems } from '@/services/counts';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'stock.count.read' }, async (_req, { db, user, params }) => {
  const { id } = await parse(idParams, params);
  const out = await getCount(db, id);
  return json(forRole(out, requireUser(user).role));
});

// Sellers may record counts (stock.count.read), only managers start/apply/cancel.
export const PATCH = withAuth({ permission: 'stock.count.read' }, async (req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  const body = await parse(countItemsBody, req);
  const actor = requireUser(user);
  const out = await saveCountItems(db, actor, id, body, ctx);
  return json(forRole(out, actor.role));
});
