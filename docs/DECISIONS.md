# Decisions log

Format: `YYYY-MM-DD — decision — why — alternatives considered`

- 2026-11-02 — Single Next.js app for frontend + API — one Vercel deploy, no CORS, shared types — separate Hono API (rejected: two deploys, cookie domain issues)
- 2026-11-02 — Neon Postgres over Supabase — scales to zero without pausing, Vercel integration — Supabase (pauses after inactivity on free tier)
- 2026-11-02 — Money as integer minor units — no float errors — numeric(12,2) (rejected: ORM/JS float round-trips)
- 2026-11-02 — Stock quantity derived from immutable movements ledger — audit + exact COGS — direct quantity edits (rejected: no history)
- 2026-11-02 — Weighted-average cost (not FIFO) — simpler, good enough for apparel — FIFO (phase 3 if needed)
- 2026-11-02 — Admin == Manager permissions today, separate role labels — allows future split without migration
- 2026-11-02 — Superpowers plugin mandatory for sprint workflow — enforces plan-first + TDD + verification
- 2026-11-02 — Frontend lives inside this Next.js app (src/app/(app), src/screens, src/components, src/mock, src/lib/api.ts) instead of a separate frontend-handoff/ package — one typecheck/build, shared types with the API — separate Vite package (rejected: duplicate tooling, no shared types)
- 2026-11-02 — Frontend data access through a single typed client src/lib/api.ts with USE_MOCK switch and an in-memory mock store — screens never import mock data directly, so wiring real routes is a one-file change — per-screen fetch (rejected)
- 2026-11-02 — Charts with recharts, icons with lucide-react, no component framework (Tailwind v4 + own primitives) — per the design brief; shadcn-style primitives kept small
- 2026-11-02 — Drizzle via `drizzle-orm/neon-serverless` (WebSocket Pool from `@neondatabase/serverless`) instead of the neon-http adapter — HTTP driver has no interactive transactions, which Sprint 2 needs for `SELECT … FOR UPDATE` — neon-http (rejected)
- 2026-11-02 — Next.js pinned to 15.x although 16 is current — docs specify 15; upgrade is a separate decision — Next 16 (deferred)
- 2026-11-02 — Vitest 3 (not 5) — vitest 5 depends on a rolldown native binding that needs Node ≥ 22.12; dev machine runs 22.5 — vitest 5 (bump when Node is upgraded)
- 2026-11-02 — Tests run on PGlite (in-process Postgres with citext + pg_trgm) using the real `drizzle/` migrations — no Neon or Docker needed for `pnpm test`; same SQL as prod — Neon test branch (rejected: network, credentials in CI)
- 2026-11-02 — Login lockout stored in the `failed_logins` table, not Redis — works in tests, auditable, no extra dependency — Redis counter (rejected)
- 2026-11-02 — Rate limiter falls back to an in-process sliding window when Upstash env vars are unset — local dev and tests need no Redis; production must set Upstash (per-instance memory is not shared on Vercel) — hard requirement on Upstash (rejected for DX)
- 2026-11-02 — `POST /setup` takes `setupToken` in the body — matches the setup form in DEPLOYMENT.md; compared in constant time — header (rejected: no benefit)
- 2026-11-02 — Error envelope gains optional `retryAfter` (seconds) on 423/429, mirrored in a `Retry-After` header — spec asked for retryAfter on LOCKED — separate field outside `error` (rejected)
- 2026-11-02 — `GET /health` (Sprint 6) and a minimal `GET /audit` (Sprint 5) implemented in Sprint 0 — kickoff asked for health; audit is the manager-only route the Sprint 0 "done when" needs for the seller-403 check — stub route (rejected: not real)
- 2026-11-02 — Route manifest `src/lib/route-manifest.ts` + authz matrix test; a `route.ts` missing from the manifest fails the suite — makes forgetting the matrix impossible — manual list (rejected)
- 2026-11-02 — Unknown body keys reported per key as `fields.<key> = "Unknown field"` — friendlier than Zod 4 root issue — root `_` key (rejected)
- 2026-11-02 — pnpm overrides `postcss >=8.5.18` and `tinypool >=2.1.2` — clear 2 high (postcss, pinned by next 15.5) and 2 critical (tinypool, dev-only via vitest 3) advisories; suite and build verified green — ignoring via auditConfig (rejected: hides real exposure)
- 2026-11-03 — Public auth routes (/setup, /auth/forgot, /auth/reset) get a per-IP limiter 20/h in addition to per-email limits — review found token brute force and email bombing paths — none (rejected)
- 2026-11-03 — /auth/forgot sends mail via Next `after()` (inline outside a request scope) and swallows provider errors — keeps 204 timing/failure independent of account existence — synchronous send (rejected: enumeration oracle)
- 2026-11-03 — /setup answers 409 whenever a user exists, before checking the token, and serialises with pg_advisory_xact_lock — closes the post-setup token oracle and the READ COMMITTED double-admin race — none
- 2026-11-03 — Client IP accepted only if `net.isIP` validates it, else null — `inet` columns rejected junk XFF values and the failure path then skipped lockout — text columns (rejected)
- 2026-11-03 — Production env guard: with VERCEL_ENV=production, DATABASE_URL, Upstash, Resend, SETUP_TOKEN (≥16 chars) and a non-localhost APP_URL are required at startup — silent in-memory fallback is unacceptable in prod — warn-only (rejected)
- 2026-11-03 — Vercel build: Node 22.x pinned, ENABLE_EXPERIMENTAL_COREPACK=1 for pnpm 12, migrations never run in the build step — concurrent builds would race the migrator and hit the Preview DB — build-step migrate (rejected)
