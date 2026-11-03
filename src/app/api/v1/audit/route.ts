import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { auditQuery, listAudit } from '@/services/audit';

export const runtime = 'nodejs';

export const GET = withAuth({ permission: 'audit.read' }, async (req, { db }) => {
  const query = await parse(auditQuery, new URL(req.url).searchParams);
  return json(await listAudit(db, query));
});
