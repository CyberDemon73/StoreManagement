import { analyticsRoute } from '@/analytics/handler';
import { priceList, priceListQuery } from '@/analytics/price-list';

export const runtime = 'nodejs';

export const GET = analyticsRoute('price-list', priceListQuery, (db, q) => priceList(db, q));
