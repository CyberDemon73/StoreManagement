import type { ZodType } from 'zod';
import type { Db } from '@/db/client';
import { brands } from './brands';
import { categories } from './categories';
import { kpis } from './kpis';
import { paymentMix } from './payment-mix';
import { trend, trendQuery, type TrendInterval } from './trend';
import { sizeColor, sizeColorQuery, type SizeColorQuery } from './size-color';
import { topProducts, topQuery, topVariants, type TopBy } from './top-products';
import { PRICE_LIST_EXPORT_MAX, priceListQuery, priceListRows, type PriceListQuery } from './price-list';
import { rangeQuery, resolveRange } from './range';
import { returnsReport } from './returns';
import { sellers } from './sellers';
import { slowMovers, slowMoversQuery, type SlowMoversQuery } from './slow-movers';
import { stockAgeing, stockAgeingQuery } from './stock-ageing';

/**
 * Reports exportable as CSV via GET /analytics/export?report=<name>&<the report's own query>.
 * `rows` flattens the report into one object per CSV row (same numbers as the JSON endpoint).
 */
export interface ReportDef {
  query: ZodType<Record<string, unknown>>;
  rows: (db: Db, q: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
}

export const REPORTS: Record<string, ReportDef> = {
  // --- task 2: kpis / trend / payment mix ---
  kpis: {
    query: rangeQuery,
    rows: async (db, q) => {
      const { cashByMethod, deltas, ...k } = await kpis(db, await resolveRange(db, q as { from: string; to: string }));
      return [
        {
          ...k,
          cashCash: cashByMethod.CASH,
          cashCard: cashByMethod.CARD,
          cashWallet: cashByMethod.WALLET,
          cashTransfer: cashByMethod.TRANSFER,
          deltaTotalCash: deltas.totalCash,
          deltaGrossProfit: deltas.grossProfit,
          deltaSalesCount: deltas.salesCount,
          deltaAvgBasket: deltas.avgBasket,
        },
      ];
    },
  },
  'sales-trend': {
    query: trendQuery,
    rows: async (db, q) => {
      const t = q as { from: string; to: string; interval: TrendInterval };
      return (await trend(db, await resolveRange(db, { from: t.from, to: t.to }), t.interval)).map((p) => ({ ...p }));
    },
  },
  'payment-mix': {
    query: rangeQuery,
    rows: async (db, q) => (await paymentMix(db, await resolveRange(db, q as { from: string; to: string }))).map((r) => ({ ...r })),
  },
  // --- task 3: brands / categories / top products / top variants / size-color ---
  brands: {
    query: rangeQuery,
    rows: async (db, q) => (await brands(db, await resolveRange(db, q as { from: string; to: string }))).map((r) => ({ ...r })),
  },
  categories: {
    query: rangeQuery,
    rows: async (db, q) => (await categories(db, await resolveRange(db, q as { from: string; to: string }))).map((r) => ({ ...r })),
  },
  'top-products': {
    query: topQuery,
    rows: async (db, q) => {
      const t = q as { from: string; to: string; by: TopBy; limit: number };
      return (await topProducts(db, await resolveRange(db, { from: t.from, to: t.to }), t)).map((r) => ({ ...r }));
    },
  },
  'top-variants': {
    query: topQuery,
    rows: async (db, q) => {
      const t = q as { from: string; to: string; by: TopBy; limit: number };
      return (await topVariants(db, await resolveRange(db, { from: t.from, to: t.to }), t)).map(({ color, ...r }) => ({
        ...r,
        colorName: color.name,
        colorHex: color.hex,
      }));
    },
  },
  'size-color': {
    query: sizeColorQuery,
    rows: async (db, q) => (await sizeColor(db, q as SizeColorQuery)).cells.map((c) => ({ ...c })),
  },
  // --- task 4: slow movers / stock ageing / sellers / returns / price list ---
  'slow-movers': {
    query: slowMoversQuery,
    rows: async (db, q) =>
      (await slowMovers(db, q as SlowMoversQuery)).map(({ color, ...r }) => ({ ...r, colorName: color.name, colorHex: color.hex })),
  },
  'stock-ageing': {
    query: stockAgeingQuery,
    rows: async (db) => (await stockAgeing(db)).map((r) => ({ ...r })),
  },
  sellers: {
    query: rangeQuery,
    rows: async (db, q) => (await sellers(db, await resolveRange(db, q as { from: string; to: string }))).map((r) => ({ ...r })),
  },
  returns: {
    query: rangeQuery,
    rows: async (db, q) => (await returnsReport(db, await resolveRange(db, q as { from: string; to: string }))).byReason.map((r) => ({ ...r })),
  },
  'price-list': {
    query: priceListQuery,
    rows: async (db, q) =>
      (await priceListRows(db, (q as PriceListQuery).q, PRICE_LIST_EXPORT_MAX, 0)).map(({ color, ...r }) => ({
        ...r,
        colorName: color.name,
        colorHex: color.hex,
      })),
  },
};
