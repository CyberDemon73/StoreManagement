import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { productCreateBody } from '@/schemas/products';
import { forRole } from '@/serializers/catalog';
import { createProduct, requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'products.write' }, async (req, { db, user, req: ctx }) => {
  const body = await parse(productCreateBody, req);
  const actor = requireUser(user);
  const out = await createProduct(db, actor, body, ctx);
  return json(forRole(out, actor.role), 201);
});
