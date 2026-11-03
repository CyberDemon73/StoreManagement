# Sprint 0 — Foundation & Security Baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An empty but secure Next.js app with a Postgres schema, Argon2id auth, DB-backed sessions, role permissions, rate limits, CSRF and security headers, fully tested without external services.

**Architecture:** Thin Next.js 15 route handlers under `src/app/api/v1` call services in `src/services` that take a Drizzle `Db` and a request context. Runtime DB is Neon (`drizzle-orm/neon-serverless` Pool, so interactive transactions work for Sprint 2); tests run the same migrations on an in-process PGlite. Cross-cutting concerns live in `src/lib`: `withAuth` (session + permission), `parse` (Zod strict), error envelope, rate limiting with in-memory fallback, audit writer, and a middleware for headers/CSRF.

**Tech Stack:** Next.js 15.5, TypeScript strict, Tailwind, pnpm, Drizzle ORM 0.45 + drizzle-kit, `@neondatabase/serverless`, `@electric-sql/pglite` (tests), Zod 4, `@node-rs/argon2`, `@upstash/ratelimit` + `@upstash/redis`, pino, Resend, Vitest.

**Spec:** `CLAUDE.md`, `docs/SPRINTS.md` (Sprint 0), `docs/SECURITY.md`, `docs/API-SPEC.md` (Auth & setup), `docs/ACCESS-MATRIX.md`, `docs/DATA-MODEL.md` (auth + system).

## Global Constraints

- Next.js **15.x** (docs say 15; 16 exists — stay on 15). `src/` dir, App Router, TS `strict: true`, alias `@/*` → `src/*`, pnpm.
- Money integer minor units; timestamps `timestamptz` UTC; ids `uuid default gen_random_uuid()`.
- Every route handler wrapped in `withAuth(...)`; `permission` required unless `public: true` (type-level).
- Every Zod schema `.strict()`; unknown keys → 400 `VALIDATION`.
- Error envelope `{ error: { code, message, fields?, retryAfter? } }`; status map: VALIDATION 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409, LOCKED 423, RATE_LIMITED 429, INSUFFICIENT_STOCK 409, INTERNAL 500. No stack traces or SQL to clients.
- Argon2id: memoryCost 65536 KiB, timeCost 3, parallelism 1. Password min 10, max 128, reject top-10k common list. Dummy hash on unknown email.
- Session cookie `__Host-as_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`. Raw token 32 random bytes base64url; **SHA-256 hex stored**. Idle 12 h sliding (touch at most once / 5 min), absolute 30 d. `Max-Age` only when `remember: true`. Rotate on login; revoke all on password reset.
- Lockout: 10 failures per email within 15 min → locked 15 min → `423 LOCKED` with `retryAfter` seconds. Rate limits: login 5/min/IP, 10/h/email; forgot 3/h/email; general 120/min/user. In-memory limiter when `UPSTASH_REDIS_REST_URL` is unset.
- `POST /setup` only when `users` is empty **and** body `setupToken === process.env.SETUP_TOKEN`.
- CSRF: non-GET/HEAD/OPTIONS to `/api/*` must have `Origin` (fallback `Referer`) whose origin equals `APP_URL` origin **and** header `X-Requested-With: AvenueStock`; else 403 envelope.
- Headers (from `docs/SECURITY.md`): HSTS `max-age=63072000; includeSubDomains; preload`, CSP with per-request nonce (dev adds `'unsafe-eval'` to script-src), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), geolocation=(), microphone=()`, `Cross-Origin-Opener-Policy: same-origin`, `X-Request-Id` on every response.
- Sellers never receive `costPrice`, `defaultCost`, `unitCost`, `margin*`, `profit*` (no such fields this sprint; keep serializers folder in place).
- Logs: pino, never tokens/passwords/auth bodies. Named exports only (except Next pages/routes/middleware/config).
- Conventional commits, one per task.

## Review Focus

1. Malformed or non-JSON body on a JSON route → 400 `VALIDATION`, never 500. (Task 2 test.)
2. Login with email in different case than stored → succeeds; lockout counter keyed case-insensitively. (Task 12 tests.)
3. Tampered, expired, or unknown session cookie → 401, no DB error leak. (Task 7 tests.)
4. Reset token used twice → second attempt 400 and old sessions stay revoked. (Task 13 test.)
5. Request to `/api/*` mutation with correct `Origin` but missing `X-Requested-With` → 403. (Task 9 test.)

---

## File structure

```
package.json, pnpm-lock.yaml, next.config.ts, tsconfig.json, eslint.config.mjs, postcss.config.mjs,
vitest.config.ts, drizzle.config.ts, .env.example, .gitignore, README.md
drizzle/                         # 0000_extensions.sql (custom), 0001_*.sql (generated), meta/
src/
  middleware.ts                  # headers, nonce, request id, CSRF
  app/layout.tsx, app/page.tsx, app/globals.css
  app/api/v1/health/route.ts
  app/api/v1/setup/route.ts
  app/api/v1/auth/{login,logout,me,forgot,reset}/route.ts
  app/api/v1/audit/route.ts      # minimal manager-only list (full version Sprint 5)
  db/columns.ts                  # citext custom type
  db/schema/auth.ts  db/schema/system.ts  db/schema/index.ts
  db/client.ts                   # getDb(), setDb() (tests), Db type
  db/migrate.ts  db/seed.ts
  lib/env.ts  lib/logger.ts  lib/errors.ts  lib/http.ts  lib/validate.ts
  lib/permissions.ts  lib/password.ts  lib/common-passwords.json
  lib/ratelimit.ts  lib/auth.ts  lib/audit.ts  lib/email.ts  lib/route-manifest.ts
  schemas/auth.ts  schemas/common.ts
  services/auth.ts  services/lockout.ts  services/audit.ts
  serializers/user.ts  serializers/settings.ts  serializers/seller.ts
tests/
  setup.ts  helpers/{db,http,users}.ts
  lib/*.test.ts  auth/*.test.ts  authz/matrix.test.ts  security/middleware.test.ts  health.test.ts
```

Shared types (defined once, used everywhere):

```ts
// src/lib/permissions.ts
export type Role = 'ADMIN' | 'MANAGER' | 'SELLER';
export type Permission = /* 25 keys from ACCESS-MATRIX */;
// src/lib/auth.ts
export interface AuthUser { id: string; name: string; email: string; role: Role; status: 'ACTIVE'|'DISABLED'; mustChangePassword: boolean; sessionId: string }
export interface ReqCtx { ip: string | null; userAgent: string | null; requestId: string }
// src/db/client.ts
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
```

---

### Task 1: Scaffold project and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `src/app/{layout.tsx,page.tsx,globals.css}`, `vitest.config.ts`, `tests/smoke.test.ts`
- Modify: `.gitignore` (merge create-next-app entries with existing), `.env.example` (keep ours)

**Interfaces:**
- Produces: scripts `dev build start lint typecheck test test:watch db:generate db:migrate db:seed stock:verify`; alias `@/*`.

- [x] **Step 1: Enable pnpm and scaffold into a temp dir**

Run (in scratchpad dir): `corepack enable pnpm && pnpm dlx create-next-app@15 avenue-tmp --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack --yes`
Then copy everything except `README.md` and `.gitignore` from `avenue-tmp` into the project root; append new `.gitignore` lines not already present.

- [x] **Step 2: Install dependencies**

Run: `pnpm add drizzle-orm @neondatabase/serverless zod @node-rs/argon2 @upstash/ratelimit @upstash/redis pino resend ws` and `pnpm add -D drizzle-kit @electric-sql/pglite vitest @vitest/coverage-v8 tsx dotenv pino-pretty @types/ws`
Expected: `pnpm-lock.yaml` updated, no peer errors.

- [x] **Step 3: Configure TypeScript strict and scripts**

`tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `resolveJsonModule: true`, `paths: {"@/*": ["./src/*"]}`.
`package.json` scripts: `typecheck: tsc --noEmit`, `test: vitest run`, `test:watch: vitest`, `db:generate: drizzle-kit generate`, `db:migrate: tsx src/db/migrate.ts`, `db:seed: tsx src/db/seed.ts`, `stock:verify: echo "stock:verify arrives in Sprint 2"` (placeholder, exits 0).
`vitest.config.ts`: `environment: 'node'`, `setupFiles: ['tests/setup.ts']`, `alias { '@': './src' }`, `include: ['tests/**/*.test.ts']`, `testTimeout: 20000`.

- [x] **Step 4: Write the smoke test**

`tests/smoke.test.ts`: `it('runs', () => expect(1 + 1).toBe(2))`. `tests/setup.ts`: empty for now (grows in Task 4).

- [x] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all exit 0; vitest `1 passed`.

- [x] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js 15 app with strict TS, Tailwind, Vitest, Drizzle deps"
```

---

### Task 2: Errors, HTTP helpers, env, logger, Zod parse

**Files:**
- Create: `src/lib/errors.ts`, `src/lib/http.ts`, `src/lib/env.ts`, `src/lib/logger.ts`, `src/lib/validate.ts`, `src/schemas/common.ts`
- Test: `tests/lib/errors.test.ts`, `tests/lib/validate.test.ts`

**Interfaces:**
- Produces:
  - `type ErrorCode = 'VALIDATION'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'RATE_LIMITED'|'LOCKED'|'INSUFFICIENT_STOCK'|'INTERNAL'`
  - `class AppError extends Error { code; status; fields?: Record<string,string>; retryAfter?: number; constructor(code, message, opts?: { fields?, retryAfter? }) }`
  - `STATUS_BY_CODE: Record<ErrorCode, number>`
  - `json(data: unknown, status = 200, headers?: HeadersInit): Response`; `noContent(headers?): Response` (204)
  - `errorResponse(err: unknown, requestId?: string): Response` — AppError → envelope + status (+ `Retry-After` header when `retryAfter`); ZodError → 400 VALIDATION with `fields`; anything else → 500 `{ code:'INTERNAL', message:'Internal error' }` and `logger.error`.
  - `getClientIp(req: Request): string | null` (first of `x-forwarded-for`, else `x-real-ip`); `getUserAgent(req): string | null` (max 512 chars)
  - `parse<T>(schema: ZodType<T>, source: Request | URLSearchParams | unknown): Promise<T>` — Request: reject `content-length > 1_048_576` with AppError VALIDATION (status 413 via `opts.status`), parse JSON (invalid JSON → VALIDATION "Invalid JSON body"), `schema.parse`; URLSearchParams → object of strings; throws AppError VALIDATION with `fields` = `{ [issue.path.join('.') || '_']: issue.message }`.
  - `getEnv(): Env` (Zod-validated once, cached; `resetEnvForTests()`), fields: `DATABASE_URL?`, `DATABASE_URL_UNPOOLED?`, `UPSTASH_REDIS_REST_URL?`, `UPSTASH_REDIS_REST_TOKEN?`, `RESEND_API_KEY?`, `EMAIL_FROM` (default `Avenue Stock <no-reply@localhost>`), `APP_URL` (url, default `http://localhost:3000`), `SESSION_SECRET?`, `SETUP_TOKEN?`, `CRON_SECRET?`, `NODE_ENV`, `LOG_LEVEL` (default `info`).
  - `logger` (pino; level from env; `redact: ['password','token','*.password','*.token','req.headers.cookie']`).
  - `src/schemas/common.ts`: `uuidSchema = z.string().uuid()`, `emailSchema = z.string().trim().toLowerCase().email().max(254)`, `paginationQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict()`.

- [x] **Step 1: Write failing tests**

`tests/lib/errors.test.ts`:
- `AppError('LOCKED', 'x', { retryAfter: 30 })` → `errorResponse` status 423, header `Retry-After: 30`, body `error.code === 'LOCKED'`, `error.retryAfter === 30`.
- `errorResponse(new Error('boom'))` → 500, body `{ error: { code: 'INTERNAL', message: 'Internal error' } }`, body has no `stack`.
- `errorResponse(zodError)` → 400 with `fields`.

`tests/lib/validate.test.ts` with `const s = z.object({ a: z.string() }).strict()`:
- extra key `{a:'x', b:1}` → throws AppError VALIDATION, `fields.b` defined.
- invalid JSON body `'{'` → VALIDATION, message `Invalid JSON body`.
- `content-length` 2,000,000 → AppError with status 413.
- URLSearchParams `?page=2` against `paginationQuery` → `{ page: 2, pageSize: 25 }`.

- [x] **Step 2: Run to verify fail**

Run: `pnpm test tests/lib`  Expected: FAIL (modules not found).

- [x] **Step 3: Implement the five lib files and `schemas/common.ts` per Interfaces**

- [x] **Step 4: Run tests**

Run: `pnpm test tests/lib`  Expected: PASS.

- [x] **Step 5: Commit** `feat(lib): error envelope, http helpers, env, logger, zod parse`

---

### Task 3: Permission map

**Files:**
- Create: `src/lib/permissions.ts`
- Test: `tests/lib/permissions.test.ts`

**Interfaces:**
- Produces: `Role`, `Permission` (exactly the 25 keys in `docs/ACCESS-MATRIX.md`), `ROLES: readonly Role[]`, `ALL_PERMISSIONS: readonly Permission[]`, `PERMISSIONS: Record<Role, ReadonlySet<Permission>>`, `can(user: { role: Role }, permission: Permission): boolean`, `permissionsFor(role: Role): Permission[]`.

- [x] **Step 1: Failing test** — asserts: ADMIN has all 25; MANAGER has all except `data.export.all`; SELLER has exactly `products.read, catalog.read, stock.read, stock.count.read, sales.create, sales.read, returns.create`; `can({role:'SELLER'}, 'analytics.read') === false`; `ALL_PERMISSIONS.length === 25`.
- [x] **Step 2: Run** `pnpm test permissions` → FAIL.
- [x] **Step 3: Implement** (SELLER's `own` rows count as having the permission; ownership is enforced in services).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(auth): permission map from access matrix`

---

### Task 4: Schema v1, migrations, DB client, test DB

**Files:**
- Create: `drizzle.config.ts`, `src/db/columns.ts`, `src/db/schema/auth.ts`, `src/db/schema/system.ts`, `src/db/schema/index.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/db/seed.ts`, `drizzle/0000_extensions.sql` (custom), `drizzle/0001_*.sql` (generated), `tests/helpers/db.ts`
- Modify: `tests/setup.ts`, `docs/DATA-MODEL.md` (add `failed_logins.email` as pk, `settings.id` check)
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces (tables, camelCase TS ↔ snake_case SQL):
  - `roleEnum('ADMIN','MANAGER','SELLER')`, `userStatusEnum('ACTIVE','DISABLED')`, `tokenPurposeEnum('RESET','INVITE')`
  - `users`: id, name, email `citext` unique, passwordHash, role, status default ACTIVE, mustChangePassword default false, lastLoginAt, createdAt default now, updatedAt default now
  - `sessions`: id **text pk = sha256 hex of raw token**, userId fk cascade, userAgent, ip `inet`, createdAt, lastSeenAt, expiresAt, idleExpiresAt; index(userId)
  - `passwordResetTokens`: id uuid, userId fk cascade, tokenHash unique, purpose, expiresAt, usedAt, createdAt
  - `failedLogins`: email citext **pk**, ip inet, count int default 0, lockedUntil, updatedAt
  - `settings`: id integer pk default 1 with `check(id = 1)`, storeName default 'Avenue Stock', logoUrl, phone, address, currency char(3) default 'EGP', timezone default 'Africa/Cairo', lowStockDefault 3, saleNumberPrefix 'AS', sellerDiscountCapPct numeric(5,2) default 10, allowNegativeStock false, receiptHeader, receiptFooter, sizePresets jsonb default `[]`, colorPresets jsonb default `[]`, sessionIdleHours 12, sessionAbsoluteDays 30, updatedAt
  - `auditLog`: id, userId fk set null, action, entity, entityId uuid null, before jsonb, after jsonb, ip inet, userAgent, createdAt; indexes (createdAt desc), (entity, entityId), (userId)
  - `src/db/client.ts`: `type Db`, `getDb(): Db` (lazy Pool from `DATABASE_URL`, `neonConfig.webSocketConstructor = ws`), `setDb(db: Db | null)` for tests.
  - `tests/helpers/db.ts`: `createTestDb(): Promise<{ db: Db; close(): Promise<void> }>` (PGlite with `citext` + `pg_trgm` extensions, `migrate(db, { migrationsFolder: 'drizzle' })`), `truncateAll(db)`.
  - `tests/setup.ts`: sets `process.env` (`NODE_ENV=test`, `APP_URL=http://localhost:3000`, `SETUP_TOKEN=test-setup-token`, `SESSION_SECRET=...`), `beforeAll` creates test db + `setDb`, `beforeEach` `truncateAll`, `afterAll` close. Exports nothing; tests call `getDb()`.

- [x] **Step 1: Update `docs/DATA-MODEL.md`** (two lines noted above). Run `/db-migration` conventions.
- [x] **Step 2: Failing test** `tests/db/schema.test.ts`: after setup, `select` from `users`, `sessions`, `password_reset_tokens`, `failed_logins`, `settings`, `audit_log` each returns `[]`; inserting `a@x.com` then `A@X.COM` into users throws unique violation (citext); `settings` insert with id 2 throws check violation.
- [x] **Step 3: Run** → FAIL.
- [x] **Step 4: Write schema files + `drizzle.config.ts`** (`dialect: 'postgresql'`, `schema: './src/db/schema/index.ts'`, `out: './drizzle'`, `dbCredentials.url = DATABASE_URL_UNPOOLED ?? DATABASE_URL`, `casing: 'snake_case'`).
- [x] **Step 5: Generate migrations**: `pnpm drizzle-kit generate --custom --name=extensions` → edit SQL to `CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;`; then `pnpm db:generate` → read the generated SQL fully (no DROPs; enums created; check constraint present).
- [x] **Step 6: Write `client.ts`, `migrate.ts` (neon-serverless migrator on `DATABASE_URL_UNPOOLED`, loads `.env` via dotenv), `seed.ts` (idempotent: insert settings row id=1 if missing), test helpers, setup.**
- [x] **Step 7: Run** `pnpm test tests/db` → PASS. Also `pnpm typecheck`.
- [x] **Step 8: Commit** `chore(db): schema v1 (users, sessions, reset tokens, failed logins, settings, audit) + migrations`

---

### Task 5: Password hashing and common-password check

**Files:**
- Create: `src/lib/password.ts`, `src/lib/common-passwords.json`, `src/schemas/auth.ts` (passwordSchema only for now)
- Test: `tests/lib/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(pw: string): Promise<string>` (argon2id, m=65536, t=3, p=1), `verifyPassword(hash: string, pw: string): Promise<boolean>`, `getDummyHash(): Promise<string>` (cached hash of a random string), `isCommonPassword(pw: string): boolean` (case-insensitive, Set of 10k), `passwordSchema = z.string().min(10).max(128).refine(p => !isCommonPassword(p), { message: 'Password is too common' })`.
- Common list: SecLists `10-million-password-list-top-10000.txt` (MIT) converted to a JSON array; fetch via `curl` from `https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10-million-password-list-top-10000.txt`.

- [x] **Step 1: Failing test**: hash starts with `$argon2id$` and contains `m=65536,t=3,p=1`; verify true/false; `isCommonPassword('password123')` true, `'Zq9!vt-plume-orbit'` false; `passwordSchema.safeParse('123456789')` fails (<10), `'password1234'` fails (common), 129-char fails.
- [x] **Step 2: Run** → FAIL. **Step 3: Fetch list, write files.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(auth): argon2id hashing and common-password rejection`

---

### Task 6: Rate limiter with in-memory fallback

**Files:**
- Create: `src/lib/ratelimit.ts`
- Test: `tests/lib/ratelimit.test.ts`

**Interfaces:**
- Produces: `interface Limiter { limit(key: string): Promise<{ success: boolean; remaining: number; reset: number }> }` (reset = epoch ms); `createLimiter(name: string, tokens: number, windowMs: number): Limiter` (Upstash sliding window when env has both Upstash vars, else in-memory sliding window keyed `${name}:${key}`); `enforce(limiter: Limiter, key: string): Promise<void>` throws `AppError('RATE_LIMITED', 'Too many requests', { retryAfter: ceil((reset-now)/1000) })`; exported singletons `loginIpLimiter` (5, 60_000), `loginEmailLimiter` (10, 3_600_000), `forgotEmailLimiter` (3, 3_600_000), `apiUserLimiter` (120, 60_000); `resetMemoryLimiters()`.

- [x] **Step 1: Failing test**: `createLimiter('t', 2, 1000)`: 3rd call `success === false`; `enforce` throws RATE_LIMITED with `retryAfter >= 1`; keys isolated; after `vi.useFakeTimers` + advance 1001 ms, succeeds again.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(security): rate limiter (Upstash or in-memory)`

---

### Task 7: Sessions, cookie, withAuth

**Files:**
- Create: `src/lib/auth.ts`, `src/serializers/user.ts`, `src/serializers/seller.ts`, `tests/helpers/users.ts`, `tests/helpers/http.ts`
- Test: `tests/lib/auth.test.ts`

**Interfaces:**
- Produces (`src/lib/auth.ts`):
  - `SESSION_COOKIE = '__Host-as_session'`, `generateToken(): string`, `hashToken(raw: string): string`
  - `createSession(db, { userId, ip, userAgent, remember }): Promise<{ raw: string; expiresAt: Date; remember: boolean }>` — idle = now + `settings.sessionIdleHours` (fallback 12), absolute = now + `settings.sessionAbsoluteDays` (fallback 30).
  - `getSessionUser(db, req: Request): Promise<AuthUser | null>` — cookie → hash → join users; null if missing/expired (either expiry)/user DISABLED; slides idle expiry and `lastSeenAt` when `lastSeenAt` older than 5 min.
  - `revokeSession(db, sessionId)`, `revokeAllSessions(db, userId)`
  - `sessionCookieHeader(raw, { remember, expiresAt }): string` → `__Host-as_session=<raw>; Path=/; HttpOnly; Secure; SameSite=Lax` + `; Max-Age=<secs>` only if remember. `clearSessionCookieHeader(): string` (Max-Age=0).
  - `requirePermission(user: AuthUser, permission: Permission): void` throws FORBIDDEN.
  - `withAuth(opts: { permission: Permission } | { auth: true } | { public: true }, handler: (req: Request, ctx: HandlerCtx) => Promise<Response>): RouteHandler` where `HandlerCtx = { user: AuthUser | null; params: Record<string,string>; req: ReqCtx; db: Db }` and `RouteHandler = (req: Request, ctx?: { params: Promise<Record<string,string>> }) => Promise<Response>`. Behaviour (`auth: true` = any authenticated user, no permission check): builds `ReqCtx` (`requestId` from `x-request-id` header or new uuid); non-public: no user → 401 UNAUTHENTICATED; `!can` → 403; `enforce(apiUserLimiter, user.id)`; catches everything → `errorResponse(err, requestId)`; sets `X-Request-Id` on every response.
- `src/serializers/user.ts`: `PublicUser` and `toPublicUser(row): PublicUser` = `{ id, name, email, role, status, mustChangePassword, lastLoginAt, createdAt }` (never `passwordHash`).
- `src/serializers/seller.ts`: `FORBIDDEN_SELLER_KEYS = ['costPrice','defaultCost','unitCost','margin','marginPct','profit','stockValueCost','cogs']`, `stripCostFields<T>(value: T): T` deep.
- `tests/helpers/users.ts`: `createUser(db, { role, email?, password?, name?, status? }): Promise<{ id, email, password }>` (default password `Correct-Horse-Battery-9`), `sessionCookieFor(db, userId): Promise<string>` (creates session, returns `Cookie` header value).
- `tests/helpers/http.ts`: `call(handler: RouteHandler, opts: { method?, path?, body?, cookie?, headers?, params? }): Promise<Response>` — builds `Request` at `http://localhost:3000<path>` with `Origin: http://localhost:3000`, `X-Requested-With: AvenueStock`, JSON body; `readCookie(res, name): string | null` from `set-cookie`.

- [x] **Step 1: Failing tests** (`tests/lib/auth.test.ts`):
  - `createSession` stores `hashToken(raw)` as `sessions.id`, never the raw value.
  - `getSessionUser` returns user for valid cookie; null for random token; null when `expiresAt` set in the past; null when `idleExpiresAt` in the past; null when user `DISABLED`.
  - cookie header string matches `/^__Host-as_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/` when `remember:false`, includes `Max-Age=` when true.
  - `withAuth({ permission: 'analytics.read' })`: no cookie → 401 envelope; SELLER → 403; MANAGER → 200; response has `X-Request-Id`; handler throwing `new Error('x')` → 500 INTERNAL.
  - `withAuth({ public: true })` → 200 with no cookie.
  - `stripCostFields({ a: { costPrice: 1, items: [{ profit: 2, name: 'n' }] } })` → no forbidden keys at any depth.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `pnpm typecheck`.
- [x] **Step 5: Commit** `feat(auth): DB sessions, __Host- cookie, withAuth and permission guard`

---

### Task 8: Audit writer

**Files:**
- Create: `src/lib/audit.ts`
- Test: `tests/lib/audit.test.ts`

**Interfaces:**
- Produces: `audit(db, actor: { userId: string | null; ip?: string | null; userAgent?: string | null }, action: string, entity: string, entityId: string | null, before: unknown, after: unknown): Promise<void>` — inserts into `audit_log`; `before`/`after` pass through `redactSecrets()` which deletes keys `passwordHash`, `password`, `token`, `tokenHash` at any depth.

- [x] **Step 1: Failing test**: row inserted with action/entity; `after: { passwordHash: 'x', name: 'n' }` stored without `passwordHash`; `userId` null allowed.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(audit): audit log writer with secret redaction`

---

### Task 9: Middleware — security headers, nonce, request id, CSRF

**Files:**
- Create: `src/middleware.ts`, `src/lib/security-headers.ts`
- Test: `tests/security/middleware.test.ts`

**Interfaces:**
- Produces: `buildCsp(nonce: string, isDev: boolean): string` (exact policy from `docs/SECURITY.md`, `script-src 'self' 'nonce-<n>'` + `'unsafe-eval'` only when `isDev`); `SECURITY_HEADERS: Record<string,string>` (HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy, COOP); `isCsrfSafe(req: NextRequest, appOrigin: string): boolean` (GET/HEAD/OPTIONS → true; else Origin or Referer origin must equal `appOrigin` **and** `x-requested-with === 'AvenueStock'`); `middleware(req: NextRequest): NextResponse` (default export required by Next) with `config.matcher = ['/((?!_next/static|_next/image|favicon.ico|icons/).*)']`. Request id: incoming `x-request-id` (≤ 64 chars, `[A-Za-z0-9-]`) else `crypto.randomUUID()`; forwarded as request header and set on response. Nonce forwarded as `x-nonce` request header and CSP set on both request and response. CSRF failure for `/api/` paths → `NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Cross-site request blocked' } }, { status: 403 })`.

- [x] **Step 1: Failing tests**: GET `/` response has all 7 header names with exact values (CSP contains `nonce-`, `frame-ancestors 'none'`); `X-Request-Id` present and echoed when supplied; POST `/api/v1/auth/login` with `Origin: https://evil.example` → 403 envelope; correct Origin but no `X-Requested-With` → 403; both correct → passes (`NextResponse.next`, status 200); GET with foreign origin passes.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `pnpm build` still green (middleware must stay edge-compatible: no pino/db imports).
- [x] **Step 5: Commit** `feat(security): headers, CSP nonce, request id and CSRF origin check in middleware`

---

### Task 10: Route manifest, authz matrix harness, `GET /health`

**Files:**
- Create: `src/lib/route-manifest.ts`, `src/app/api/v1/health/route.ts`
- Test: `tests/authz/matrix.test.ts`, `tests/health.test.ts`

**Interfaces:**
- Produces: `interface RouteSpec { method: 'GET'|'POST'|'PATCH'|'DELETE'; path: string; access: 'public' | 'auth' | Permission; load: () => Promise<Record<string, RouteHandler>>; sampleBody?: unknown }`; `ROUTES: RouteSpec[]`. Matrix test: for each route × role (plus anonymous): anonymous on non-public → 401; role lacking permission → 403; role with permission or `auth` → status not in {401, 403}; public → not 401/403. Routes added later must be registered or the test does not cover them — test also asserts `ROUTES.length` equals the number of `route.ts` files found by globbing `src/app/api/v1/**/route.ts` × exported methods.
- `GET /health`: `withAuth({ public: true })`, runs `select 1`, returns `{ ok: true, db: 'up' }` or `{ ok: false, db: 'down' }` with 503.

- [x] **Step 1: Failing tests** (health 200 + body; matrix skeleton runs over `ROUTES` — initially only health).
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(api): health route and authz matrix test harness`

---

### Task 11: `POST /setup`

**Files:**
- Create: `src/services/auth.ts` (setup), `src/services/settings.ts` (`getSettings(db)`, `ensureSettings(db, patch)`), `src/serializers/settings.ts`, `src/app/api/v1/setup/route.ts`
- Modify: `src/schemas/auth.ts` (add `setupBody`), `src/lib/route-manifest.ts`
- Test: `tests/auth/setup.test.ts`

**Interfaces:**
- `setupBody = z.object({ name: z.string().trim().min(1).max(100), email: emailSchema, password: passwordSchema, storeName: z.string().trim().min(1).max(100), currency: z.string().trim().toUpperCase().length(3), setupToken: z.string().min(1) }).strict()`
- `setup(db, input: SetupInput, ctx: ReqCtx): Promise<{ user: PublicUser; session: { raw; expiresAt; remember: true } }>` — in a transaction: `FORBIDDEN` if `getEnv().SETUP_TOKEN` unset or mismatched; `CONFLICT 'Setup already completed'` if any user exists; insert ADMIN; upsert settings (`storeName`, `currency`); audit `setup.complete` entity `user`; create session.
- Route: `withAuth({ public: true })` → `parse` → `setup` → `json({ user }, 201, { 'Set-Cookie': sessionCookieHeader(...) })`.
- `toPublicSettings(row)`: `{ storeName, logoUrl, phone, address, currency, timezone, lowStockDefault, saleNumberPrefix, sellerDiscountCapPct (number), sizePresets, colorPresets, receiptHeader, receiptFooter }`.

- [x] **Step 1: Failing tests**: valid body → 201, `user.role === 'ADMIN'`, no `passwordHash` key, `Set-Cookie` has `__Host-as_session`, settings row has `storeName`; second call → 409; wrong token → 403; extra field → 400; weak password → 400 with `fields.password`.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement + register in manifest** (`access: 'public'`, `sampleBody`). **Step 4: Run** → PASS (matrix test included).
- [x] **Step 5: Commit** `feat(auth): POST /setup creates first admin and settings`

---

### Task 12: Login (with lockout + rate limits), logout, me

**Files:**
- Create: `src/services/lockout.ts`, `src/app/api/v1/auth/login/route.ts`, `src/app/api/v1/auth/logout/route.ts`, `src/app/api/v1/auth/me/route.ts`
- Modify: `src/services/auth.ts` (login, logout, me), `src/schemas/auth.ts` (`loginBody`), `src/lib/route-manifest.ts`
- Test: `tests/auth/login.test.ts`, `tests/auth/session.test.ts`

**Interfaces:**
- `loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(128), remember: z.boolean().optional().default(false) }).strict()`
- `services/lockout.ts`: `LOCKOUT_THRESHOLD = 10`, `LOCKOUT_WINDOW_MS = 15*60_000`; `getLockRemaining(db, email): Promise<number>` (seconds, 0 if not locked); `recordFailure(db, email, ip): Promise<void>` (upsert; if `updatedAt` older than window → count = 1 else count+1; when count ≥ threshold set `lockedUntil = now + window`); `clearFailures(db, email)`.
- `login(db, input, ctx, currentSessionId?: string): Promise<{ user: PublicUser; session }>` — order: `enforce(loginIpLimiter, ip ?? 'unknown')`, `enforce(loginEmailLimiter, email)`, lock check → `AppError('LOCKED','Account temporarily locked',{ retryAfter })`, fetch user, `verifyPassword(user?.passwordHash ?? await getDummyHash(), password)`; on fail `recordFailure` + `UNAUTHENTICATED 'Invalid email or password'`; DISABLED after correct password → `FORBIDDEN 'Account disabled'`; success → `clearFailures`, set `lastLoginAt`, revoke `currentSessionId` if present (rotation), `createSession`, audit `auth.login`.
- `logout(db, user: AuthUser, ctx)`: `revokeSession(db, user.sessionId)`, audit `auth.logout`.
- `me(db, user)`: `{ user: toPublicUser, permissions: permissionsFor(role), settingsPublic: toPublicSettings(await getSettings(db)) }`.
- Routes: login `withAuth({ public: true })` (reads existing cookie for rotation) → 200 `{ user }` + Set-Cookie; logout and me use `withAuth({ auth: true })`. Logout → 204 + clear cookie.

- [x] **Step 1: Failing tests** `tests/auth/login.test.ts`:
  - correct creds → 200, `user.email`, cookie set; `remember:true` → `Max-Age` present, false → absent.
  - email `MIXED@Case.com` logs in user stored as `mixed@case.com`.
  - wrong password and unknown email → both 401 with identical body.
  - 10 wrong passwords → 11th attempt (even correct) → 423 with `retryAfter > 0` and `Retry-After` header; `failed_logins` row count 10.
  - lockout counter: failures with `Foo@X.com` and `foo@x.com` share a row.
  - login IP limiter: 6th login from same IP within a minute → 429 (use distinct emails).
  - login with an existing valid cookie issues a new token and the old session row is deleted (rotation).
  - DISABLED user with correct password → 403.
  `tests/auth/session.test.ts`: `GET /auth/me` without cookie 401; with cookie → `{ user, permissions, settingsPublic }` and SELLER `permissions` does not include `analytics.read`; `POST /auth/logout` → 204, cookie cleared, subsequent `/auth/me` 401.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement + register routes** (`login: public`, `logout: auth`, `me: auth`). **Step 4: Run** full `pnpm test` → PASS.
- [x] **Step 5: Commit** `feat(auth): login with lockout and rate limits, logout, me`

---

### Task 13: Forgot / reset password + email

**Files:**
- Create: `src/lib/email.ts`, `src/app/api/v1/auth/forgot/route.ts`, `src/app/api/v1/auth/reset/route.ts`
- Modify: `src/services/auth.ts` (forgot, reset), `src/schemas/auth.ts` (`forgotBody`, `resetBody`), `src/lib/route-manifest.ts`
- Test: `tests/auth/forgot-reset.test.ts`

**Interfaces:**
- `src/lib/email.ts`: `sendEmail({ to, subject, text }): Promise<void>` — Resend when `RESEND_API_KEY` set, else `logger.info({ to, subject }, 'email (dev)')`; `setEmailTransportForTests(fn | null)` capturing `{ to, subject, text }`.
- `forgotBody = z.object({ email: emailSchema }).strict()`; `resetBody = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict()`.
- `forgot(db, { email }, ctx)`: `enforce(forgotEmailLimiter, email)`; if ACTIVE user: raw token = `generateToken()`, insert `{ tokenHash: hashToken(raw), purpose: 'RESET', expiresAt: now+30min }`, `sendEmail` with link `${APP_URL}/reset?token=${raw}`, audit `auth.forgot`. Always resolves.
- `reset(db, { token, password }, ctx)`: lookup by hash with `purpose='RESET'`, `usedAt null`, `expiresAt > now` else `VALIDATION 'Invalid or expired token'`; transaction: update `passwordHash`, `mustChangePassword=false`, set `usedAt`, `revokeAllSessions`; audit `user.password_reset`.
- Routes: both `public`; forgot → 204 always; reset → 204.

- [x] **Step 1: Failing tests**: forgot for existing user → 204 and captured email `text` contains `/reset?token=`; forgot unknown email → 204 and no email; 4th forgot within an hour → 429; reset with captured token → 204, old session cookie now 401, login with new password 200; reusing token → 400; expired token (update `expiresAt` to past) → 400; reset with common password → 400.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement + register.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(auth): forgot/reset password with single-use tokens`

---

### Task 14: `GET /audit` (manager-only) — seller 403 proof

**Files:**
- Create: `src/services/audit.ts` (`listAudit(db, { page, pageSize })` → `{ data, page, pageSize, total }` newest first), `src/app/api/v1/audit/route.ts`
- Modify: `src/lib/route-manifest.ts`
- Test: `tests/audit/list.test.ts`

- [x] **Step 1: Failing tests**: MANAGER → 200 with `data[]` containing earlier `auth.login` entry; SELLER → 403 `FORBIDDEN`; anonymous → 401; `?pageSize=500` → 400.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement** with `withAuth({ permission: 'audit.read' })` and `paginationQuery`. **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(audit): GET /audit minimal list (manager-only)`

---

### Task 15: Docs, decisions, checkboxes, build, security review

**Files:**
- Modify: `README.md` (local + Vercel steps, env var table), `docs/DECISIONS.md`, `docs/SPRINTS.md` (tick Sprint 0 boxes that have passing tests), `docs/API-SPEC.md` (note `setupToken`, `retryAfter`), `.env.example` (verify vs `grep -rhoE "process\.env\.[A-Z_]+" src | sort -u`)

- [x] **Step 1: DECISIONS.md entries**: neon-serverless Pool instead of HTTP (transactions); Next 15 pinned although 16 exists; PGlite for tests; lockout in `failed_logins` table; in-memory limiter fallback; `setupToken` in body; `retryAfter` field in envelope for 423/429; `/health` and minimal `/audit` pulled forward; `GET /audit` as the manager-only route for the Sprint 0 "done when".
- [x] **Step 2: README** — local run, test, migrate; Vercel: env list `DATABASE_URL, DATABASE_URL_UNPOOLED, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, RESEND_API_KEY, EMAIL_FROM, APP_URL, SESSION_SECRET, SETUP_TOKEN, CRON_SECRET, BLOB_READ_WRITE_TOKEN`.
- [x] **Step 3: Verify** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — paste output.
- [x] **Step 4: Tick checkboxes** in `docs/SPRINTS.md` except "Vercel project + Neon + Upstash connected, first deploy green" (needs user accounts → Deferred).
- [x] **Step 5: Commit** `docs: sprint 0 README, decisions, checklist`
- [x] **Step 6: Run `/security-review full`** and fix FAILs.

## Deferred
- First Vercel deploy (user accounts required). Steps in README.
- `pnpm stock:verify` real implementation (Sprint 2); placeholder script exits 0.
- `PATCH /me`, `POST /me/password` (Sprint 5 per SPRINTS.md).

## Outcome (2026-11-03)
All 15 tasks complete on branch `sprint-0`; final review by three reviewers (general, adversarial security, DB/deploy) found no Critical issues; every Important finding fixed test-first in one pass. Suite 139/139, typecheck/lint/build green, `pnpm audit` 0 high/critical. Deferred: first Vercel deploy (owner accounts), cleanup cron, failed-login audit events, `mustChangePassword` enforcement (Sprint 5). Rulings and deferred minors were recorded in the execution ledger and reported to the owner.
