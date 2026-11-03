import { createHash } from 'node:crypto';
import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { withIdempotency } from '@/lib/idempotency';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { returnBody } from '@/schemas/sales';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { createReturn } from '@/services/returns';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns pay money out, so a retried request must not refund twice: same contract as POST /sales.
export const POST = withAuth({ permission: 'returns.create' }, async (req, { db, user, params, req: ctx }) => {
  const actor = requireUser(user);
  const key = req.headers.get('idempotency-key');
  if (key && !UUID.test(key)) throw new AppError('VALIDATION', 'Idempotency-Key must be a UUID');
  const { id } = await parse(idParams, params);
  const input = await parse(returnBody, req);
  const requestHash = createHash('sha256').update(JSON.stringify({ id, input })).digest('hex');
  const r = await withIdempotency(db, actor.id, 'POST /sales/:id/returns', key, requestHash, async () => ({
    status: 201,
    body: await createReturn(db, actor, id, input, ctx),
  }));
  return json(forRole(r.body, actor.role), r.status, r.replayed ? { 'Idempotent-Replayed': 'true' } : undefined);
});
