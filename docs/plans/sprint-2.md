# Sprint 2 — Stock Ledger: movements, purchases, adjustments, counts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stock change is an immutable ledger row created through `applyMovement()`; purchases (with weighted-average cost and idempotency), adjustments, a filterable movements ledger, low-stock lists and stock-count sessions are exposed through the API with the shapes the frontend already consumes.

**Architecture:** Sprint 1's `applyMovement()` stays the only writer of `variants.quantity`; this sprint adds `qtyAfter`, a `lockVariants()` helper (ids locked in sorted order before any movement in a multi-variant transaction), document numbers from a `sale_counters` row lock, and a DB-backed `withIdempotency()` for `POST /stock/purchases`. Routes stay thin (`parse → withAuth → service → serializer`). Shapes follow `src/types.ts` (`StockMovement`, `Purchase`, `StockCount`, `StockCountItem`, `VariantWithProduct`), re-declared in `src/serializers/stock.ts`.

**Tech Stack:** unchanged (Drizzle, PGlite tests, Zod 4).

**Spec:** `CLAUDE.md` (rule 1), `docs/SPRINTS.md` (Sprint 2), `docs/DATA-MODEL.md` (stock, sales → `sale_counters`), `docs/API-SPEC.md` (Stock), `docs/ACCESS-MATRIX.md`, `docs/SECURITY.md` (Data integrity), `src/types.ts` + `src/mock/store.ts` (consumer shapes/params), `docs/plans/sprint-1.md` (conventions, ledger).

## Global Constraints

- `variants.quantity` written only by `applyMovement()` (`src/services/stock.ts`); every multi-variant transaction calls `lockVariants(tx, ids)` first (ids sorted) to avoid deadlocks.
- Movements are immutable: no UPDATE/DELETE on `stock_movements` anywhere.
- Money integer minor units; `unitCost` is a cost field → stripped for SELLER (no seller-readable route in this sprint except `/stock/low` and counts, which carry `costPrice` on items → strip).
- Permissions (ACCESS-MATRIX): `GET /stock/movements` `stock.read.ledger`; `POST /stock/adjustments` `stock.adjust`; `POST/GET /stock/purchases*` `stock.receive`; `GET /stock/low` `stock.read`; `POST /stock/counts`, `POST /stock/counts/:id/apply`, `POST /stock/counts/:id/cancel` `stock.count.manage`; `GET /stock/counts`, `GET/PATCH /stock/counts/:id` `stock.count.read`.
- Every route registered in `src/lib/route-manifest.ts` under `// --- stock ---`; every mutation audited; all schemas `.strict()`; pagination max 100.
- Idempotency: `POST /stock/purchases` honours `Idempotency-Key` (uuid) per user for 24 h; replay returns the stored status+body with header `Idempotent-Replayed: true`.
- Numbers: `PO-000001`, `SC-000001` (6 digits), allocated with `SELECT … FOR UPDATE` on `sale_counters(prefix)`; the row is created on first use.
- Conventional commits, explicit paths only (shared tree).

## Review Focus

1. Adjustment with `newQty` equal to the current quantity → no movement, 200 with an empty list (not 500, not a zero-delta ledger row). (Task 4 test.)
2. Purchase replayed with the same `Idempotency-Key` → identical response, stock moved once; same key with a different body → 409. (Task 5 test.)
3. Applying a count twice, or after cancel → 409; variance uses live quantity at apply time, so a sale between snapshot and apply does not double-adjust. (Task 7 test.)
4. Movements list filtered by `from`/`to` treats dates as UTC day boundaries (`to` inclusive). (Task 3 test.)
5. Purchase line with `qty 0` or `unitCost` beyond int4 → 400 with per-line field path (`items.0.qty`), nothing inserted. (Task 5 test.)

---

## File structure

```
src/db/schema/stock.ts       + qtyAfter on stockMovements; purchases, purchaseItems, stockCounts, stockCountItems,
                               stockCountStatusEnum; saleCounters (prefix pk, next); idempotencyKeys
drizzle/0004_*.sql           generated + backfill of qty_after
src/services/stock.ts        + lockVariants(), applyMovements(), nextNumber(); qtyAfter in applyMovement
src/lib/idempotency.ts       withIdempotency(db, user, key, body, fn)
src/schemas/stock.ts         movementsQuery, adjustmentsBody, purchaseBody, purchasesQuery, countStartBody, countItemsBody, countApplyBody
src/serializers/stock.ts     StockMovementOut, PurchaseOut, StockCountOut, StockCountItemOut + mappers
src/services/movements.ts    listMovements()
src/services/adjustments.ts  createAdjustments()
src/services/purchases.ts    createPurchase(), listPurchases(), getPurchase()
src/services/low-stock.ts    lowStock()
src/services/counts.ts       startCount(), listCounts(), getCount(), saveCountItems(), applyCount(), cancelCount()
src/services/catalog.ts      (modify) supplier purchaseCount/lastPurchaseAt real
src/app/api/v1/stock/{movements,adjustments,purchases,purchases/[id],low,counts,counts/[id],counts/[id]/apply,counts/[id]/cancel}/route.ts
tests/helpers/stock.ts       stockFixture(db) → brand/category/product/3 variants with INITIAL stock via applyMovement
tests/services/stock.test.ts (+ qtyAfter, lockVariants, nextNumber), tests/lib/idempotency.test.ts,
tests/stock/{movements,adjustments,purchases,low,counts}.test.ts, tests/db/stock-schema.test.ts
```

Shared types (defined once):

```ts
// src/services/stock.ts
export interface MovementResult { movementId: string; quantity: number; costPrice: number | null }   // quantity == qtyAfter
export async function lockVariants(tx: Db, ids: string[]): Promise<Map<string, { quantity: number; costPrice: number | null }>>
export async function nextNumber(tx: Db, prefix: 'PO' | 'SC' | 'AS'): Promise<string>
// src/lib/idempotency.ts
export async function withIdempotency<T>(db: Db, userId: string, key: string | null, requestHash: string,
  fn: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T; replayed: boolean }>
// src/serializers/stock.ts (mirror src/types.ts)
export interface StockMovementOut { id; variantId; variant: { size; color: ColorRef; sku; productName }; type; qtyDelta; qtyAfter;
  unitCost?: number; reference?: { kind; id; label }; reason?: string; userId: string | null; userName: string; createdAt: string }
export interface PurchaseOut { id; number; supplierId?; supplierName?; invoiceRef?; items: { variantId; qty; unitCost }[]; lineCount; unitCount; total; receivedAt; createdBy; createdByName; note? }
export interface StockCountItemOut { variantId; variant: { size; color; sku; costPrice?; productName }; systemQty; countedQty: number | null; countedBy?; countedAt? }
export interface StockCountOut { id; number; status; scope; startedBy; startedByName; startedAt; appliedAt?; counters: string[]; items: StockCountItemOut[] }
```

---

### Task 1: Schema — counters, purchases, counts, idempotency, qty_after

**Files:** Modify `src/db/schema/stock.ts`; create `drizzle/0004_*.sql` (generated, then hand-append the backfill); modify `tests/helpers/db.ts` TABLES; `docs/DATA-MODEL.md` (add `qty_after`, `purchases.number`, `stock_counts.number/scope`, `idempotency_keys`).
**Test:** `tests/db/stock-schema.test.ts`.

**Produces:**
- `stockMovements.qtyAfter: integer('qty_after').notNull()`.
- `saleCounters` (`prefix text pk`, `next integer not null default 1`).
- `purchases` (id, number text unique, supplierId fk set-null, invoiceRef, total int, receivedAt timestamptz, note, createdBy fk set-null, createdAt); `purchaseItems` (id, purchaseId fk cascade, variantId fk restrict, qty int, unitCost int; index purchaseId).
- `stockCountStatusEnum('stock_count_status', ['OPEN','APPLIED','CANCELLED'])`; `stockCounts` (id, number unique, status default OPEN, scope text default 'all', startedBy fk set-null, startedAt, appliedAt, appliedBy fk set-null, note); `stockCountItems` (id, countId fk cascade, variantId fk restrict, systemQty int, countedQty int null, countedBy fk set-null, countedAt; unique(countId, variantId)).
- `idempotencyKeys` (userId fk cascade, key text, requestHash text, status int, response jsonb, createdAt; pk (userId, key); index createdAt).
- Migration 0004: generated DDL + `ALTER TABLE stock_movements ADD COLUMN qty_after integer` as nullable first, backfill `UPDATE stock_movements m SET qty_after = s.running FROM (SELECT id, SUM(qty_delta) OVER (PARTITION BY variant_id ORDER BY created_at, id) AS running FROM stock_movements) s WHERE s.id = m.id`, then `SET NOT NULL` (edit the generated SQL so the NOT NULL comes after the backfill; keep `--> statement-breakpoint`).

- [ ] **Step 1 (test):** tables select `[]`; `stock_count_items` unique `(count_id, variant_id)` → `23505`; `idempotency_keys` pk `(user_id, key)` → `23505`; inserting a movement without `qty_after` → `23502`.
- [ ] **Step 2:** run → FAIL. **Step 3:** schema + `pnpm db:generate` + edit SQL (verify order: add nullable → backfill → set not null). **Step 4:** run → PASS (`tests/db`, `tests/services/stock` will now fail on qtyAfter — expected until Task 2; run only `tests/db/stock-schema`).
- [ ] **Step 5: Commit** `chore(db): purchases, stock counts, counters, idempotency keys, movements.qty_after (0004)`

---

### Task 2: Ledger extensions — qtyAfter, lockVariants, applyMovements, nextNumber, withIdempotency

**Files:** Modify `src/services/stock.ts`, `src/db/seed.ts` (no change needed if applyMovement sets qtyAfter); create `src/lib/idempotency.ts`. Tests: `tests/services/stock.test.ts` (+cases), `tests/lib/idempotency.test.ts`.

**Produces:**
- `applyMovement` sets `qtyAfter = newQty` on the inserted row; `MovementResult` unchanged.
- `lockVariants(tx, ids)`: `select id, quantity, cost_price from variants where id = any($1) order by id for update`; throws `NOT_FOUND` listing missing ids in `fields`.
- `applyMovements(tx, inputs: MovementInput[])`: calls `lockVariants` on the distinct ids (sorted) then `applyMovement` for each input in the given order; returns `MovementResult[]`.
- `nextNumber(tx, prefix)`: `insert into sale_counters(prefix) values($1) on conflict do nothing`, then `select next from sale_counters where prefix=$1 for update`, update `next+1`, return `${prefix}-${String(n).padStart(6,'0')}`.
- `withIdempotency`: `key === null` → run `fn`; else look up `(userId, key)`: hit with same `requestHash` → return stored `{status, body, replayed:true}`; hit with different hash → `AppError('CONFLICT', 'Idempotency-Key reused with a different request')`; miss → run `fn` inside the caller's transaction? No: run `fn` (which opens its own transaction), then insert the row (`on conflict do nothing`); rows older than 24 h are ignored on lookup (`created_at > now() - interval '24 hours'`). `requestHash = sha256(JSON.stringify(body))` computed by the route.

- [ ] **Step 1 (tests):** qtyAfter equals result quantity after INITIAL +10 then SALE −3 (10, 7); `lockVariants` with an unknown id → NOT_FOUND; `applyMovements` on [B, A] locks sorted and applies in input order (assert both quantities); `nextNumber('PO')` → `PO-000001`, `PO-000002`; two prefixes independent; idempotency: first call runs fn once and stores; second call with same hash returns stored body and `replayed: true` without calling fn; different hash → CONFLICT; expired row (set `createdAt` 25 h ago) → fn runs again.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `pnpm vitest run tests/services tests/lib/idempotency tests/db tests/products` → PASS (Sprint 1 suites must still pass).
- [ ] **Step 5: Commit** `feat(stock): qtyAfter, sorted variant locking, document numbers, DB-backed idempotency`

---

### Task 3: Movements ledger — `GET /stock/movements`

**Files:** create `src/schemas/stock.ts` (movementsQuery), `src/serializers/stock.ts` (StockMovementOut + `toMovement`), `src/services/movements.ts`, `src/app/api/v1/stock/movements/route.ts`, `tests/helpers/stock.ts`; modify manifest (`// --- stock ---` section — create the anchor in Task 2's commit if absent). Test `tests/stock/movements.test.ts`.

**Produces:**
- `movementsQuery = paginationQuery.extend({ variantId?: uuid, productId?: uuid, type?: enum(5), from?: YYYY-MM-DD, to?: YYYY-MM-DD, userId?: uuid, q?: string max 100 }).strict()`; `from`/`to` → `[from 00:00Z, to 24:00Z)`.
- `listMovements(db, query): Paginated<StockMovementOut>` — join variants, products, users (left); `reference.label` = purchase `number` / count `number` (sale later) via left joins on `reference_kind`; `q` matches sku ILIKE or product name ILIKE (escaped); newest first (`created_at desc, id desc`); `count(*) over()` + fallback count.
- `tests/helpers/stock.ts`: `stockFixture(db, user?)` → `{ brand, category, product, variants: [A,B,C] }` with INITIAL 10/5/0 via `db.transaction(applyMovement)`.

- [ ] **Step 1 (tests):** MANAGER list → rows have `qtyAfter`, `variant.productName`, `userName` ('—' when null), `unitCost` present; filters `variantId`, `type=INITIAL`, `from/to` (movement created today included with `to=today`, excluded with `to=yesterday`), `q=<sku>`; SELLER → 403; pageSize 500 → 400.
- [ ] **Step 2–5:** RED → implement + register → GREEN → commit `feat(stock): movements ledger listing with filters`

---

### Task 4: Adjustments — `POST /stock/adjustments`

**Files:** `src/services/adjustments.ts`, `src/app/api/v1/stock/adjustments/route.ts`; schemas (`adjustmentsBody`); manifest. Test `tests/stock/adjustments.test.ts`.

**Produces:** `adjustmentsBody = { items: z.array({ variantId uuid, qtyDelta?: int (≠0, |x| ≤ INT4), newQty?: int ≥0 ≤ INT4, reason: enum DAMAGED|LOST|FOUND|CORRECTION|OTHER, note?: ≤500 }.strict().refine(exactly one of qtyDelta/newQty)).min(1).max(200) }`; `createAdjustments(db, user, input, ctx): Promise<StockMovementOut[]>` — one transaction: `lockVariants`, compute delta (`newQty - quantity`), skip zero deltas, `applyMovement` type ADJUSTMENT with `reason: `${reason}${note ? ': ' + note : ''}``, audit `stock.adjust` once with the list; returns created movements (via `listMovements`-style serializer).

- [ ] **Step 1 (tests):** `qtyDelta: -4` on A(10) → 200, `[ { qtyDelta: -4, qtyAfter: 6, type: 'ADJUSTMENT' } ]`; `newQty: 10` on A(10) → 200 `[]` and no movement row; `newQty: 2` on B(5) → delta −3; `qtyDelta: -20` on A → 409 `INSUFFICIENT_STOCK` `fields[A]`, no rows; both `qtyDelta` and `newQty` → 400; SELLER → 403; audit row `stock.adjust`.
- [ ] **Step 2–5:** RED → GREEN → commit `feat(stock): adjustments (single and bulk) through the ledger`

---

### Task 5: Purchases — `POST /stock/purchases`, `GET /stock/purchases`, `GET /stock/purchases/:id`

**Files:** `src/services/purchases.ts`, routes `stock/purchases/route.ts`, `stock/purchases/[id]/route.ts`; schemas (`purchaseBody`, `purchasesQuery`); serializer `PurchaseOut`/`toPurchase`; modify `src/services/catalog.ts` (`listSuppliers` real `purchaseCount`, `lastPurchaseAt`); manifest; `src/lib/http.ts`? no — route reads header `Idempotency-Key` (uuid regex) and computes `requestHash` with `createHash('sha256')`. Tests `tests/stock/purchases.test.ts` (+ supplier count assertion in `tests/catalog/suppliers.test.ts`).

**Produces:** `purchaseBody = { supplierId?: uuid, invoiceRef?: ≤60, receivedAt?: ISO datetime, note?: ≤500, items: array({ variantId uuid, qty int 1..INT4, unitCost money }).min(1).max(200) }.strict()`; `createPurchase(db, user, input, ctx): Promise<PurchaseOut>` — transaction: `lockVariants`, `nextNumber('PO')`, insert purchase (`total = Σ qty*unitCost`, `receivedAt ?? now`), items, `applyMovement` PURCHASE per line with `unitCost`, `reference { kind:'purchase', id }`, audit `purchase.create`; `listPurchases(db, { page, pageSize })` newest first with `lineCount`, `unitCount`, `supplierName`, `createdByName`; `getPurchase(db, id)` 404.
Route POST: `const key = req.headers.get('idempotency-key')` → if present must match uuid regex else 400; `withIdempotency(db, user.id, key, hash, () => createPurchase(...).then(body => ({ status: 201, body })))`; set header `Idempotent-Replayed: true` on replay.

- [ ] **Step 1 (tests):** create with 2 lines → 201 `number 'PO-000001'`, `total`, `lineCount 2`, `unitCount`, quantities moved, costPrice re-averaged (A: 10@500 + 10@700 → 600), 2 PURCHASE movements with `reference.label 'PO-000001'` in `GET /stock/movements`; second create → `PO-000002`; replay same `Idempotency-Key` + body → 201 identical body, header `Idempotent-Replayed: true`, still 2 movements; same key different body → 409; invalid key format → 400; `items: []` → 400; `qty: 0` → 400 with `fields['items.0.qty']`; unknown variant → 404; SELLER → 403; `GET /stock/purchases` list + `GET /:id`; supplier list now shows `purchaseCount 1` and `lastPurchaseAt`.
- [ ] **Step 2–5:** RED → GREEN → commit `feat(stock): purchases with weighted-average cost and idempotency`

---

### Task 6: Low stock — `GET /stock/low`

**Files:** `src/services/low-stock.ts`, `src/app/api/v1/stock/low/route.ts`; manifest. Test `tests/stock/low.test.ts`.

**Produces:** `lowStock(db): Promise<{ low: VariantWithProductOut[]; out: VariantWithProductOut[] }>` over active variants of ACTIVE products: `low` = `0 < qty ≤ threshold`, `out` = `qty ≤ 0`; ordered by product name, size. Route `stock.read`, `forRole`.

- [ ] **Step 1 (tests):** fixture A(10,thr 3) B(2,thr 3) C(0) → `low:[B]`, `out:[C]`; archived product's variants excluded; SELLER → 200 with `expectNoSellerKeys`.
- [ ] **Step 2–5:** RED → GREEN → commit `feat(stock): low and out-of-stock lists`

---

### Task 7: Stock counts

**Files:** `src/services/counts.ts`; routes `stock/counts/route.ts` (GET list, POST start), `stock/counts/[id]/route.ts` (GET, PATCH), `stock/counts/[id]/apply/route.ts`, `stock/counts/[id]/cancel/route.ts`; schemas (`countStartBody { scope?: ≤60 default 'all', productIds?: uuid[] ≤200 }`, `countItemsBody { items: array({ variantId uuid, countedQty int 0..INT4 }).min(1).max(500) }`, `countApplyBody { uncountedAsZero?: boolean }`); serializer `StockCountOut`; manifest; `docs/API-SPEC.md` (+ `GET /stock/counts`, `POST /stock/counts/:id/cancel`). Test `tests/stock/counts.test.ts`.

**Produces:**
- `startCount(db, user, input, ctx)`: transaction; `nextNumber('SC')`; snapshot `systemQty = quantity` for active variants (of the given products or all ACTIVE products); audit `count.start`.
- `listCounts(db)` newest first (no pagination; ≤ 100 latest); `getCount(db, id)` with items (variance = `countedQty - systemQty` computed client-side; include `counters` = distinct `countedBy` names).
- `saveCountItems(db, user, id, items, ctx)`: OPEN only (else 409); upsert `countedQty`, `countedBy = user.id`, `countedAt`; unknown variant for this count → 400 `fields['items.i.variantId']`; audit `count.update`.
- `applyCount(db, user, id, { uncountedAsZero }, ctx)`: OPEN only; transaction: lock variants (sorted), for each item with `countedQty != null` (or all when `uncountedAsZero`, treating null as 0): `delta = countedQty - liveQuantity`; `applyMovement` ADJUSTMENT with `reference { kind:'count', id }`, `reason 'Stock count <number>'`; skip zero; set `status APPLIED, appliedAt, appliedBy`; audit `count.apply` with movement count.
- `cancelCount` OPEN → CANCELLED; audit `count.cancel`.

- [ ] **Step 1 (tests):** start (MANAGER) → 201 `number 'SC-000001'`, `status OPEN`, 3 items with `systemQty` 10/5/0; SELLER can `GET` and `PATCH` counts (200) but `POST` start → 403 and apply → 403; PATCH `{ items:[{A, countedQty: 8}] }` → item has `countedQty 8`, `countedBy`; sale-like change between snapshot and apply: apply a −1 adjustment to A (live 9) then `apply` → A gets delta `8-9 = -1` (not −2), `status APPLIED`, movement `reference.kind 'count'`; apply again → 409; `uncountedAsZero: true` zeroes B (5→0) and leaves C (0) without a movement; PATCH after apply → 409; cancel OPEN → `CANCELLED`, apply after cancel → 409; SELLER count items → `expectNoSellerKeys`.
- [ ] **Step 2–5:** RED → GREEN → commit `feat(stock): stock count sessions (start, count, apply, cancel)`

---

### Task 8: Docs, checklist, verification, security review

- [ ] DECISIONS (counters pulled forward; qtyAfter column; DB idempotency; count variance against live qty; cancel endpoint; concurrency test limits on PGlite), API-SPEC Stock table notes, DATA-MODEL, SPRINTS ticks (leave "Tests: concurrency (two sales racing…)" ticked only if a real race test exists — see ruling), README unchanged.
- [ ] Verify `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm audit --audit-level=high`; `grep -rn "set({ quantity" src/` → only stock.ts.
- [ ] `/security-review` (A1 matrix incl. new routes; seller-stripping matrix test picks up `/stock/low` and counts automatically; E1–E4).
- [ ] Commit `docs: sprint 2 checklist, decisions, API notes`.

## Deferred
- Real concurrent race test (needs Neon/Docker Postgres) — ruling in ledger; sequential lock-order test stands in.
- Sales/returns references in movement labels (Sprint 3).
