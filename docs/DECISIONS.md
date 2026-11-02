# Decisions log

Format: `YYYY-MM-DD — decision — why — alternatives considered`

- 2026-11-02 — Single Next.js app for frontend + API — one Vercel deploy, no CORS, shared types — separate Hono API (rejected: two deploys, cookie domain issues)
- 2026-11-02 — Neon Postgres over Supabase — scales to zero without pausing, Vercel integration — Supabase (pauses after inactivity on free tier)
- 2026-11-02 — Money as integer minor units — no float errors — numeric(12,2) (rejected: ORM/JS float round-trips)
- 2026-11-02 — Stock quantity derived from immutable movements ledger — audit + exact COGS — direct quantity edits (rejected: no history)
- 2026-11-02 — Weighted-average cost (not FIFO) — simpler, good enough for apparel — FIFO (phase 3 if needed)
- 2026-11-02 — Admin == Manager permissions today, separate role labels — allows future split without migration
- 2026-11-02 — Superpowers plugin mandatory for sprint workflow — enforces plan-first + TDD + verification
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
