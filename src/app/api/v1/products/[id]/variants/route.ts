import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { variantMatrixBody } from '@/schemas/products';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { addVariants, listProductVariants } from '@/services/variants';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'products.read' }, async (_req, { db, user, params }) => {
  const { id } = await parse(idParams, params);
  const out = await listProductVariants(db, id);
  return json(forRole(out, requireUser(user).role));
});

export const POST = withAuth({ permission: 'variants.write' }, async (req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  const body = await parse(variantMatrixBody, req);
  const actor = requireUser(user);
  const out = await addVariants(db, actor, id, body, ctx);
  return json(forRole(out, actor.role), 201);
});
