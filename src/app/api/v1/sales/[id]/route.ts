import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { getSale } from '@/services/sales';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'sales.read' }, async (_req, { db, user, params }) => {
  const actor = requireUser(user);
  const { id } = await parse(idParams, params);
  // Another seller's sale is reported as missing, not forbidden: no existence leak.
  const out = await getSale(db, actor, id);
  if (!out) throw new AppError('NOT_FOUND', 'Sale not found');
  return json(forRole(out, actor.role));
});
