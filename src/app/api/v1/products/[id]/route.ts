import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { productPatchBody } from '@/schemas/products';
import { forRole } from '@/serializers/catalog';
import { getProductDetail, patchProduct, requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'products.read' }, async (_req, { db, user, params }) => {
  const { id } = await parse(idParams, params);
  const out = await getProductDetail(db, id);
  if (!out) throw new AppError('NOT_FOUND', 'Product not found');
  return json(forRole(out, requireUser(user).role));
});

export const PATCH = withAuth({ permission: 'products.write' }, async (req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  const body = await parse(productPatchBody, req);
  const actor = requireUser(user);
  const out = await patchProduct(db, actor, id, body, ctx);
  return json(forRole(out, actor.role));
});
