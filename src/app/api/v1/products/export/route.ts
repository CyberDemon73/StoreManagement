import { withAuth } from '@/lib/auth';
import { parse } from '@/lib/validate';
import { productExportQuery } from '@/schemas/import';
import { productExportCsv } from '@/services/product-export';

export const runtime = 'nodejs';

/** GET /products/export → CSV of every active variant, in the import's column layout. */
export const GET = withAuth({ permission: 'export.csv' }, async (req, { db }) => {
  await parse(productExportQuery, new URL(req.url).searchParams);
  return new Response(await productExportCsv(db), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="products.csv"',
      'Cache-Control': 'no-store',
    },
  });
});
