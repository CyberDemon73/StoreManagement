import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { parkBody } from '@/schemas/sales';
import { listParked, parkSale } from '@/services/parked';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'sales.create' }, async (_req, { db, user }) => {
  return json(await listParked(db, requireUser(user)));
});

export const POST = withAuth({ permission: 'sales.create' }, async (req, { db, user }) => {
  const body = await parse(parkBody, req);
  return json(await parkSale(db, requireUser(user), body), 201);
});
