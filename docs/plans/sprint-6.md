# Sprint 6 — Hardening, import/export, ops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD (red → green) for every service and route. Commit path-limited (`git commit -m … -- <paths>`); never `git add -A`.

**Goal:** production-ready public app: CSV import/export, admin data export, label data, crons (purges, stock verify, backup), CI, performance indexes, security extras, final deployment docs.

**Already present (verify, don't rebuild):** `GET /health` (db ping, 503 when down) + test; pino logger; `X-Request-Id` in middleware + error responses; security headers incl. HSTS preload; `public/manifest.json`, `public/sw.js` (shell cache-first, catalogue SWR, mutations network-only), `/offline` page (frontend session owns these); authz matrix test over the route manifest; seller-stripping test.

## Brainstorm rulings (answered from docs + frontend client `src/lib/api.ts`)
- Import CSV columns (header row, case-insensitive): `name, brand, category, size, color, colorHex?, price, cost?, qty?, barcode?`. Prices in major units (`1090.00`) → minor units. Rows are grouped by (name, brand) into products; each row is one variant. Brand/category must already exist (case-insensitive name) → else row error `Unknown brand` / `Unknown category`. Existing product (same name + brand) gets new variants; an existing variant (same product + size + color) → row error `Variant already exists` (no updates via import). Opening `qty` is booked through `applyMovement()`. Max 5,000 rows, max 2 MB, multipart field `file`. `?dryRun=1` → `{ rows, ok, errors: [{ row, message, data }] }` with no writes; commit → all-or-nothing: any error → 400 with the same body, nothing written; success → 201 `{ rows, ok, errors: [], created: { products, variants } }`. Audited once (`products.import`).
- `GET /products/export` (`export.csv`): same columns as import (round-trip) + `sku`, one row per active variant; `toCsv` (BOM, formula neutralisation).
- `GET /data/export` (`data.export.all`, ADMIN): zip (fflate) of one CSV per business table. Excluded: `sessions`, `password_reset_tokens`, `idempotency_keys`, `login_failures`, `known_devices`; `users.password_hash` dropped. Audited.
- `GET /labels?variantIds=a,b` (`products.write`): ≤ 200 uuids, returns `VariantWithProduct[]` in request order (unknown ids omitted), no cost fields.
- Crons: one `GET /api/v1/cron/daily` (Bearer `CRON_SECRET`, timing-safe; 401 otherwise), registered in `vercel.json` `0 2 * * *`. Daily: purge expired/used tokens (> 7 d), expired + revoked sessions, sessions older than the current `sessionAbsoluteDays` (Sprint 5 deferral), idempotency keys > 48 h, read notifications > 90 d, old login failures. Sundays (store tz): `stock:verify` reconciliation → on mismatch notify ADMINs (new kind `SYSTEM`, migration 0010); weekly backup = data export uploaded to Vercel Blob with `access: "private"` (supported by @vercel/blob 2.8; never public) under `backups/YYYY-MM-DD.zip`, skipped cleanly when BLOB_READ_WRITE_TOKEN is unset.
- Sentry: not added (optional in SPRINTS; pino + request id suffice on free tier) — DECISIONS.
- Service-worker data cache can hold a manager's catalogue JSON (with cost) on a shared till after logout → frontend session asked to clear the data cache on logout/login (their file).

## Tasks

### Task A: Import / export / labels (agent)
Files: `src/services/product-import.ts`, `src/services/product-export.ts`, `src/services/labels.ts`, `src/schemas/import.ts`, routes `src/app/api/v1/products/import/route.ts`, `products/export/route.ts`, `labels/route.ts`, tests `tests/products/import.test.ts`, `tests/products/export.test.ts`, `tests/labels/labels.test.ts`. Tests first: dry-run errors (unknown brand, bad price, duplicate variant, > 5000 rows → 400, non-CSV/oversize → 400), commit all-or-nothing, qty booked as ledger movement (`stock:verify` holds), round-trip export → import dry-run of a fresh DB shape, formula neutralisation, seller 403 on all three, labels order/omission/no cost. Do NOT edit `route-manifest.ts` (orchestrator registers).
- [ ] RED → GREEN → commit `feat(products): CSV import with dry-run, CSV export, label data`

### Task B: Data export + daily cron (agent)
Files: `src/services/data-export.ts`, `src/services/maintenance.ts` (purges, absolute-session cut, weekly verify + backup), `src/lib/cron.ts` (secret check), routes `src/app/api/v1/data/export/route.ts`, `src/app/api/v1/cron/daily/route.ts`, `vercel.json`, `src/db/schema/system.ts` (+ `SYSTEM` notification kind) + migration 0010, `src/lib/env.ts` + `.env.example` (`CRON_SECRET`), refactor `src/db/verify-stock.ts` to call a shared `verifyStock(db)`. Tests: zip contains expected CSVs and no password_hash/session table; MANAGER 403 on /data/export; cron 401 without/with wrong secret; each purge rule (row kept vs purged at the boundary); session older than absoluteDays revoked; Sunday mismatch → one SYSTEM notification per admin; backup skipped cleanly when blob unsupported/unconfigured.
- [ ] RED → GREEN → commit `feat(ops): admin data export, daily maintenance cron (purges, stock verify, backup) (0010)`

### Task C: Security, performance, CI (agent)
Files: `tests/security/fuzz.test.ts` (SQL-injection/odd-input fuzz on every `q`/search param: `'`, `%`, `_`, `\`, `--`, unicode, 1000 chars → 200 or 400, never 500, no extra rows), `tests/security/uploads.test.ts` additions only if sniffing gaps exist, `scripts/scan-secrets.mjs` (+ `pnpm secrets:scan`), `scripts/seed-big.ts` (10k sales, 2k variants on PGlite or DATABASE_URL), `tests/perf/explain.test.ts` (EXPLAIN on products list, low stock, dashboard facts → no Seq Scan on sales/sale_items/stock_movements at 10k rows; skipped unless `PERF=1`), `.github/workflows/ci.yml` (pnpm, lint, typecheck, test, `drizzle-kit check`, `pnpm audit --audit-level=high`, secrets scan; postgres service job running `tests/concurrency/*.pg.test.ts` with `DATABASE_URL_TEST`), `tests/concurrency/oversell.pg.test.ts` (20 parallel sales on qty 5 → exactly 5 succeed, ledger consistent; skipped without `DATABASE_URL_TEST`). Index changes: edit schema files only and report; orchestrator generates the migration after Task B (avoid two 0010s). `package.json` scripts only.
- [ ] RED → GREEN → commit `test(security): input fuzz, secrets scan, perf explain, CI with real-Postgres race test`

### Task D: Integration + docs (orchestrator)
Register routes in `src/lib/route-manifest.ts` + ACCESS-MATRIX rows; index migration; API-SPEC rows (import/export/labels/data export/cron); DEPLOYMENT.md finalised (cron, CRON_SECRET, migrations from CI, backups, HSTS preload checklist, PWA install); DECISIONS; SPRINTS ticks; full gates + worktree build; `/security-review full`; review + fix pass.
- [ ] Done

## Deferred
- Custom domain + HSTS preload submission: needs the user's domain/Vercel account (header already sent).
- PWA install verification on a phone over HTTPS: user.
