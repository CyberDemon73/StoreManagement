import { analyticsRoute } from '@/analytics/handler';
import { rangeQuery, resolveRange } from '@/analytics/range';
import { returnsReport } from '@/analytics/returns';

export const runtime = 'nodejs';

export const GET = analyticsRoute('returns', rangeQuery, async (db, q) => returnsReport(db, await resolveRange(db, q)));
