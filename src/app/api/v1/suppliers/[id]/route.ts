import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams, supplierPatch } from '@/schemas/catalog';
import { forRole } from '@/serializers/catalog';
import { patchSupplier } from '@/services/catalog';

export const runtime = 'nodejs';

export const PATCH = withAuth({ permission: 'catalog.write' }, async (req, { db, user, params, req: ctx }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  const { id } = await parse(idParams, params);
  const patch = await parse(supplierPatch, req);
  return json(forRole(await patchSupplier(db, user, id, patch, ctx), user.role));
});
