import { audit } from '@/lib/audit';
import { withAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { streamDataExport } from '@/services/data-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Streaming every business table can outlast the default budget on a cold Neon compute.
export const maxDuration = 60;

/** GET /data/export → zip of one CSV per business table (ADMIN only), streamed. */
export const GET = withAuth({ permission: 'data.export.all' }, async (_req, { db, user, req }) => {
  // Streamed, so the summary (row counts, bytes) is only known at the end: audit then, before the
  // stream closes. An aborted download is still audited, with completed: false and partial counts.
  const stream = streamDataExport(db, {
    onFinish: async ({ tables, bytes, completed }) => {
      try {
        await audit(db, { userId: user!.id, ip: req.ip, userAgent: req.userAgent }, 'data.export', 'data', null, null, { tables, bytes, completed });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        logger.error({ err: { name: e.name, message: e.message } }, 'data export audit failed');
        throw e;
      }
    },
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="avenue-stock-${date}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
});
