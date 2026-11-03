import { audit } from '@/lib/audit';
import { withAuth } from '@/lib/auth';
import { buildDataExport } from '@/services/data-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /data/export → zip of one CSV per business table (ADMIN only). */
export const GET = withAuth({ permission: 'data.export.all' }, async (_req, { db, user, req }) => {
  const { zip, tables } = await buildDataExport(db);
  await audit(db, { userId: user!.id, ip: req.ip, userAgent: req.userAgent }, 'data.export', 'data', null, null, { tables, bytes: zip.byteLength });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(zip as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="avenue-stock-${date}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
});
