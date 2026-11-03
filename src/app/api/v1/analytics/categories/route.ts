import { categories } from '@/analytics/categories';
import { analyticsRoute } from '@/analytics/handler';
import { rangeQuery, resolveRange } from '@/analytics/range';

export const runtime = 'nodejs';

export const GET = analyticsRoute('categories', rangeQuery, async (db, q) => categories(db, await resolveRange(db, q)));
