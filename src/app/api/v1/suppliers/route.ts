import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { supplierBody } from '@/schemas/catalog';
import { forRole } from '@/serializers/catalog';
import { createSupplier, listSuppliers, toSupplierForRole } from '@/services/catalog';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'catalog.read' }, async (_req, { db, user }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  const list = await listSuppliers(db);
  return json(forRole(list.map((s) => toSupplierForRole(s, user.role)), user.role));
});

export const POST = withAuth({ permission: 'catalog.write' }, async (req, { db, user, req: ctx }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  const input = await parse(supplierBody, req);
  return json(forRole(await createSupplier(db, user, input, ctx), user.role), 201);
});
