import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { countStartBody } from '@/schemas/counts';
import { forRole } from '@/serializers/catalog';
import { listCounts, startCount } from '@/services/counts';
import { requireUser } from '@/services/products';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'stock.count.read' }, async (_req, { db, user }) => {
  const out = await listCounts(db);
  return json(forRole(out, requireUser(user).role));
});

export const POST = withAuth({ permission: 'stock.count.manage' }, async (req, { db, user, req: ctx }) => {
  const body = await parse(countStartBody, req);
  const actor = requireUser(user);
  const out = await startCount(db, actor, body, ctx);
  return json(forRole(out, actor.role), 201);
});
