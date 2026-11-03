import { analyticsRoute } from '@/analytics/handler';
import { rangeQuery, resolveRange } from '@/analytics/range';
import { sellers } from '@/analytics/sellers';

export const runtime = 'nodejs';

export const GET = analyticsRoute('sellers', rangeQuery, async (db, q) => sellers(db, await resolveRange(db, q)));
