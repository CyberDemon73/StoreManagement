import { createHash } from 'node:crypto';
import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { parse } from '@/lib/validate';
import { saleCreateBody } from '@/schemas/sales';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { createSale } from '@/services/sales';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withAuth({ permission: 'sales.create' }, async (req, { db, user, req: ctx }) => {
  const actor = requireUser(user);
  const key = req.headers.get('idempotency-key');
  if (key && !UUID.test(key)) throw new AppError('VALIDATION', 'Idempotency-Key must be a UUID');
  const body = await parse(saleCreateBody, req);
  const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const r = await withIdempotency(db, actor.id, 'POST /sales', key, requestHash, async () => ({
    status: 201,
    body: await createSale(db, actor, body, ctx),
  }));
  return json(forRole(r.body, actor.role), r.status, r.replayed ? { 'Idempotent-Replayed': 'true' } : undefined);
});
