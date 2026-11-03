import { analyticsRoute } from '@/analytics/handler';
import { resolveRange } from '@/analytics/range';
import { topQuery, topVariants } from '@/analytics/top-products';

export const runtime = 'nodejs';

export const GET = analyticsRoute('top-variants', topQuery, async (db, q) => topVariants(db, await resolveRange(db, { from: q.from, to: q.to }), q));
