# SDD ledger — plan: docs/plans/sprint-0.md

Pre-flight:
- T7 withAuth opts ↔ T12 consumers: union now includes { auth: true } (fixed in plan) — clean
- T4 Db type ↔ T7/T11-14 services: all take Db from src/db/client.ts — clean
- T2 AppError(retryAfter) ↔ T6 enforce / T12 lockout: same opts shape — clean
- T5 passwordSchema ↔ T11 setupBody / T13 resetBody: imported from src/schemas/auth.ts — clean
- T10 ROUTES ↔ T11-14 registration: each route task registers; matrix count assert — clean
- Ruling: execute on branch sprint-0 in place (no worktree) — fresh repo, nothing else in flight — cost if wrong: none
Task 1: Ruling: vitest pinned to ^3 (not 5) — vitest 5 needs rolldown native binding requiring Node >=22.12, machine has 22.5.1 — cost if wrong: upgrade later is a one-line bump
Task 1: complete (commits 12e5c9d..ad602bf, tests: pnpm test → [2m   Duration [22m 805ms[2m (transform 45ms, setup 20ms, collect 43ms, tests 3ms, environment 0ms, prepare 299ms)[22m)
Task 2: complete (commits ad602bf..609d08e, tests: pnpm test → [2m   Duration [22m 1.20s[2m (transform 167ms, setup 46ms, collect 811ms, tests 71ms, environment 1ms, prepare 991ms)[22m)
Task 3: complete (commits 609d08e..813ee02, tests: pnpm test → [2m   Duration [22m 1.21s[2m (transform 164ms, setup 34ms, collect 855ms, tests 82ms, environment 1ms, prepare 1.27s)[22m)
Task 4: complete (commits 813ee02..15dc8e7, tests: pnpm test → [2m   Duration [22m 4.06s[2m (transform 289ms, setup 4.26s, collect 481ms, tests 10.85s, environment 1ms, prepare 1.67s)[22m)
Task 5: Ruling: a concurrent frontend session edits this tree; backend commits stage explicit paths only and typecheck/lint gates are evaluated on backend files only (frontend WIP breaks project-wide tsc) — cost if wrong: a frontend type error could hide a backend one until final full build
Task 5: complete (commits 15dc8e7..9be149a, tests: pnpm test → [2m   Duration [22m 4.88s[2m (transform 363ms, setup 5.12s, collect 657ms, tests 14.77s, environment 1ms, prepare 2.00s)[22m)
Task 6: complete (commits 9be149a..1191588, tests: pnpm test → [2m   Duration [22m 4.97s[2m (transform 448ms, setup 6.33s, collect 913ms, tests 18.17s, environment 2ms, prepare 2.36s)[22m)
Task 7: complete (commits 1191588..b76f9cc, tests: pnpm test → [2m   Duration [22m 5.35s[2m (transform 568ms, setup 8.29s, collect 1.41s, tests 22.43s, environment 2ms, prepare 2.85s)[22m)
Task 8: complete (commits b76f9cc..835dd3b, tests: pnpm test → [2m   Duration [22m 5.92s[2m (transform 742ms, setup 9.84s, collect 1.95s, tests 28.23s, environment 2ms, prepare 3.67s)[22m)
Task 9: complete (commits 835dd3b..9667183, tests: pnpm test → [2m   Duration [22m 6.16s[2m (transform 822ms, setup 10.39s, collect 2.38s, tests 34.13s, environment 3ms, prepare 3.62s)[22m)
Task 10: complete (commits 9667183..18ddc22, tests: pnpm test → [2m   Duration [22m 8.76s[2m (transform 1.66s, setup 14.06s, collect 5.13s, tests 67.78s, environment 3ms, prepare 4.47s)[22m)
Task 11: complete (commits 18ddc22..eb69610, tests: pnpm test → [2m   Duration [22m 7.20s[2m (transform 1.13s, setup 15.62s, collect 4.25s, tests 52.19s, environment 4ms, prepare 5.36s)[22m)
Task 12: Ruling: authz matrix treats only withAuth's own 401 ('Authentication required') as a block; a public route's business 401 (bad credentials) passes — needed because sample bodies cannot log in a real user — cost if wrong: a public route that wrongly demands auth with a different message would slip the matrix
Task 12: complete (commits eb69610..e704273, tests: pnpm test → [2m   Duration [22m 10.51s[2m (transform 1.81s, setup 18.81s, collect 6.54s, tests 72.52s, environment 5ms, prepare 6.10s)[22m)
Task 13: complete (commits e704273..351bc4e, tests: pnpm test → [2m   Duration [22m 11.08s[2m (transform 2.00s, setup 22.59s, collect 8.11s, tests 80.20s, environment 5ms, prepare 7.29s)[22m)
Task 14: complete (commits 351bc4e..ccb6b35, tests: pnpm test → [2m   Duration [22m 11.37s[2m (transform 2.08s, setup 23.46s, collect 9.24s, tests 89.19s, environment 6ms, prepare 7.76s)[22m)
Task 15: complete (commits ccb6b35..707a818, tests: pnpm test → [2m   Duration [22m 11.40s[2m (transform 2.44s, setup 24.00s, collect 9.50s, tests 90.88s, environment 5ms, prepare 7.12s)[22m)
Final: fixed /health returned 500 without DATABASE_URL — "reports db down with 503" RED→GREEN; follow-up: env now set in tests/env.ts (import-order bug surfaced by the fix); suite 119/119
Final review: 3 parallel reviewers (general, adversarial security, DB/deploy). No Critical. All Important findings fixed in ONE pass, each test RED→GREEN; suite 139/139, typecheck/lint/build green, audit 0 high.
Final: fixed unvalidated client IP into inet columns (lockout bypass) — getClientIp tests + login 'garbage ip' RED→GREEN
Final: fixed /auth/forgot 500 on mail failure (enumeration oracle) — 'forgot still returns 204' RED→GREEN
Final: fixed /setup token oracle + no per-IP limit — 'answers 409 ... wrong token', 'limits setup attempts' RED→GREEN
Final: fixed reset leaving sibling tokens live — 'invalidates other outstanding reset tokens' RED→GREEN
Final: fixed DB errors logging hashes/emails — describeError test RED→GREEN
Final: fixed API responses cacheable — Cache-Control no-store test RED→GREEN
Final: fixed authz matrix regex discovery + unverified manifest access — matrix asserts handler.auth; negative check verified
Final: fixed pool without error listener, prod silent fallbacks, placeholder env values, pnpm/node pinning, doc contradictions (config agent; build verified)
Final: Ruling: loginEmailLimiter 10/h counts successful logins and can mask 423 — spec says "10/h/email" verbatim; left as is — cost if wrong: a busy shared account sees 429 instead of 423 after 10 logins/hour
Final: Ruling: "remember me" still idles out after 12 h — spec defines idle regardless of remember — cost: UX only
Final: minor (deferred): no cleanup of failed_logins / expired sessions / used tokens (Sprint 6 cron)
Final: minor (deferred): no audit event for failed logins/lockouts
Final: minor (deferred): HandlerCtx.user nullable for permission routes (type ergonomics)
Final: minor (deferred): reset token travels in query string (acceptable: 256-bit, 30 min, single-use)
Final: minor (deferred): /health 500 instead of 503 when a cookie is present and DB is down
Final: minor (deferred): lucide-react/recharts (frontend deps) landed in a backend commit via shared package.json
Final: minor (deferred): mustChangePassword carried but not enforced (Sprint 5)
