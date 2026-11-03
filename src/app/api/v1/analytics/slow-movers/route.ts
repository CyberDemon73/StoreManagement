import { analyticsRoute } from '@/analytics/handler';
import { slowMovers, slowMoversQuery } from '@/analytics/slow-movers';

export const runtime = 'nodejs';

export const GET = analyticsRoute('slow-movers', slowMoversQuery, (db, q) => slowMovers(db, q));
