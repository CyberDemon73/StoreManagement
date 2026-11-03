import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { receiptQuery } from '@/schemas/sales';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { receiptHtml, receiptJson } from '@/services/receipts';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'sales.read' }, async (req, { db, user, params }) => {
  const actor = requireUser(user);
  const { id } = await parse(idParams, params);
  const { format } = await parse(receiptQuery, new URL(req.url).searchParams);
  const data = await receiptJson(db, actor, id);
  if (!data) throw new AppError('NOT_FOUND', 'Sale not found');
  const out = forRole(data, actor.role);
  if (format === 'json') return json(out);
  return new Response(receiptHtml(out), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});
