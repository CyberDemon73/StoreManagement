# Security requirements

The app is public on the internet. Treat every request as hostile until authenticated and authorised.

## Authentication
- Passwords: Argon2id via `@node-rs/argon2` (memory 64 MiB, iterations 3, parallelism 1). Min length 10, max 128, no composition rules. Reject the top-10k common passwords (bundled list).
- Sessions: random 32 bytes, **store SHA-256 hash** in `sessions`, raw token only in the cookie. Cookie `__Host-as_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`. Idle expiry 12 h (sliding, update `last_seen_at` at most once per 5 min), absolute 30 d ("remember") or browser-session otherwise. Rotate token on login and on password change; revoke all on password change / user disable / role change.
- Login flow: constant-time compare; same error message for unknown email and wrong password; always run the hash even for unknown users (dummy hash) to prevent timing enumeration.
- Lockout: 10 failures per email in 15 min → locked 15 min (`423 LOCKED` with `retryAfter`). Rate limit login 5/min/IP and 10/h/email; `/auth/forgot` 3/h/email, always returns 204.
- No self-registration. `POST /setup` only when `users` is empty, guarded by a `SETUP_TOKEN` env var as well.
- Password reset / invite tokens: 32 random bytes, hash stored, 30 min (reset) / 48 h (invite), single use.

## Authorisation
- Every route handler is wrapped in `withAuth({ permission })`. A route without a permission does not compile (type-level: `permission` is required unless `public: true`).
- Ownership (`own`) enforced in services using `session.userId`.
- Seller field stripping is a serializer, tested with a deep key scan.
- Tests: `tests/authz/matrix.test.ts` iterates every route × role from a generated route list and asserts 401/403/2xx as expected. Adding a route without updating the matrix fails the test.

## Input
- Zod `.strict()` on body, query and params. Coerce numbers from query. Max body 1 MB (uploads 4 MB on their route only (Vercel caps request bodies at 4.5 MB)).
- Search `q`: trim, max 100 chars; passed to parameterised ILIKE only.
- IDs are UUIDs; validate format before hitting the DB.
- Uploads: accept `image/jpeg|png|webp` by **magic bytes** (not extension/MIME header), ≤ 4 MB (Vercel request bodies are capped at 4.5 MB), re-encode via `sharp` (fit within 2000 px, reject > 25 MP) to strip metadata, random filename.
- CSV import: parse streaming, max 5,000 rows, cells sanitised against formula injection (`=`, `+`, `-`, `@` prefixes quoted) on export.

## Transport & headers (middleware)
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: https://*.public.blob.vercel-storage.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'nonce-<per-request>'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(), microphone=()
Cross-Origin-Opener-Policy: same-origin
```
- CSRF: for any non-GET, require `Origin` (or `Referer`) host === app host; reject otherwise (403). Plus SameSite=Lax cookie. Custom `X-Requested-With: AvenueStock` header required on API mutations as belt-and-braces.
- Request id header `X-Request-Id` on every response; included in logs.

## Data integrity
- All stock-affecting operations run in a single DB transaction with `SELECT … FOR UPDATE` on affected variant rows (sorted by id to avoid deadlocks).
- Server-side totals; client totals ignored.
- Idempotency keys on `POST /sales` and `POST /stock/purchases` (stored 24 h).
- `stock:verify` reconciliation runs in CI against the seed DB and weekly via Vercel Cron in prod (reports via notification).

## Secrets & ops
- Secrets only in Vercel env (Production/Preview separated). `.env.example` committed with placeholders.
- `SESSION_SECRET` (for cookie signing of non-session cookies), `DATABASE_URL`, `UPSTASH_REDIS_REST_URL/TOKEN`, `BLOB_READ_WRITE_TOKEN`, `RESEND_API_KEY`, `SETUP_TOKEN`, `APP_URL`, `CRON_SECRET`.
- Cron endpoints require `Authorization: Bearer ${CRON_SECRET}`.
- Logs: pino, no PII beyond user id; never log tokens, passwords, bodies of auth routes.
- Errors to client are generic; details go to logs (and Sentry if enabled).
- `pnpm audit --audit-level=high` in CI; Dependabot weekly.
- Audit log on every mutation with before/after diff and actor; immutable (no UPDATE/DELETE grants in app role if using a separate DB role).

## Checklist for `/security-review`
See `.claude/skills/security-review/SKILL.md` — it enumerates the above as pass/fail checks with commands.

## Threat-model notes — Sprint 0 (2026-11-02)
- **In-memory rate limiter fallback.** When Upstash env vars are unset the limiter is per-process. On Vercel that means per-instance, so production **must** set `UPSTASH_REDIS_REST_URL/TOKEN`; the login lockout is DB-backed and does not depend on this.
- **Lockout is per email, not per IP.** An attacker can lock a known account out for 15 minutes by sending 10 bad passwords (per-IP 5/min limit slows this). Accepted for now; mitigation candidate: CAPTCHA or per-IP+email lockout (Sprint 6).
- **Setup token.** `POST /setup` is public but refuses unless `users` is empty **and** `setupToken` matches `SETUP_TOKEN` (constant-time compare). Rotate `SETUP_TOKEN` after first run.
- **CSP nonce + inline theme script.** Middleware issues a per-request nonce (`x-nonce`); the root layout applies it to its one inline script. Dev builds add `'unsafe-eval'` for HMR only.
- **Health endpoint** is public and reveals only `{ ok, db }`.
- **Session cookie on localhost.** `__Host-` requires `Secure`; Chrome/Firefox accept Secure cookies on `http://localhost`, Safari does not — use Chrome locally or an https tunnel.
