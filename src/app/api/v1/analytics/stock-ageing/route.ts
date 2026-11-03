import { analyticsRoute } from '@/analytics/handler';
import { stockAgeing, stockAgeingQuery } from '@/analytics/stock-ageing';

export const runtime = 'nodejs';

export const GET = analyticsRoute('stock-ageing', stockAgeingQuery, (db) => stockAgeing(db));
