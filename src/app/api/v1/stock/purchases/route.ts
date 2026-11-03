import { createHash } from 'node:crypto';
import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { parse } from '@/lib/validate';
import { purchaseBody, purchasesQuery } from '@/schemas/purchases';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { createPurchase, listPurchases } from '@/services/purchases';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAuth({ permission: 'stock.receive' }, async (req, { db, user }) => {
  const query = await parse(purchasesQuery, new URL(req.url).searchParams);
  const out = await listPurchases(db, query);
  return json(forRole(out, requireUser(user).role));
});

export const POST = withAuth({ permission: 'stock.receive' }, async (req, { db, user, req: ctx }) => {
  const actor = requireUser(user);
  const key = req.headers.get('idempotency-key');
  if (key !== null && !UUID_RE.test(key)) throw new AppError('VALIDATION', 'Idempotency-Key must be a UUID');
  const body = await parse(purchaseBody, req);
  const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const r = await withIdempotency(db, actor.id, 'POST /stock/purchases', key, requestHash, async () => ({
    status: 201,
    body: await createPurchase(db, actor, body, ctx),
  }));
  return json(forRole(r.body, actor.role), r.status, r.replayed ? { 'Idempotent-Replayed': 'true' } : undefined);
});
