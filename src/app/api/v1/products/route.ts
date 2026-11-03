import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { productCreateBody, productListQuery } from '@/schemas/products';
import { forRole } from '@/serializers/catalog';
import { createProduct, requireUser } from '@/services/products';
import { listProducts } from '@/services/products-list';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'products.read' }, async (req, { db, user }) => {
  const query = await parse(productListQuery, new URL(req.url).searchParams);
  const out = await listProducts(db, query);
  return json(forRole(out, requireUser(user).role));
});

export const POST = withAuth({ permission: 'products.write' }, async (req, { db, user, req: ctx }) => {
  const body = await parse(productCreateBody, req);
  const actor = requireUser(user);
  const out = await createProduct(db, actor, body, ctx);
  return json(forRole(out, actor.role), 201);
});
