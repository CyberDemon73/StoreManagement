import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { lowStock } from '@/services/low-stock';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'stock.read' }, async (_req, { db, user }) => {
  const out = await lowStock(db);
  return json(forRole(out, requireUser(user).role));
});
