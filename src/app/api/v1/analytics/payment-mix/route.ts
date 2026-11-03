import { analyticsRoute } from '@/analytics/handler';
import { paymentMix } from '@/analytics/payment-mix';
import { rangeQuery, resolveRange } from '@/analytics/range';

export const runtime = 'nodejs';

export const GET = analyticsRoute('payment-mix', rangeQuery, async (db, q) => paymentMix(db, await resolveRange(db, q)));
