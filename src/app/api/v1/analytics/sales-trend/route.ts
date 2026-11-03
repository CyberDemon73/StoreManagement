import { analyticsRoute } from '@/analytics/handler';
import { resolveRange } from '@/analytics/range';
import { trend, trendQuery } from '@/analytics/trend';

export const runtime = 'nodejs';

export const GET = analyticsRoute('sales-trend', trendQuery, async (db, { from, to, interval }) =>
  trend(db, await resolveRange(db, { from, to }), interval),
);
