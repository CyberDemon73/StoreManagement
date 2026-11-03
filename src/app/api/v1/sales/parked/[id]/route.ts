import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { unparkSale } from '@/services/parked';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

// Unpark: deletes the row and returns the cart so the client can restore it.
export const DELETE = withAuth({ permission: 'sales.create' }, async (_req, { db, user, params }) => {
  const { id } = await parse(idParams, params);
  return json(await unparkSale(db, requireUser(user), id));
});
