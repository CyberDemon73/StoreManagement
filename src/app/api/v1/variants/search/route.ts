import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { variantSearchQuery } from '@/schemas/products';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { searchVariants } from '@/services/variants';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'products.read' }, async (req, { db, user }) => {
  const { q, limit } = await parse(variantSearchQuery, new URL(req.url).searchParams);
  const out = await searchVariants(db, q, limit);
  return json(forRole(out, requireUser(user).role));
});
