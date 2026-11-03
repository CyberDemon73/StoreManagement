# Avenue Stock

Inventory, sales and reporting for a single retail store with sized/colored products. Next.js 15 + Drizzle + Neon Postgres, deployed on Vercel. Installable PWA for phone, iPad and desktop. Roles: Admin, Manager, Seller.

## Quick start (local)
Requirements: Node 22, pnpm 12 (`npm i -g pnpm@12`), a Neon project (free tier). Upstash and Resend are optional locally: without them the app uses an in-memory rate limiter and logs emails instead of sending them.

```bash
pnpm install
cp .env.example .env        # fill DATABASE_URL, DATABASE_URL_UNPOOLED, SETUP_TOKEN
pnpm db:migrate             # applies drizzle/*.sql to DATABASE_URL_UNPOOLED
pnpm db:seed                # creates the settings row (catalogue seed arrives in Sprint 1)
pnpm dev                    # http://localhost:3000
pnpm test                   # Vitest against an in-process Postgres (PGlite) — no DB needed
```

First run: `POST /api/v1/setup` with `{ name, email, password, storeName, currency, setupToken }` where `setupToken` equals `SETUP_TOKEN`. It works only while the `users` table is empty and returns the admin session cookie.

Every API mutation must send `Origin` (browser does) and the header `X-Requested-With: AvenueStock`, or the middleware answers 403.

```bash
curl -i -X POST http://localhost:3000/api/v1/setup \
  -H 'content-type: application/json' -H 'origin: http://localhost:3000' -H 'x-requested-with: AvenueStock' \
  -d '{"name":"Owner","email":"owner@example.com","password":"Zq9!vt-plume-orbit","storeName":"Avenue","currency":"EGP","setupToken":"<SETUP_TOKEN>"}'
```

## Scripts
| Script | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server / production build / serve build |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | `tsc --noEmit` / ESLint / Vitest |
| `pnpm db:generate` | Generate a migration from `src/db/schema/*` (drizzle-kit) |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL_UNPOOLED` |
| `pnpm db:seed` | Idempotent seed |
| `pnpm stock:verify` | Ledger reconciliation (placeholder until Sprint 2) |

## Deploy to Vercel
1. **Neon:** create a project. Extensions (`citext`, `pg_trgm`) are created by migration `0000_extensions.sql`; Neon's default role may create them. Copy the pooled string as `DATABASE_URL` and the direct string as `DATABASE_URL_UNPOOLED`.
2. **Upstash:** create a Redis database; copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. **Resend:** create an API key and a verified sender; set `RESEND_API_KEY` and `EMAIL_FROM`.
4. **Vercel:** import the repo (framework Next.js, root `/`, build `pnpm build`). In Project Settings select Node.js 22, and set `ENABLE_EXPERIMENTAL_COREPACK=1` in the Vercel env so the pnpm 12 pinned in `packageManager` is used. Add the environment variables below for Production and Preview (use a separate Neon branch for Preview). `APP_URL` must be set per environment: Preview deployments need their own `APP_URL` (or a fixed preview domain), otherwise every mutation is rejected with 403 by the CSRF origin check. Function region: closest to Neon.
5. Run migrations against production once before the first deploy: `DATABASE_URL_UNPOOLED=<prod direct url> pnpm db:migrate`. Migrations are NOT run in the Vercel build: run `pnpm db:migrate` manually or from CI before each deploy that ships a migration. A build-step migration would race between concurrent builds and would target whatever database the Preview environment points to.
6. Deploy, then open `https://<app>/setup` (or call `POST /api/v1/setup`) with `SETUP_TOKEN` to create the admin.

### Environment variables (set in Vercel)
| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled connection (runtime) |
| `DATABASE_URL_UNPOOLED` | yes | Neon direct connection (migrations) |
| `APP_URL` | yes | Public origin, e.g. `https://stock.example.com`; used for the CSRF origin check and email links |
| `SETUP_TOKEN` | yes | One-time token (≥16 chars, `openssl rand -hex 16`) required by `POST /setup` |
| `SESSION_SECRET` | no (reserved, not used yet) | 32+ random bytes base64 (`openssl rand -base64 32`); reserved for signed non-session cookies |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | prod yes | Distributed rate limits. Unset → in-memory limiter (per instance; fine for local dev only) |
| `RESEND_API_KEY` / `EMAIL_FROM` | prod yes | Password reset emails. Unset → emails are logged, not sent |
| `CRON_SECRET` | later | Bearer token for Vercel Cron routes (Sprint 6) |
| `BLOB_READ_WRITE_TOKEN` | prod yes (Sprint 1) | Product image uploads via Vercel Blob (injected when the store is linked). Unset locally → uploads return 500 "Storage not configured" |
| `LOG_LEVEL` | no | pino level, default `info` |

See `docs/DEPLOYMENT.md` for the free-tier walkthrough.

## Working with Claude Code
1. Install Superpowers once: see `docs/SUPERPOWERS.md`.
2. Open Claude Code in this folder. It reads `CLAUDE.md` automatically.
3. Run sprints: `/sprint 0`, `/sprint 1`, … (checklists in `docs/SPRINTS.md`).
4. Other skills: `/api-endpoint`, `/db-migration`, `/analytics-query`, `/security-review`.

## Docs
| File | Purpose |
|---|---|
| `CLAUDE.md` | Rules and workflow for Claude Code |
| `docs/DATA-MODEL.md` | Tables, invariants, derived rules |
| `docs/API-SPEC.md` | Every endpoint, body, response, permission |
| `docs/ACCESS-MATRIX.md` | Roles × permissions × pages |
| `docs/SECURITY.md` | Hardening requirements |
| `docs/SPRINTS.md` | Backend sprint checklists |
| `docs/DEPLOYMENT.md` | Free-tier setup on Vercel/Neon/Upstash/Resend |
| `docs/SUPERPOWERS.md` | Engineering workflow plugin |
| `docs/DECISIONS.md` | Running log of decisions |
| `docs/plans/` | Superpowers plans per sprint |

## Frontend
Designed with Claude Design (prompt in `starter-kit/01-FRONTEND-PROMPT-CLAUDE-DESIGN.md`) and built inside this app under `src/app/(app)`, `src/components`, `src/screens` with a typed client in `src/lib/api.ts` (see `docs/plans/frontend.md`).
