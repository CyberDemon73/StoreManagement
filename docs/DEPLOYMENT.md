# Deployment (all free tiers)

Free-tier limits change; check each provider's pricing page before relying on a number.

## 1. Accounts
- GitHub (repo + Actions CI), Vercel (Hobby), Neon (Free), Upstash (Free Redis), Resend (Free). Sentry is not wired in (see DECISIONS); logs are pino JSON in Vercel's log view, each line carrying the `X-Request-Id` the client also receives.

## 2. Database — Neon
1. Create project `avenue-stock`, region closest to Egypt that Neon offers (e.g. EU Frankfurt).
2. Copy the **pooled** connection string → `DATABASE_URL`. Use the **direct** (unpooled) string as `DATABASE_URL_UNPOOLED` for migrations.
3. Extensions `citext` and `pg_trgm` are created by migration `0000_extensions.sql` — no manual step (Neon's default role may create them).
4. Create a `dev` branch for local work (Neon branches are free).

## 3. Redis — Upstash
Create a Redis database (region close to Vercel function region) → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

## 4. Vercel
1. Import the GitHub repo. Framework: Next.js. Root: `/`.
2. Add Vercel Blob store (Storage tab) → `BLOB_READ_WRITE_TOKEN` is injected.
3. Set env vars (Production + Preview): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `UPSTASH_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `SESSION_SECRET` (32+ random bytes, base64), `SETUP_TOKEN` (random), `APP_URL` (https://your-domain), `CRON_SECRET`.
4. Function region: pick one near Neon's region to cut latency.
5. Build command `pnpm build`. Do NOT add `pnpm db:migrate` to the build. Before each deploy that adds a file under `drizzle/`, run `DATABASE_URL_UNPOOLED=<direct url> pnpm db:migrate` from your machine (migrations are forward-only; each file has a `-- rollback:` note).
6. `CRON_SECRET`: a random string (`openssl rand -base64 32`). Vercel sends it as `Authorization: Bearer …` to the cron declared in `vercel.json`: `0 2 * * *` (UTC) → `GET /api/v1/cron/daily`. Daily it purges expired/used tokens, dead sessions (incl. sessions older than the current `sessionAbsoluteDays`), old idempotency keys, read notifications older than 90 days and old login failures. On Sundays (store timezone) it also runs the stock reconciliation (admins get a SYSTEM notification on mismatch) and writes the backup zip. Check it once: Vercel → Project → Cron Jobs → Run.
7. Health: `GET /api/v1/health` → `{ ok: true, db: 'up' }` (503 when the database is unreachable). Point an uptime monitor (e.g. UptimeRobot free) at it.
8. Custom domain: add it in Vercel → Domains, set `APP_URL` to it, redeploy. The app already sends `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. After a week without HTTPS issues on every subdomain, submit the apex at hstspreload.org (hard to undo — only if every subdomain will stay HTTPS).

## 5. First run
1. Open `https://<app>/setup`, enter `SETUP_TOKEN`, create the admin, store name, currency. API alternative: `POST /api/v1/setup` with `{ name, email, password, storeName, currency, setupToken }` (see README).
2. Settings → size & color presets, low-stock default, seller discount cap.
3. Users → invite staff (email link, 48 h) or create with a temporary password (shown once; they must change it at first login).
4. Catalogue: Products → Import CSV (columns `name, brand, category, size, color, colorHex, price, cost, qty, barcode`; brands and categories must exist first). Run the dry run, fix the listed rows, then import. Opening quantities are booked as stock movements.
5. Install the PWA: open the site over HTTPS on the shop iPad/phone → Share → Add to Home Screen (iOS) or the install prompt (Android/Chrome). The camera scanner needs HTTPS.

## 6. Local development
```
pnpm i
cp .env.example .env   # fill with Neon dev branch + Upstash
pnpm db:migrate && pnpm db:seed
pnpm dev
pnpm test
```

## 7. Backups
- Neon keeps point-in-time history for a limited window on the free tier (restore by creating a branch at a timestamp, then point `DATABASE_URL` at it).
- Weekly: the Sunday cron writes `backups/YYYY-MM-DD.zip` (one CSV per table, no password hashes or session tokens) to Vercel Blob as a **private** blob. Download it monthly from Vercel → Storage → Blob and keep a copy off Vercel.
- On demand: an ADMIN can download the same zip from `GET /api/v1/data/export`.
- Stock reconciliation can also be run by hand: `pnpm stock:verify` with `DATABASE_URL` set.

## 8. Staying inside free tiers
- Neon: compute scales to zero; keep queries indexed; paginate.
- Vercel Hobby: non-commercial personal use terms — review Vercel's fair-use policy for a shop deployment; if in doubt, Pro is the upgrade path with no code change.
- Upstash: rate-limit calls are tiny; well under free limits.
- Resend: only password reset/invite mails.

## 9. CI
GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR: lint, typecheck, tests (PGlite), `drizzle-kit check`, `pnpm audit --audit-level=high`, the secrets scan, and a real-Postgres job that races parallel sales against one variant to prove the row locks. Keep `main` protected and merge only green PRs; Vercel deploys `main` to production and every branch to a preview.

## 10. Go-live checklist
- [ ] All env vars set in Production (see `.env.example`); `SETUP_TOKEN` removed or rotated after setup.
- [ ] `pnpm db:migrate` run against production.
- [ ] `/setup` done; admin can log in; a test sale + return + void reconcile (`pnpm stock:verify`).
- [ ] Cron job ran once from the Vercel dashboard and returned 200.
- [ ] Resend domain verified so invite/reset mail is delivered.
- [ ] `/api/v1/health` monitored.
- [ ] PWA installed on the shop devices; camera scanner tested over HTTPS.
