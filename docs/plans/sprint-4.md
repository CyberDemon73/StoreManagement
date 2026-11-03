# Sprint 4 — Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every report in the spec, computed SQL-first from one shared definition of revenue, cost and profit, in the store's timezone, cached, exportable as CSV, and proven exact against a hand-computed fixture.

**Architecture:** `src/analytics/range.ts` turns local `from`/`to` dates + `settings.timezone` into SQL instants. `src/analytics/facts.ts` exposes two CTE fragments every report builds on — `saleLines` (non-VOID sale items created in range, revenue allocated net of the sale discount, cost snapshot) and `returnLines` (return items created in range, refund allocated per line, restocked cost) — so revenue/COGS/profit are defined once. Reports live in `src/analytics/<report>.ts` (≤ 2 queries each), routes in `src/app/api/v1/analytics/<report>/route.ts` (`analytics.read`), registered in `src/analytics/registry.ts` for CSV export. `src/lib/cache.ts` memoises report results in Upstash under a version counter bumped by every stock/sales mutation.

**Tech Stack:** unchanged (Drizzle `sql`, PGlite tests).

**Spec:** `docs/SPRINTS.md` (Sprint 4), `.claude/skills/analytics-query/SKILL.md`, `docs/API-SPEC.md` (Analytics), `docs/DATA-MODEL.md` (derived rules), `docs/DECISIONS.md` (2026-11-05 profit, refund and timezone lines), `src/types.ts` (DashboardKpis, DashboardData, TrendPoint, BrandSplit, CategoryStats, TopProduct, SlowMover, SizeColorMatrix, SellerStats, ReturnsReport, PaymentMix) and `src/mock/store.ts` analytics section (semantics of deltas, daysOfCover, suggestion).

## Global Constraints

- Definitions (write them at the top of each report file):
  - **revenue** = Σ saleLines.revenue − Σ returnLines.refund (period cash, net of discounts and refunds).
  - **cogs** = Σ saleLines.cost − Σ returnLines.restockedCost.
  - **profit** = revenue − cogs. **marginPct** = profit ÷ revenue × 100 (0 when revenue is 0), one decimal.
  - **unitsSold** = Σ saleLines.qty − Σ returnLines.qty.
  - saleLines: sale `status <> 'VOID'`, `sales.created_at` in range; `revenue = line_total × total ÷ subtotal` (numeric, 0 when subtotal 0); `cost = coalesce(unit_cost,0) × qty`.
  - returnLines: `returns.created_at` in range, sale not VOID; `refund = return.refund_amount × (unit_price × qty) ÷ Σ(unit_price × qty) over that return`; `restockedCost = coalesce(unit_cost,0) × qty` when `restock`.
  - Rounding: aggregate in `numeric`, round to integer minor units once per output row.
- Range: `from`, `to` are `YYYY-MM-DD` in `settings.timezone`; `to` inclusive; `to ≥ from`; span ≤ 366 days; instants = `(from::date)::timestamp AT TIME ZONE tz` and `((to::date) + 1)::timestamp AT TIME ZONE tz`. Buckets: `date_trunc(interval, created_at AT TIME ZONE tz)`, labels `YYYY-MM-DD` (week = Monday, month = first day), empty buckets filled with `generate_series`.
- Stock-on-hand figures use current `variants` of ACTIVE products with active variants, `max(quantity, 0)`, cost = `coalesce(cost_price,0)`.
- Every route `withAuth({ permission: 'analytics.read' })` (ADMIN/MANAGER), strict query schema, `Cache-Control: private, max-age=60`, registered under `// --- analytics ---` in the manifest.
- Money integers; percentages numbers with one decimal; counts integers.
- Conventional commits, explicit paths.

## Review Focus

1. A sale on day D at 00:30 Cairo time (22:30 UTC on D−1) counts on D. (Task 1 test.)
2. A sale in range whose return is after `to` counts fully; a return in range on an older sale reduces this period. (Task 2 test.)
3. VOID sales contribute nothing anywhere (revenue, units, payment mix, sellers, top products). (Task 2/3/4 tests via the shared fixture.)
4. Brand split and category split revenues each sum to the dashboard revenue for the fixture. (Task 3 test.)
5. `from` after `to`, a 400-day range, or `2026-02-30` → 400, never 500. (Task 1 test.)

---

## File structure

```
drizzle/0007_*.sql                       indexes returns(created_at), return_items(return_id), return_items(sale_item_id)
src/db/schema/sales.ts                   (+ those indexes)
src/analytics/range.ts                   rangeQuery, isoDate, resolveRange(db, q) → AnalyticsRange
src/analytics/facts.ts                   saleLines(r), returnLines(r), stockOnHand()  (sql fragments)
src/lib/cache.ts                         memo(key, fn), bumpAnalyticsVersion()  (Upstash or no-op)
src/analytics/registry.ts                REPORTS map name → { query schema, run(db, q) → rows for CSV }
src/analytics/{kpis,trend,payment-mix,brands,categories,top-products,size-color,slow-movers,stock-ageing,sellers,returns,price-list,dashboard}.ts
src/app/api/v1/analytics/<report>/route.ts   + export/route.ts
src/services/{sales,movements}.ts        (modify) day bounds via resolveRange
tests/helpers/analytics.ts               analyticsFixture(db) — hand-computed expected values
tests/analytics/*.test.ts
```

Shared types:

```ts
// src/analytics/range.ts
export interface AnalyticsRange { from: string; to: string; tz: string; start: SQL; end: SQL; days: number }
export async function resolveRange(db: Db, q: { from: string; to: string }): Promise<AnalyticsRange>
export function previousRange(r: AnalyticsRange): AnalyticsRange      // same length, immediately before
// src/analytics/facts.ts — each returns an SQL fragment usable as `with sl as (${saleLines(r)}) ...`
// saleLines columns: sale_id, sale_item_id, variant_id, product_id, brand_id, category_id, seller_id, payment_method,
//                    created_at, qty, unit_price, revenue (numeric), cost (numeric), discount_share (numeric)
// returnLines columns: return_id, sale_id, sale_item_id, variant_id, product_id, brand_id, category_id, seller_id,
//                      refund_method, reason, created_at, qty, refund (numeric), restocked_cost (numeric), restock
// src/lib/cache.ts
export async function memo<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T>
export async function bumpAnalyticsVersion(): Promise<void>
```

---

### Task 1: Range, facts, cache, fixture, migration 0007, lists in store timezone

**Files:** create `src/analytics/range.ts`, `src/analytics/facts.ts`, `src/lib/cache.ts`, `tests/helpers/analytics.ts`, `tests/analytics/facts.test.ts`, `tests/analytics/range.test.ts`; modify `src/db/schema/sales.ts` (indexes) + `pnpm db:generate` → 0007; modify `src/services/sales.ts` and `src/services/movements.ts` to use `resolveRange` for `from`/`to`; call `bumpAnalyticsVersion()` after commit in createSale, voidSale, createReturn, createPurchase, createAdjustments, applyCount.

**Fixture (tests/helpers/analytics.ts)** — settings tz `Africa/Cairo`; brands N (Northline), C (Casa); category T; products PN (brand N, 2 variants N1 price 1000 cost 400, N2 price 2000 cost 1000) and PC (brand C, variant C1 price 500 cost 200); stock via INITIAL. Sales (created_at forced with `update sales set created_at` + matching sale movement dates are irrelevant to analytics):
- S1 2026-06-10 10:00 Cairo, seller A, CASH: N1×2 → subtotal 2000, total 2000, cost 800.
- S2 2026-06-10 23:30 Cairo (= 20:30 UTC), seller B, CARD: N2×1 + C1×2, discount AMOUNT 200 → subtotal 3000, total 2800, cost 1400.
- S3 2026-06-11 00:30 Cairo (= 2026-06-10 21:30 UTC), seller A, CASH: C1×1 → 500, cost 200 → belongs to 06-11.
- S4 2026-06-11 12:00 Cairo, seller A, CASH: N1×1 → 1000, then VOID.
- R1 on S2, 2026-06-11 15:00 Cairo: C1×1 restock, refund = cumulative rule → round(500×2800/3000)=467, refundMethod CARD.
Expected for range 06-10..06-11: revenue = 2000 + 2800 + 500 − 467 = 4833; cogs = 800 + 1400 + 200 − 200 = 2200; profit = 2633; salesCount = 3; unitsSold = 2 + 3 + 1 − 1 = 5. Range 06-10..06-10: revenue 4800, cogs 2200, count 2. Export these as `EXPECTED` constants.

- [x] Step 1 (tests): range — `resolveRange` 400 cases (`to < from`, 400 days, `2026-02-30`); S3 falls on 06-11 (query `saleLines` for 06-10 only → sale ids S1, S2). facts — over 06-10..06-11: Σ revenue − Σ refund = 4833, Σ cost − Σ restocked = 2200; VOID S4 absent. lists — `GET /sales?from=2026-06-11&to=2026-06-11` returns S3 and S4 (not S2). cache — `memo` without Upstash env calls fn every time; version bump is a no-op.
- [x] Step 2 RED → Step 3 implement → Step 4 GREEN (full suite: lists still pass) → Step 5 commit `feat(analytics): shared range, sales/return facts, cache, timezone-aware lists (0007 indexes)`

---

### Task 2: Dashboard KPIs, trend, payment mix

**Files:** `src/analytics/{kpis,trend,payment-mix,dashboard}.ts`, routes `analytics/{dashboard,sales-trend,payment-mix}/route.ts`, `src/analytics/registry.ts` (create with these three), tests `tests/analytics/{kpis,trend,payment-mix,dashboard}.test.ts`; manifest.

**Produces:** `kpis(db, r): DashboardKpis` (totalCash = revenue; cashByMethod = sales by method − refunds by refund method; grossProfit; marginPct; cogs; unitsInStock/skusInStock/stockValueCost/stockValueRetail from stock on hand; salesCount (non-VOID sales in range); avgBasket = round(Σ sale totals ÷ salesCount); lowStockCount/outOfStockCount (same rule as /stock/low); deltas vs `previousRange` in percent, one decimal, prev 0 → 0 if cur 0 else 100). `trend(db, r, interval)` → `TrendPoint[]` (revenue/profit/cogs/count per bucket incl. empty). `paymentMix(db, r)` → 4 rows always (count = sales, total = sales − refunds by method). `dashboard(db, r)` → `DashboardData` with trend (day), brandSplit (from Task 3's `brands()` — import lazily; until Task 3 lands use an inline query returning `{id,name,revenue,sharePct}`), topProducts (5 by units), lowStock (6 from `lowStock()` out first), recentSales (6 latest via `loadSalesOut`).
- [x] Step 1 (tests, fixture): KPIs 06-10..06-11 revenue 4833, cogs 2200, grossProfit 2633, marginPct 54.5, salesCount 3, avgBasket round(5300/3)=1767, cashByMethod CASH 2500 / CARD 2333; trend day → 06-10 {revenue 4800, cogs 2200, profit 2600, count 2}, 06-11 {revenue 33, cogs 0, profit 33, count 1}; payment mix 4 rows; deltas vs 06-08..06-09 (empty) → 100; SELLER → 403.
- [x] RED → GREEN → commit `feat(analytics): dashboard KPIs, sales trend, payment mix`

### Task 3: Brands, categories, top products, top variants, size × colour

**Files:** `src/analytics/{brands,categories,top-products,size-color}.ts`, routes `analytics/{brands,categories,top-products,top-variants,size-color}/route.ts`, register in `registry.ts`, tests.
**Produces:** brands → rows `{ id, name, unitsInStock, stockValueCost, stockValueRetail, unitsSold, revenue, profit, marginPct, sharePct }` for every active brand (zeros included), sorted by revenue desc; categories → `CategoryStats` (daysOfCover = round(unitsInStock ÷ (unitsSold ÷ days)), 999 when unitsSold ≤ 0); top-products `?by=units|revenue|profit&limit=1..50` → `TopProduct[]`; top-variants same + `variantId, size, color, sku`; size-color `?brandId&from&to` (range optional → last 30 days) → `SizeColorMatrix` with sizes in apparel order then numeric.
- [x] Step 1 (tests): brand N revenue = 2000 + round(2000×2800/3000)=1867 → 3867; brand C = round(1000×2800/3000)=933 + 500 − 467 = 966; Σ = 4833 = KPI revenue; category T revenue 4833; top-products by units → PN (3) then PC (2); size-color cells qty/sold.
- [x] RED → GREEN → commit `feat(analytics): brand, category, product, variant and size-colour reports`

### Task 4: Slow movers, stock ageing, sellers, returns, price list

**Files:** `src/analytics/{slow-movers,stock-ageing,sellers,returns,price-list}.ts`, routes, register, tests.
**Produces:** slow-movers `?days=1..365 (default 60)` → `SlowMover[]` (variants qty>0 of ACTIVE products whose last SALE movement — else first movement — is ≥ days ago; `soldLast90d`; suggestion: >90 'Markdown 20%', >70 'Bundle', >60 'Move to front', else 'Watch'; sorted by valueAtCost desc); stock-ageing → 4 buckets `0-30, 31-60, 61-90, 90+` by days since last INITIAL/PURCHASE movement, `{ bucket, units, valueCost }`; sellers → `SellerStats[]` (discountGiven = Σ discount; discountPct = discount ÷ (revenue+discount) ×100; returns of their sales created in range); returns → `ReturnsReport` (ratePct = returns ÷ sales in range ×100; byReason); price-list `paginationQuery` → `{ data: [{ variantId, productName, brand, sku, size, color, costPrice, sellPrice, marginPct, quantity }], page, pageSize, total }`.
- [x] Step 1 (tests): sellers A {salesCount 2, revenue 2500}, B {1, 2800−467=2333, discountGiven 200, returnsCount 1, returnsValue 467}; returns {count 1, value 467, ratePct 33.3}; slow movers with a backdated movement; ageing buckets sum to units in stock; price-list margin.
- [x] RED → GREEN → commit `feat(analytics): slow movers, stock ageing, sellers, returns, price list`

### Task 5: CSV export + caching wiring + indexes check

**Files:** `src/app/api/v1/analytics/export/route.ts`, `src/lib/csv.ts` (`toCsv(rows)` with formula escaping: cells starting with `= + - @ \t \r` prefixed with `'`), tests `tests/analytics/export.test.ts`, `tests/lib/csv.test.ts`; wrap every report route's run in `memo('an:v<version>:<report>:<params>')`.
- [x] Step 1 (tests): `?report=payment-mix&from&to` → `text/csv`, header row, 4 data rows; unknown report → 400; formula cell `=SUM(1)` → `'=SUM(1)`; memo: with a fake Upstash seam, second call hits the cache, `bumpAnalyticsVersion` invalidates.
- [x] RED → GREEN → commit `feat(analytics): CSV export and report caching`

### Task 6: Docs, checklist, verification, review

- [x] API-SPEC analytics notes (definitions, tz, shapes), DECISIONS, SPRINTS ticks; `pnpm typecheck && lint && test && build && audit`; review; commit `docs: sprint 4`.

## Deferred
- `EXPLAIN ANALYZE` on 10k sales (`scripts/seed-big.ts`) → Sprint 6 performance task.

## Outcome (2026-11-05)
All 6 tasks complete on branch `sprint-4` (Tasks 2–4 by three parallel implementers on Opus after the Fable dispatch hit a credit limit). Final review by two reviewers: no Critical; reconciliation, NULL-revenue, cache-exposure and overflow findings fixed test-first in one pass. Every report now reconciles with KPI revenue on adversarial data (partial returns across days, 100 % discounts, zero-subtotal sales, deleted sellers, retired brands, DST change). Deferred items in `docs/plans/ledgers/sprint-4-ledger.md`.
