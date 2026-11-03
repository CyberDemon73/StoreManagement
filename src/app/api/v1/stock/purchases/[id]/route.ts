import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { getPurchase } from '@/services/purchases';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'stock.receive' }, async (_req, { db, user, params }) => {
  const { id } = await parse(idParams, params);
  const out = await getPurchase(db, id);
  return json(forRole(out, requireUser(user).role));
});
