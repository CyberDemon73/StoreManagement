import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { labelsQuery } from '@/schemas/import';
import { labelData } from '@/services/labels';

export const runtime = 'nodejs';

/** GET /labels?variantIds=a,b → VariantWithProduct[] for printing. Needs products.write; never carries cost fields. */
export const GET = withAuth({ permission: 'products.write' }, async (req, { db }) => {
  const { variantIds } = await parse(labelsQuery, new URL(req.url).searchParams);
  return json(await labelData(db, variantIds));
});
