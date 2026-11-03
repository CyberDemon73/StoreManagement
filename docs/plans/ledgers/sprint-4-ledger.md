# SDD ledger — plan: docs/plans/sprint-4.md

Pre-flight:
- T1 range/facts/fixture ↔ T2–T5 reports: AnalyticsRange + saleLines/returnLines columns fixed in plan — clean
- T2 registry.ts creation ↔ T3/T4 registrations: anchors per task in registry — clean
- Ruling: T1 inline; T2, T3, T4 parallel agents; T5 inline after — cost: transient registry/manifest conflicts handled by anchors
Task 1: complete (commits a42f4e8..1b3ab7c, tests: pnpm -s vitest run tests/analytics → [2m   Duration [22m 2.95s[2m (transform 265ms, setup 551ms, collect 339ms, tests 1.50s, environment 0ms, prepare 244ms)[22m)
Task 1: Ruling: analytics cache invalidated centrally in withAuth after any successful non-GET outside /auth and /setup (not per service) — after commit, covers price edits too — cost: one Redis INCR per mutation when Upstash is configured
Task 1: Ruling: Egypt observes DST (UTC+3 in summer); fixture uses explicit UTC instants and Postgres tzdata — cost: none
Task 2-4: Ruling: first dispatch (Fable 5.1) failed immediately on usage credits; relaunched on Opus 5.5 with the same scope — cost: none
Task 5: note: csv.ts test was written before the implementation but not run RED first (pure function); GREEN 4/4
Task 2: complete (commit 25d3f05; tests/analytics kpis/trend/payment-mix/dashboard 18) — subagent (Opus); Ruling: deltas divide by |prev| so a negative previous period keeps the sign — cost: differs from mock
Task 3: complete (commit eb5b545; tests 12) — subagent (Opus); Ruling: brands and categories share dimensionStats(); marginPct from unrounded numerics (53.4 not 53.5) — cost: none
Task 4: complete (commit 2c9d6ef; tests 12) — subagent (Opus); Ruling: soldLast90d uses a rolling now()-90d window, not local dates — cost: edge-of-day drift only
Task 5: complete (export + cache + manifest/registry commit; tests/analytics/export 5, lib/csv 4); suite 712/712, typecheck/lint/audit green, build green in a temp worktree (main tree .next locked by a running dev server)
Final review: 2 reviewers (correctness, adversarial accuracy/security), Opus. No Critical. Important: sellers/brands/categories did not reconcile with KPI revenue; zero-subtotal sales gave NULL revenue; browser cache could leak a manager report on a shared till; int4 overflow. Fixed in ONE pass (agent c8f2f10 + orchestrator 0bdc939), each test RED→GREEN; suite 723/723, typecheck/lint/audit green, build green in a temp worktree.
Final: Ruling: attribution by current catalogue, not sale-time snapshot — cost: moving a product to another brand rewrites its history in brand reports
Final: Ruling: week/month bucket labels may precede from — cost: frontend must label the first partial bucket
Final: minor (deferred): dashboard runs ~10 sequential queries (Promise.all/reuse lowStock); slow movers/ageing correlated subqueries (DISTINCT ON at scale); returns CSV exports only byReason rows; empty export has no header; late VOID restates closed periods; localDayBounds lives in analytics/range not lib/dates; schemas/movements.ts comment still says UTC; future crons/scripts must call bumpAnalyticsVersion; refund of free items (price 0) is 0
