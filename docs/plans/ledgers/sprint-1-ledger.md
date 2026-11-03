# SDD ledger — plan: docs/plans/sprint-1.md

Pre-flight:
- T1 tables ↔ T2 applyMovement / T5 addVariantsTx / T9 seed: column names camelCase per T1 — clean
- T3 serializers ↔ T5/T6/T7 outputs: *Out types defined once in src/serializers/catalog.ts — clean
- T5 addVariantsTx ↔ T7 addVariants: T7 wraps T5 in a transaction — clean
- T8 manifest sampleForm ↔ tests/helpers/http.ts call({form}): T8 adds both — clean
- Ruling: branch sprint-1 in place (shared tree with frontend session) — cost if wrong: none
- Ruling: execute T1–T3 inline, T4/T5-7/T8/T9 via parallel subagents; agents commit own paths only, never route-manifest.ts/API-SPEC.md (orchestrator commits those) — user asked for parallel agents — cost if wrong: transient matrix-test failures mid-flight
Task 1: complete (commits 6c36777..c8e1381, tests: pnpm -s vitest run tests/db → [2m   Duration [22m 1.99s[2m (transform 90ms, setup 925ms, collect 25ms, tests 2.15s, environment 0ms, prepare 335ms)[22m)
Task 2: complete (commits c8e1381..ba5eaba, tests: pnpm -s vitest run tests/services → [2m   Duration [22m 1.95s[2m (transform 100ms, setup 442ms, collect 36ms, tests 1.01s, environment 0ms, prepare 162ms)[22m)
Task 3: complete (commits ba5eaba..fa69902, tests: pnpm -s vitest run tests/lib/sku tests/serializers → [2m   Duration [22m 2.00s[2m (transform 112ms, setup 953ms, collect 64ms, tests 2.08s, environment 0ms, prepare 353ms)[22m)
Task 4: complete (commit 3e5eae5, tests: pnpm vitest run tests/catalog → 23 passed) — subagent; manifest entries committed by orchestrator
Task 5: complete (commit 1e0b165, tests: tests/products create+detail → 13 passed) — subagent
Task 6: complete (commit 0f46a7f, tests: tests/products/list → 8 passed) — subagent; Ruling: list built with drizzle crossJoinLateral instead of a raw CTE string — same single statement, typed rows — cost if wrong: none
Task 7: complete (commit f6b9702, tests: tests/variants → 17 passed) — subagent; Ruling: variant order = insertion order (clock_timestamp per row) so `sizes` keeps matrix order — cost: none; Ruling: lookup does not filter archived products (scannable) — cost: an archived SKU can be found by scan; sale rules enforce status in Sprint 3
Task 8: complete (commit 2be792b, tests: tests/uploads → 7 passed) — subagent; Ruling: test PNG uses compressionLevel 0 + EXIF so re-encode provably changes bytes — cost: none
Task 9: complete (commit 114738c, tests: tests/db/seed → 1 passed; 40 products / 271 variants / 256 movements) — subagent; Ruling: apparel products carry a 2–4 size run (not all 5) to land in the 200–320 variant window — cost: none
Integration: full suite 336/336, typecheck/lint green, build green from clean .next (stale .next invariant was a concurrent-build artifact), zod override ^4.6.6 clears the high advisory via @vercel/blob
Final review: 3 parallel reviewers (general, adversarial, DB/deploy). No Critical. Important findings fixed in ONE pass by 3 agents + orchestrator, each test RED→GREEN; suite 363/363, typecheck/lint/build green, audit 0 high.
Final: fixed int4 overflow 500s (money/qty/page bounds + applyMovement guard) — tests RED→GREEN (864c01a)
Final: fixed list total=0 past last page; inactive variants excluded from q; strict stock=in — RED→GREEN (864c01a)
Final: fixed catalog mutations not transactional; DB-enforced supplier/root-category uniqueness (0003); parentId null + cycle guard; seller-safe suppliers; brand variantCount semantics — RED→GREEN (5d338e1)
Final: fixed upload 5 MB vs Vercel 4.5 MB cap (4 MB + content-length precheck), 2000px resize, 25 MP guard; seed EAN-13 barcodes + ordered variants — RED→GREEN (281dffd)
Final: fixed SKU self-collision/empty-part matrices → 400; idempotent archive without audit; locked variant delete with 23503→409; seller-stripping matrix test — RED→GREEN (c57f96b)
Final: fixed brand logoUrl any scheme → https only — RED→GREEN
Final: Ruling: product `images` stay any https URL (not blob-host-only) — managers may link existing CDN images; CSP img-src limits rendering, not storage — cost: a non-blob image won't render until CSP is widened
Final: Ruling: applyMovements (sorted bulk lock) deferred to Sprint 2 plan where multi-variant transactions first appear — cost: none now
Final: minor (deferred): trigram indexes on variants.sku / products.base_sku and UNION search rewrite (scale > 10k)
Final: minor (deferred): initialQty map keys not matching a cell are ignored silently
Final: minor (deferred): archived-product SKUs still resolvable by lookup (intentional; sales enforce status in Sprint 3)
Final: minor (deferred): verifyStock as Sprint 6 cron at REPEATABLE READ
Final: minor (deferred): matrix 30×30 = 900 cells per request allowed (bounded; slow on Neon)
Final: minor (deferred): createdBy UUID exposed to sellers (harmless)
