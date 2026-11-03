import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { movementsQuery } from '@/schemas/movements';
import { forRole } from '@/serializers/catalog';
import { listMovements } from '@/services/movements';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'stock.read.ledger' }, async (req, { db, user }) => {
  const query = await parse(movementsQuery, new URL(req.url).searchParams);
  return json(forRole(await listMovements(db, query), requireUser(user).role));
});
