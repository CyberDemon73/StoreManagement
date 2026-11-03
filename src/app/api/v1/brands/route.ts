import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { brandBody } from '@/schemas/catalog';
import { forRole } from '@/serializers/catalog';
import { createBrand, listBrands } from '@/services/catalog';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'catalog.read' }, async (_req, { db, user }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return json(forRole(await listBrands(db), user.role));
});

export const POST = withAuth({ permission: 'catalog.write' }, async (req, { db, user, req: ctx }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  const input = await parse(brandBody, req);
  return json(forRole(await createBrand(db, user, input, ctx), user.role), 201);
});
