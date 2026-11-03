import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { voidBody } from '@/schemas/sales';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { voidSale } from '@/services/sale-void';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'sales.void' }, async (req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  const input = await parse(voidBody, req);
  const actor = requireUser(user);
  const out = await voidSale(db, actor, id, input, ctx);
  return json(forRole(out, actor.role));
});
