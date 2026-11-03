# SDD ledger — plan: docs/plans/sprint-3.md

Pre-flight:
- T2 sale-math/serializers/sales.ts ↔ T3–T7 consumers: SaleOut + loadSale shared; T4/T5 lock the sale row then variants (consistent order: sale → variants → counter) — clean
- T1 nextNumber(prefix: string) ↔ existing PO/SC callers: string literal still valid — clean
- Ruling: branch sprint-3 in place; T1–T2 inline, then parallel agents T3+T6 / T4+T5 / T7 — cost: transient matrix failures mid-flight
Task 1: complete (commits 9f5c14c..747f88f, tests: pnpm -s vitest run tests/db/sales-schema tests/services/stock → [2m   Duration [22m 4.48s[2m (transform 317ms, setup 2.02s, collect 318ms, tests 4.67s, environment 0ms, prepare 721ms)[22m)
Task 2: complete (commits 747f88f..198b3a4, tests: pnpm -s vitest run tests/sales tests/services/sale-math → [2m   Duration [22m 5.20s[2m (transform 431ms, setup 2.10s, collect 536ms, tests 5.01s, environment 1ms, prepare 705ms)[22m)
Task 3: complete (commits 36f5cd9, b9481d3; tests/sales/list 9 + movements label 1) — subagent; Ruling: label choice moved into serializers/movements.ts (outside brief) — cost: none
Task 4: complete (commit a02b90a; tests/sales/void 4) — subagent
Task 5: complete (commit 646dad7; tests/sales/returns 8) — subagent; exported lockSale shared with void
Task 6: complete (commit 0cec595; tests/sales/receipt 4) — subagent; html goes through forRole before templating
Task 7: complete (commit 171c13a; tests/sales/parked 5) — subagent; Ruling: per-user pg_advisory_xact_lock in parkSale so concurrent parks cannot exceed 3 — cost: none
Integration: Ruling: sale lines ordered by sku (sale_items ids are random UUIDs) — cost: receipt lines follow sku order, not tap order; suite 574/574, typecheck/lint/build green, audit 0 high
Final review: 2 parallel reviewers (general, adversarial). 1 Critical (seller cost leak) + Important: profit ignored restocked returns and VOID, refunds could exceed total (per-line rounding), PCT float rejection, returns route without idempotency; Minor fixed: int4 overflow 500, restock of retired variants, receipt UTC date, http logo. All fixed in ONE pass by the orchestrator, each test RED→GREEN.
Final: fixed seller `cost` leak — hard-coded seller-keys test + explicit body.cost undefined RED→GREEN
Final: fixed profit/cost rule (restocked + VOID) — returns tests RED→GREEN
Final: fixed refund rounding — cumulativeRefund tests + 333/333/334 @10% API test RED→GREEN
Final: fixed PCT 5.1 rejected — schema test RED→GREEN
Final: fixed returns double-refund on retry — Idempotency-Key test RED→GREEN
Final: fixed int4 overflow 500 → 400; retired-variant restock skipped; receipt local date; https-only logo — tests RED→GREEN
Final: Ruling: list day bounds stay UTC until Sprint 4 shared dayRange — cost: Cairo-local early-morning sales filed under the previous day until then
Final: Ruling: saleNumberPrefix validation deferred to Sprint 5 settings PATCH (no write path today) — cost: none until settings ships
Final: minor (deferred): return_items indexes + CHECK constraints (next migration); productTint subquery third copy → shared helper; lockSale belongs in sales.ts; sale loaded twice in createSale; status flip on return not audited as sale.update; parked empty cart allowed; '' for deleted user ids; receipt shows no refund rows; AMOUNT > subtotal silently clamped (managers); void writes one ADJUSTMENT per line not per variant; idempotency claim stuck 24 h if the process dies between commit and status update
