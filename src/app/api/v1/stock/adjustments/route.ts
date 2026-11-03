import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { adjustmentsBody } from '@/schemas/movements';
import { forRole } from '@/serializers/catalog';
import { createAdjustments } from '@/services/adjustments';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'stock.adjust' }, async (req, { db, user, req: ctx }) => {
  const body = await parse(adjustmentsBody, req);
  const actor = requireUser(user);
  return json(forRole(await createAdjustments(db, actor, body, ctx), actor.role));
});
