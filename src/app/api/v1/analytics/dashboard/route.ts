import { dashboard } from '@/analytics/dashboard';
import { analyticsRoute } from '@/analytics/handler';
import { rangeQuery, resolveRange } from '@/analytics/range';

export const runtime = 'nodejs';

export const GET = analyticsRoute('dashboard', rangeQuery, async (db, q) => dashboard(db, await resolveRange(db, q)));
