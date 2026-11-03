import { analyticsRoute } from '@/analytics/handler';
import { resolveRange } from '@/analytics/range';
import { topProducts, topQuery } from '@/analytics/top-products';

export const runtime = 'nodejs';

export const GET = analyticsRoute('top-products', topQuery, async (db, q) => topProducts(db, await resolveRange(db, { from: q.from, to: q.to }), q));
