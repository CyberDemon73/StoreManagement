import { analyticsRoute } from '@/analytics/handler';
import { sizeColor, sizeColorQuery } from '@/analytics/size-color';

export const runtime = 'nodejs';

export const GET = analyticsRoute('size-color', sizeColorQuery, sizeColor);
