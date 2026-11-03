# SDD ledger — plan: docs/plans/sprint-2.md

Pre-flight:
- T2 lockVariants/applyMovements/nextNumber/withIdempotency ↔ T4/T5/T7 consumers: signatures fixed in plan Shared types — clean
- T3 serializers/stock.ts StockMovementOut ↔ T4 return type: T4 reuses toMovement — clean
- T1 qty_after NOT NULL ↔ T2 applyMovement sets it: T1 alone breaks stock tests until T2 (expected, same session)
- Ruling: branch sprint-2 in place; T1–T2 inline, T3+T4 / T5 / T6+T7 via parallel subagents after T2 — cost: transient matrix failures mid-flight
- Ruling: true concurrency race test deferred (PGlite single connection); lock-order + negative rejection tests stand in — cost: a real deadlock/race on Neon would only surface in prod logs (40P01) until a Docker/Neon test is added
Task 1: complete (commits 6a2eb88..1337bf7, tests: pnpm -s vitest run tests/db/stock-schema → [2m   Duration [22m 1.98s[2m (transform 119ms, setup 434ms, collect 87ms, tests 1.05s, environment 0ms, prepare 174ms)[22m)
Task 2: complete (commits 6a2eb88..1337bf7, tests: pnpm -s vitest run tests/services/stock tests/lib/idempotency → [2m   Duration [22m 2.13s[2m (transform 141ms, setup 926ms, collect 148ms, tests 2.32s, environment 0ms, prepare 337ms)[22m)
PAUSE (2026-11-03, usage limit): Tasks 1–2 complete and committed. Three subagents were dispatched for Tasks 3+4 (movements/adjustments), 5 (purchases), 6+7 (low/counts); they commit their own paths and leave src/lib/route-manifest.ts + docs/API-SPEC.md UNCOMMITTED for the orchestrator. On resume: check `git status`/`git log`, commit the manifest + API-SPEC, run full gates (typecheck, lint, test, build, audit), then Task 8 (docs, checklist, security review), final 3-reviewer pass, fix pass, then /sprint 3.
Task 3: complete (commit 417cfd7, tests/stock/movements 5 passed) — subagent
Task 4: complete (commit c2cab19, tests/stock/adjustments 7 passed) — subagent; Ruling: movements test locates INITIAL rows by variantId because same-transaction rows share created_at (order by id is random) — cost: none
Task 5: complete (commit b968ff6, tests/stock/purchases 9 passed) — subagent; Ruling: purchase items returned ordered by variantId (no position column) — cost: UI shows lines sorted, not input order
Task 6: complete (commit 4fed2cf, tests/stock/low 3 passed) — subagent
Task 7: complete (commit f565918, tests/stock/counts 8 passed) — subagent; Ruling: listCounts returns 20 most recent with items (frontend type requires items) — cost: bounded payload
Task 8: docs committed; integration: suite 470/470, typecheck/lint/build green, audit 0 high; grep: only stock.ts writes quantity; no UPDATE/DELETE on stock_movements
Final review: 3 parallel reviewers. 1 Critical (idempotency check-then-act) + Important: int4 lower bound, invalid calendar dates → 500, count apply on retired variants, lock-order guarantee, seq ordering, DATA-MODEL drift. All fixed in ONE pass (orchestrator + 1 agent), each test RED→GREEN; suite 478/478, typecheck/lint/build green, audit 0 high.
Final: fixed idempotency race — claim-first, route column, concurrent test (3 posts → 1 purchase) RED→GREEN (82bf995)
Final: fixed int4 lower bound, calendar dates, count apply skip, per-id locking, seq ordering, no-op adjust audit, purchases idParams, DATA-MODEL (396a108)
Final: Ruling: duplicate variantIds within one adjustment/purchase request are allowed (applied sequentially, correct math) — cost: ledger shows two rows for one line; acceptable
Final: Ruling: UTC day boundaries for movements from/to until a shared dayRange(tz) helper arrives with analytics (Sprint 4) — cost: Cairo-local "today" misses 00:00–02:00 UTC-offset rows until then
Final: minor (deferred): idempotency_keys purge + response size cap (Sprint 6 cron); listCounts item payload (summaries); adjustment reason_code column; audit action naming consistency (stock.adjust vs entity.verb); receivedAt range; scope label when productIds given; count start with no matching products → 201 empty; variant hard-delete FK message when counted; count(*) over() at 100k+ movements; trigram index on variants.sku; shared productTint subquery; types.ts userId nullability note for frontend
