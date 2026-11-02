# Decisions log

Format: `YYYY-MM-DD — decision — why — alternatives considered`

- 2026-11-02 — Single Next.js app for frontend + API — one Vercel deploy, no CORS, shared types — separate Hono API (rejected: two deploys, cookie domain issues)
- 2026-11-02 — Neon Postgres over Supabase — scales to zero without pausing, Vercel integration — Supabase (pauses after inactivity on free tier)
- 2026-11-02 — Money as integer minor units — no float errors — numeric(12,2) (rejected: ORM/JS float round-trips)
- 2026-11-02 — Stock quantity derived from immutable movements ledger — audit + exact COGS — direct quantity edits (rejected: no history)
- 2026-11-02 — Weighted-average cost (not FIFO) — simpler, good enough for apparel — FIFO (phase 3 if needed)
- 2026-11-02 — Admin == Manager permissions today, separate role labels — allows future split without migration
- 2026-11-02 — Superpowers plugin mandatory for sprint workflow — enforces plan-first + TDD + verification
