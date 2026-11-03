import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { categoryPatch, idParams } from '@/schemas/catalog';
import { forRole } from '@/serializers/catalog';
import { patchCategory } from '@/services/catalog';

export const runtime = 'nodejs';

export const PATCH = withAuth({ permission: 'catalog.write' }, async (req, { db, user, params, req: ctx }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  const { id } = await parse(idParams, params);
  const patch = await parse(categoryPatch, req);
  return json(forRole(await patchCategory(db, user, id, patch, ctx), user.role));
});
