import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { categoryBody } from '@/schemas/catalog';
import { forRole } from '@/serializers/catalog';
import { createCategory, listCategories } from '@/services/catalog';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'catalog.read' }, async (_req, { db, user }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return json(forRole(await listCategories(db), user.role));
});

export const POST = withAuth({ permission: 'catalog.write' }, async (req, { db, user, req: ctx }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  const input = await parse(categoryBody, req);
  return json(forRole(await createCategory(db, user, input, ctx), user.role), 201);
});
