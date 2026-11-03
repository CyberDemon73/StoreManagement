# Sprint 3 — Sales, returns, receipts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An atomic, auditable POS backend: sales with server-computed totals and discount rules, idempotent checkout, stock locking through the ledger, voids, partial returns with restock, receipts (JSON + HTML) and parked carts.

**Architecture:** Sprint 2 primitives do the heavy lifting: `lockVariants` + `applyMovement` (SALE / RETURN / ADJUSTMENT with `reference { kind: 'sale'|'return', id }`), `nextNumber` for `AS-000001`, `withIdempotency` for `POST /sales`. A pure `computeTotals()` is unit-tested separately from the DB. Ownership (`own` rows in ACCESS-MATRIX) is enforced in services with `user.id`. Shapes mirror `src/types.ts` (`Sale`, `SaleItem`, `Return`, `ParkedSale`, `Cart`).

**Tech Stack:** unchanged.

**Spec:** `CLAUDE.md` (rules 1–6), `docs/SPRINTS.md` (Sprint 3), `docs/DATA-MODEL.md` (sales), `docs/API-SPEC.md` (Sales), `docs/ACCESS-MATRIX.md` (`sales.*`, `returns.create`), `docs/SECURITY.md` (Data integrity), `src/types.ts` + `src/mock/store.ts` (computeCart, createSale, voidSale, createReturn, parkSale), `docs/plans/sprint-2.md` (ledger primitives).

## Global Constraints

- All money integer minor units; `discount.value` for `AMOUNT` is minor units; `PCT` is `0..100` with up to 2 decimals.
- Stock changes only via `applyMovement` inside one transaction after `lockVariants` (sorted). Sale lines may repeat a variant: aggregate quantities per variant before the stock check.
- Server recomputes everything: `unitPrice` from `variants.sellPrice` unless the caller has `sales.price.override` and sends `unitPrice`; `subtotal = Σ unitPrice*qty`; `discount` = `PCT → round(subtotal*pct/100)` or `AMOUNT`, capped at `subtotal`; SELLER (no `sales.discount.unlimited`) with `discount > round(subtotal * sellerDiscountCapPct/100)` → 400 `VALIDATION` `fields.discount`; `total = subtotal - discount`.
- `INSUFFICIENT_STOCK` 409 with `fields[variantId] = 'Only N available'` for every short line (unless `settings.allowNegativeStock`).
- Sellers see/act only on their own sales (`sales.read` own, `returns.create` own); managers see all; `sales.void` managers only.
- Every route in `src/lib/route-manifest.ts` under `// --- sales ---`; every mutation audited; schemas `.strict()`; pagination max 100.
- `POST /sales` honours `Idempotency-Key` (uuid) via `withIdempotency(db, user.id, 'POST /sales', key, hash, fn)`.
- Statuses: COMPLETED → PARTIALLY_REFUNDED → REFUNDED (all qty returned); VOID is terminal; returns/void refused on VOID; void refused if any return exists (409 — refund already paid).
- Conventional commits, explicit paths (shared tree).

## Review Focus

1. Cart with the same variant on two lines whose combined qty exceeds stock → one 409 naming that variant once, nothing written. (Task 2 test.)
2. Double-click checkout with the same `Idempotency-Key` → one sale, one set of movements; without a key two sales are created (documented). (Task 2 test.)
3. Return of more than `qty - returnedQty` on a line, or on a VOID sale → 400/409, nothing written; a full return flips status to REFUNDED. (Task 5 test.)
4. Seller `GET /sales/:id` of another seller's sale → 404 (not 403, no existence leak); manager → 200. (Task 3 test.)
5. Void of a sale that already has a return → 409; void restores exactly `qty - returnedQty` per line. (Task 4 test.)

---

## File structure

```
src/db/schema/sales.ts        saleStatusEnum, paymentMethodEnum, sales, saleItems (+returned_qty), returns, returnItems, parkedSales
drizzle/0006_*.sql
src/services/stock.ts         nextNumber(tx, prefix: string) (generalised)
src/services/sale-math.ts     computeTotals(), lineRefund()  (pure)
src/schemas/sales.ts          saleCreateBody, salesQuery, voidBody, returnBody, parkBody
src/serializers/sales.ts      SaleOut, SaleItemOut, ReturnOut, ParkedSaleOut + mappers
src/services/sales.ts         createSale, getSale(own), listSales(own)
src/services/sale-void.ts     voidSale
src/services/returns.ts       createReturn
src/services/receipts.ts      receiptJson(), receiptHtml()
src/services/parked.ts        listParked, parkSale, unparkSale (+ purge expired)
src/services/movements.ts     (modify) reference label for sale/return kinds
src/app/api/v1/sales/route.ts (GET, POST), sales/[id]/route.ts (GET), sales/[id]/void, sales/[id]/returns,
                              sales/[id]/receipt, sales/parked/route.ts (GET, POST), sales/parked/[id]/route.ts (DELETE)
tests/helpers/sales.ts        saleFixture(db) → fixture + a COMPLETED sale by a seller
tests/sales/*.test.ts, tests/services/sale-math.test.ts, tests/db/sales-schema.test.ts
```

Shared types:

```ts
// src/services/sale-math.ts
export interface TotalsInput { lines: { unitPrice: number; qty: number }[]; discount?: { type: 'PCT'|'AMOUNT'; value: number } }
export interface Totals { subtotal: number; discount: number; discountPct: number | null; total: number }
export function computeTotals(input: TotalsInput): Totals
export function sellerCapExceeded(totals: Totals, capPct: number): boolean   // discount > round(subtotal*cap/100)
export function lineRefund(unitPrice: number, qty: number, subtotal: number, total: number): number  // round(unitPrice*qty*total/subtotal), subtotal 0 → 0
// src/serializers/sales.ts (mirror src/types.ts)
export interface SaleItemOut { id; variantId; productName; size; color: ColorRef; sku; tint; qty; unitPrice; unitCost?: number; lineTotal; returnedQty }
export interface ReturnOut { id; saleId; items: { saleItemId; qty; restock }[]; refundAmount; refundMethod; reason; createdBy; createdAt }
export interface SaleOut { id; number; sellerId; sellerName; items: SaleItemOut[]; subtotal; discount; discountPct?; total; paymentMethod; status; customerName?; customerPhone?; note?; cost?: number; profit?: number; returns: ReturnOut[]; voidReason?; createdAt }
export interface ParkedSaleOut { id; cart: unknown; parkedAt; label }
```

---

### Task 1: Schema + migration 0006 + generalised `nextNumber`

**Files:** create `src/db/schema/sales.ts`; modify `src/db/schema/index.ts`, `src/services/stock.ts` (`nextNumber(tx, prefix: string)`; validate `/^[A-Z]{1,6}$/`), `tests/helpers/db.ts` (TABLES: `return_items, returns, sale_items, sales, parked_sales` before `stock_movements`), `docs/DATA-MODEL.md` (`sale_items.returned_qty`, `parked_sales.label`). Test `tests/db/sales-schema.test.ts`, `tests/services/stock.test.ts` (+1).

**Produces:** `paymentMethodEnum('payment_method', ['CASH','CARD','WALLET','TRANSFER'])`, `saleStatusEnum('sale_status', ['COMPLETED','PARTIALLY_REFUNDED','REFUNDED','VOID'])`; `sales` (id, number unique, sellerId fk set-null, subtotal, discount, discountPct numeric(5,2) null, total, paymentMethod, status default COMPLETED, customerName, customerPhone, note, voidedAt, voidedBy fk set-null, voidReason, createdAt; indexes createdAt, (sellerId, createdAt), status); `saleItems` (id, saleId fk cascade, variantId fk restrict, qty, unitPrice, unitCost int null, lineTotal, returnedQty int default 0; indexes saleId, variantId); `returns` (id, saleId fk cascade, refundAmount, refundMethod, reason, note, createdBy fk set-null, createdAt; index saleId); `returnItems` (id, returnId fk cascade, saleItemId fk cascade, qty, restock bool); `parkedSales` (id, userId fk cascade, label text, payload jsonb, createdAt, expiresAt; index (userId, expiresAt)).

- [x] Step 1 (tests): tables empty; `nextNumber(tx, 'AS')` → `AS-000001`; `nextNumber(tx, 'bad!')` throws; sale number unique → 23505.
- [x] Step 2 RED → Step 3 schema + `pnpm db:generate` (review SQL; rollback comment) → Step 4 GREEN → Step 5 commit `chore(db): sales, sale items, returns, parked sales (0006); generalised document numbers`

---

### Task 2: Sale math + `POST /sales`

**Files:** create `src/services/sale-math.ts`, `src/schemas/sales.ts`, `src/serializers/sales.ts`, `src/services/sales.ts` (createSale + `loadSale(db, id)` internal), `src/app/api/v1/sales/route.ts` (POST; GET added in Task 3), `tests/helpers/sales.ts`; manifest. Tests `tests/services/sale-math.test.ts`, `tests/sales/create.test.ts`.

**Produces:**
- `saleCreateBody = { items: z.array({ variantId uuid, qty int 1..INT4, unitPrice: money.optional() }.strict()).min(1).max(100), discount: { type: enum, value: z.number().min(0).max(INT4) — for PCT ≤ 100 with ≤2 decimals (refine) }.strict().optional(), paymentMethod: enum, customerName?: ≤80, customerPhone?: ≤30, note?: ≤500 }.strict()`.
- `createSale(db, user, input, ctx): Promise<SaleOut>` — transaction: aggregate qty per variant; `lockVariants`; load variants+products (404 for unknown; 409 CONFLICT if product ARCHIVED or variant inactive with `fields[variantId]`); `unitPrice` override requires `can(user,'sales.price.override')` else 403; totals via `computeTotals`; seller cap check with `settings.sellerDiscountCapPct` → 400; stock check → one 409 with all short variants; `nextNumber(tx, settings.saleNumberPrefix)`; insert sale + items (snapshot `unitCost = variant.costPrice`, `tint` not stored — derived from product first colour at read time); `applyMovement` SALE per aggregated variant with `reference { kind:'sale', id }`, `reason: 'Sale <number>'`; audit `sale.create` after = SaleOut (manager fields included); return `loadSale`.
- Route: `withAuth({ permission: 'sales.create' })`, Idempotency-Key handling identical to purchases (`'POST /sales'`), 201 `forRole(sale, role)`.
- `tests/helpers/sales.ts`: `saleFixture(db)` → `{ ...stockFixture, seller, manager, sale }` where `sale` = COMPLETED sale by `seller` of A×2 @1000 + B×1 @1000, no discount, CASH.

- [x] Step 1 (tests): sale-math: subtotal/discount/total for PCT 10 on 3000 → 300/2700, `discountPct 10`; AMOUNT 5000 on 3000 → discount capped 3000, total 0; `sellerCapExceeded` at exactly the cap false, +1 true; `lineRefund(1000, 2, 3000, 2700) === 1800`. create: seller POST A×2+B×1 → 201 `number 'AS-000001'`, `subtotal 3000`, `status COMPLETED`, items with `productName`, `sku`, `tint`, `returnedQty 0`, no `unitCost`/`cost`/`profit` for seller (`expectNoSellerKeys`), movements SALE −2/−1 with `referenceKind 'sale'`, quantities 8/4, audit `sale.create`; manager sees `cost 1500`, `profit 1500`; seller discount PCT 10 (cap 10) → 201; PCT 11 → 400 `fields.discount`; manager PCT 50 → 201; seller `unitPrice` override → 403; manager override 900 → subtotal uses 900; duplicate variant lines A×6 + A×6 (stock 10) → 409 `fields[A] 'Only 10 available'` and no sale/movement rows; C (qty 0) ×1 → 409; archived product → 409; empty items → 400; same Idempotency-Key twice → one sale, second response identical + `Idempotent-Replayed`; `Promise.all` 3 posts same key → exactly one sale.
- [x] RED → implement + register → GREEN → commit `feat(sales): atomic POS checkout with server totals, discount cap, stock locking and idempotency`

---

### Task 3: `GET /sales`, `GET /sales/:id`, movement labels

**Files:** modify `src/services/sales.ts` (listSales, getSale), `src/app/api/v1/sales/route.ts` (GET), create `src/app/api/v1/sales/[id]/route.ts`; modify `src/services/movements.ts` (left join sales for `sale`/`return` reference labels → sale number); manifest. Test `tests/sales/list.test.ts`.

**Produces:** `salesQuery = paginationQuery.extend({ from?: isoDate, to?: isoDate, sellerId?: uuid, paymentMethod?: enum, status?: enum, q?: ≤100 (number ILIKE or customerName ILIKE or customerPhone), productId?: uuid (EXISTS sale_items ⋈ variants) }).strict()`; `listSales(db, user, query)` — SELLER forces `sellerId = user.id` (ignores a different `sellerId` param → 403 `FORBIDDEN`); newest first; items + returns loaded for the page in two queries; `getSale(db, user, id)` → null when missing or (seller and not own).

- [x] Step 1 (tests): manager list all; seller list only own (another seller's sale invisible); seller with `sellerId=<other>` → 403; filters from/to (calendar check), paymentMethod, status, q by number and customer name, productId; seller GET other's sale → 404; manager → 200 with `cost`; `GET /stock/movements` shows `reference.label 'AS-000001'`.
- [x] RED → GREEN → commit `feat(sales): list and detail with ownership; sale labels in the ledger`

---

### Task 4: `POST /sales/:id/void`

**Files:** create `src/services/sale-void.ts`, `src/app/api/v1/sales/[id]/void/route.ts`; schemas `voidBody { reason: ≤500 min 1 }`; manifest. Test `tests/sales/void.test.ts`.

**Produces:** `voidSale(db, user, id, { reason }, ctx)` — transaction: lock sale row `FOR UPDATE`; 404 missing; 409 if VOID or has any return; `lockVariants`; per item `applyMovement` ADJUSTMENT `+ (qty - returnedQty)` with `reference { kind:'sale', id }`, `reason 'Void <number>'`; set status VOID, voidedAt/By/Reason; audit `sale.void`. Route `sales.void`, 200 SaleOut.

- [x] Step 1 (tests): manager void → 200 `status VOID`, quantities restored 10/5, ADJUSTMENT movements with sale reference; second void → 409; seller → 403; empty reason → 400; void after a return → 409 (needs Task 5 → write this assertion in Task 5's test file instead).
- [x] RED → GREEN → commit `feat(sales): void with stock reversal`

---

### Task 5: `POST /sales/:id/returns`

**Files:** create `src/services/returns.ts`, `src/app/api/v1/sales/[id]/returns/route.ts`; schemas `returnBody { items: array({ saleItemId uuid, qty int ≥1, restock bool }.strict()).min(1).max(100), refundMethod: enum, reason: ≤500 min 1, note?: ≤500 }.strict()`; manifest. Test `tests/sales/returns.test.ts`.

**Produces:** `createReturn(db, user, saleId, input, ctx)` — transaction: lock sale; 404 (own for seller); 409 if VOID; items must belong to the sale (400 `fields['items.i.saleItemId']`); `qty > item.qty - item.returnedQty` → 400 `fields['items.i.qty']`; `refundAmount = Σ lineRefund(unitPrice, qty, sale.subtotal, sale.total)`; insert return + items; update `returnedQty`; restock lines → `lockVariants` + `applyMovement` RETURN `+qty` with `unitCost = item.unitCost`, `reference { kind:'return', id }`; status → REFUNDED if every item fully returned else PARTIALLY_REFUNDED; audit `return.create`. Route `returns.create` (own enforced in service), 201 SaleOut (the updated sale).

- [x] Step 1 (tests): seller returns A×1 restock → 201, `returns[0].refundAmount 1000`, `status PARTIALLY_REFUNDED`, A qty 9, RETURN movement with `unitCost 500`; non-restock return of B → no movement, qty unchanged; returning the rest → `REFUNDED`; over-return → 400 `fields['items.0.qty']`; foreign saleItemId → 400; other seller's sale → 404; manager can return any; return on VOID → 409; void after return → 409; discounted sale (manager PCT 10) return A×1 → refund 900.
- [x] RED → GREEN → commit `feat(sales): partial returns with proportional refunds and restock`

---

### Task 6: `GET /sales/:id/receipt`

**Files:** create `src/services/receipts.ts`, `src/app/api/v1/sales/[id]/receipt/route.ts`; schema `receiptQuery { format: z.enum(['json','html']).default('json') }`; manifest. Test `tests/sales/receipt.test.ts`.

**Produces:** `receiptJson(db, user, id)` → `{ sale: SaleOut (role-stripped), store: { storeName, phone, address, logoUrl, currency, receiptHeader, receiptFooter } }`; `receiptHtml(data)` → self-contained HTML (inline CSS, no scripts, all text HTML-escaped) with number, date, lines, totals, payment, header/footer. Route `sales.read` (own), `Content-Type: text/html; charset=utf-8` for html.

- [x] Step 1 (tests): json shape; html contains the number and escaped customer name (`<b>x</b>` → `&lt;b&gt;`); no `<script`; seller other's → 404; `format=pdf` → 400.
- [x] RED → GREEN → commit `feat(sales): receipts (JSON and printable HTML)`

---

### Task 7: Parked sales

**Files:** create `src/services/parked.ts`, `src/app/api/v1/sales/parked/route.ts` (GET, POST), `src/app/api/v1/sales/parked/[id]/route.ts` (DELETE); schema `parkBody { label: ≤60 min 1, cart: z.object({ lines: array(≤100 of { variantId uuid, qty int ≥1, unitPrice money, productId uuid, productName ≤200, size ≤20, color: colorRef, sku ≤60, tint ≤7, available int }), discount, paymentMethod, customerName?, customerPhone?, note? }).strict() }.strict()` (cart stored as given; it is a client convenience, never trusted for totals); manifest. Test `tests/sales/parked.test.ts`.

**Produces:** `listParked(db, user)` (own, unexpired, purges expired rows for this user first), `parkSale(db, user, input)` (409 at 3 active), `unparkSale(db, user, id)` (delete + return; 404 if not own/expired). TTL 24 h. Routes `sales.create`; DELETE returns 200 with the ParkedSaleOut.

- [x] Step 1 (tests): park → 201 with `parkedAt`, `label`; 4th → 409; list own only; DELETE returns the cart and removes it; expired row (set `expiresAt` past) not listed and DELETE → 404; other user's id → 404.
- [x] RED → GREEN → commit `feat(sales): parked carts (max 3, 24 h)`

---

### Task 8: Docs, checklist, verification, security review

- [x] DECISIONS (AMOUNT minor units; seller cap → 400; void via ADJUSTMENT; refund share rule; void blocked after return; parked TTL purge-on-read), API-SPEC Sales notes, SPRINTS ticks (`?format=pdf` deferred: HTML print instead — tick with note), DATA-MODEL. Verify `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm audit --audit-level=high`; `/security-review full` (A1 matrix, A2 seller stripping incl. `/sales`, ownership filters in `services/sales.ts` and `services/returns.ts`, E3 race, E4 idempotency).
- [x] Commit `docs: sprint 3 checklist, decisions, API notes`.

## Deferred
- `?format=pdf` (HTML print is the spec's "keep simple" option).
- Customer records (phase 2).

## Outcome (2026-11-05)
All 8 tasks complete on branch `sprint-3` (Tasks 3–7 by three parallel implementers). Final review by two reviewers found one Critical (seller cost leak) and five Important findings; all fixed test-first in one pass, plus four minor hardening items. The frontend session verified checkout, receipt and sales list against the owner's Neon database. Deferred items in `docs/plans/ledgers/sprint-3-ledger.md`.
