import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { variantLookupQuery } from '@/schemas/products';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { lookupVariant } from '@/services/variants';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'products.read' }, async (req, { db, user }) => {
  const query = await parse(variantLookupQuery, new URL(req.url).searchParams);
  const out = await lookupVariant(db, query);
  if (!out) throw new AppError('NOT_FOUND', 'Variant not found');
  return json(forRole(out, requireUser(user).role));
});
