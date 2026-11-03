# Deployment (all free tiers)

Free-tier limits change; check each provider's pricing page before relying on a number.

## 1. Accounts
- GitHub (repo), Vercel (Hobby), Neon (Free), Upstash (Free Redis), Resend (Free), optional Sentry (Free).

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
5. Build command `pnpm build`. Do NOT add `pnpm db:migrate` to the build; run migrations once before deploy (manually or from CI) — see README.
6. `vercel.json` crons (Hobby allows daily): `0 2 * * *` → `/api/v1/cron/weekly-export` (checks weekday), `0 3 * * *` → `/api/v1/cron/stock-verify`.
7. Custom domain, then submit to HSTS preload once stable.

## 5. First run
1. Open `https://<app>/setup`, enter `SETUP_TOKEN`, create the admin, store name, currency. API alternative: `POST /api/v1/setup` with `{ name, email, password, storeName, currency, setupToken }` (see README).
2. Settings → size & color presets, low-stock default, seller discount cap.
3. Create users. Install the PWA on the shop iPad/phones.

## 6. Local development
```
pnpm i
cp .env.example .env   # fill with Neon dev branch + Upstash
pnpm db:migrate && pnpm db:seed
pnpm dev
pnpm test
```

## 7. Backups
- Neon free tier keeps point-in-time history for a limited window; export weekly via the cron (`/data/export`) to Vercel Blob, and download monthly.

## 8. Staying inside free tiers
- Neon: compute scales to zero; keep queries indexed; paginate.
- Vercel Hobby: non-commercial personal use terms — review Vercel's fair-use policy for a shop deployment; if in doubt, Pro is the upgrade path with no code change.
- Upstash: rate-limit calls are tiny; well under free limits.
- Resend: only password reset/invite mails.
