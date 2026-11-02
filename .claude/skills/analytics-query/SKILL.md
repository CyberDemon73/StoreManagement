---
name: analytics-query
description: Add or change an Avenue Stock analytics report (SQL-first Drizzle query, date range + timezone handling, caching, CSV export, accuracy test). Use for any endpoint under /analytics or when the user says /analytics-query <report>.
---

# /analytics-query <report>

1. **Define the numbers.** Write the formula in plain words at the top of `src/analytics/<report>.ts` and in `docs/API-SPEC.md`. Profit always = Σ(unit_price − unit_cost)·qty over non-VOID sales in range, minus refund effects per `docs/DATA-MODEL.md` "Derived rules".
2. **Test first** `tests/analytics/<report>.test.ts`: seed a tiny fixture (2 brands, 3 variants, 4 sales incl. one VOID and one partial return) with hand-computed expected values. Assert exact integers.
3. **Query**: one `sql` template per report, parameters `{ from, to, tz }`.
   - Bucket with `date_trunc(interval, created_at AT TIME ZONE ${tz})`.
   - Fill empty buckets with `generate_series`.
   - Exclude `status = 'VOID'`; treat `PARTIALLY_REFUNDED/REFUNDED` via `returns` join.
   - Stock-on-hand figures use current `variants` (not range-bound) unless the report says otherwise.
   - Keep to ≤ 2 queries per endpoint; combine with CTEs.
4. **Endpoint** via `/api-endpoint GET /analytics/<report>` with permission `analytics.read`, `Cache-Control: private, max-age=60`, Upstash memo key `an:<report>:<from>:<to>:<extra>`; invalidate pattern `an:*` on sale/purchase/adjust/return/void.
5. **Export**: register the report in `src/analytics/registry.ts` so `/analytics/export?report=<name>` can stream it as CSV (same query, no limit, formula-escape cells).
6. **Performance**: run `EXPLAIN ANALYZE` on the seed DB with 10k sales (use `scripts/seed-big.ts`); add indexes from `docs/SPRINTS.md` Sprint 4 if a seq scan appears on `sales` or `sale_items`.
7. Green tests, commit `feat(analytics): <report>`.
