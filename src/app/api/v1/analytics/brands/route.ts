import { brands } from '@/analytics/brands';
import { analyticsRoute } from '@/analytics/handler';
import { rangeQuery, resolveRange } from '@/analytics/range';

export const runtime = 'nodejs';

export const GET = analyticsRoute('brands', rangeQuery, async (db, q) => brands(db, await resolveRange(db, q)));
