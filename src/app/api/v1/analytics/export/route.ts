import { REPORTS } from '@/analytics/registry';
import { withAuth } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { AppError } from '@/lib/errors';
import { parse } from '@/lib/validate';

export const runtime = 'nodejs';

/** GET /analytics/export?report=<name>&<that report's own query> → CSV of the same numbers. */
export const GET = withAuth({ permission: 'export.csv' }, async (req, { db }) => {
  const params = new URL(req.url).searchParams;
  const report = params.get('report') ?? '';
  const def = Object.prototype.hasOwnProperty.call(REPORTS, report) ? REPORTS[report] : undefined;
  if (!def) {
    throw new AppError('VALIDATION', 'Unknown report', { fields: { report: `Use one of: ${Object.keys(REPORTS).sort().join(', ')}` } });
  }
  params.delete('report');
  const q = await parse(def.query, params);
  const csv = toCsv(await def.rows(db, q), { bom: true });
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${report}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
