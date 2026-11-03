# Avenue Stock — Backend Sprint Plan

Stack: **Next.js 15 App Router (Route Handlers) · TypeScript · Drizzle ORM · Neon Postgres · Zod · Argon2id · Upstash Redis (rate limit) · Vercel Blob (images) · Resend (email) · Vitest**.
One repo, one Vercel project. Every sprint ends deployable.

Each sprint: ~1 Claude Code session of focused work. Run `/sprint N` (skill included in `repo/.claude/skills/sprint`) to load that sprint's checklist.

---

## Sprint 0 — Foundation & security baseline
**Goal:** empty but secure app deployed on Vercel with a database, auth and roles.

- [x] `create-next-app` (TS, App Router, Tailwind, ESLint), `src/` layout, strict TS, path aliases.
- [x] Drizzle + Neon: `drizzle.config.ts`, `src/db/schema/*.ts`, `src/db/client.ts` (neon-serverless WebSocket Pool; see DECISIONS), migration scripts `db:generate / db:migrate / db:seed`.
- [x] Schema v1: `users`, `sessions`, `password_reset_tokens`, `settings`, `audit_log`.
- [x] Auth: Argon2id hashing; `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/forgot`, `POST /auth/reset`, `POST /setup` (only when `users` is empty).
- [x] Session cookie: httpOnly, Secure, SameSite=Lax, `__Host-` prefix, 12 h idle / 30 d absolute, rotate on login, DB-backed, revoke all.
- [x] `withAuth(handler, { roles, permission })` wrapper + `requirePermission()` helper; permission map from `docs/ACCESS-MATRIX.md`.
- [x] Zod validation helper `parse(schema, req)` with `strict()` schemas; uniform error envelope `{ error: { code, message, fields } }`.
- [x] Rate limiting (Upstash): login 5/min/IP, 10/h/email; general 120/min/user; lockout after 10 failures for 15 min (`failed_logins` table or Redis).
- [x] CSRF: Origin/Referer check for non-GET in middleware.
- [x] Security headers in `next.config.ts` / middleware: CSP (self + blob + fonts), HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, X-Content-Type-Options.
- [x] Audit log writer `audit(user, action, entity, before, after)`.
- [ ] `.env.example`, README deploy steps, Vercel project + Neon + Upstash connected, first deploy green. _(.env.example + README done; Vercel/Neon/Upstash accounts + first deploy need the owner — see README "Deploy to Vercel")_
- [x] Tests: auth happy path, lockout, role guard (Vitest + supertest-style fetch against route handlers).

**Done when:** you can run setup, log in as admin, hit `/auth/me`, get 403 as seller on a manager route, and see headers in `curl -I`.

---

## Sprint 1 — Catalogue: products, variants, brands, categories
**Goal:** full CRUD + search/filter/pagination.

- [ ] Schema: `brands`, `categories`, `products`, `variants` (+ indexes: `products(name)`, trigram index on `products.name`, `variants(sku) unique`, `variants(barcode) unique nullable`, `variants(product_id)`).
- [ ] Money as `integer` minor units everywhere; `currency` from settings.
- [ ] `GET /products` with `q` (name / baseSku / barcode / brand via ILIKE + trigram), filters (brand, category, size, color, stock in/low/out, price range, status), sort whitelist, pagination (max pageSize 100). Response includes aggregated `totalQty`, `variantCount`, `minPrice/maxPrice`.
- [ ] `POST /products`, `GET /products/:id` (with variants), `PATCH /products/:id`, `POST /products/:id/archive` (soft).
- [ ] `POST /products/:id/variants` bulk create from `sizes[] × colors[]` with SKU generator `BASE-SIZE-COLOR` and optional initial qty (creates `INITIAL` movements — depends on Sprint 2 ledger; stub as direct insert until then).
- [ ] `PATCH /variants/:id` (price, cost, threshold, barcode; **never quantity**), `DELETE /variants/:id` (only if qty 0 and no movements).
- [ ] `GET /variants/lookup?barcode=|sku=`.
- [ ] Brands / Categories / Suppliers CRUD with product counts; archive instead of delete when referenced.
- [ ] Seller response serializer strips `costPrice`, `defaultCost`, margin.
- [ ] Image upload: `POST /uploads` → Vercel Blob (type/size validated, max 5 MB, images only), returns URL.
- [ ] Seed script: 3 brands, 6 categories, 40 products, ~250 variants.
- [ ] Tests: filters, pagination bounds, seller stripping, unique SKU.

---

## Sprint 2 — Stock ledger: movements, purchases, adjustments
**Goal:** quantity is derived from an immutable ledger; cost tracking is correct.

- [ ] Schema: `stock_movements`, `purchases`, `purchase_items`, `stock_counts`, `stock_count_items`.
- [ ] `applyMovement(tx, { variantId, type, qtyDelta, unitCost, reference, reason, userId })` — single function all stock changes go through; updates `variants.quantity` **inside the same transaction** with `SELECT … FOR UPDATE`; rejects negative result unless `settings.allowNegativeStock`.
- [ ] Weighted-average cost: on PURCHASE, `newCost = (oldQty*oldCost + inQty*inCost) / (oldQty+inQty)`; store on variant; movement keeps the incoming cost.
- [ ] `POST /stock/purchases` (lines → PURCHASE movements), `GET /stock/purchases`, `GET /stock/purchases/:id`.
- [ ] `POST /stock/adjustments` (single or bulk; reason enum required).
- [ ] `GET /stock/movements` filterable, paginated, joined with variant/product/user.
- [ ] `GET /stock/low` (qty ≤ threshold) and out-of-stock.
- [ ] Stock count: `POST /stock/counts` (start), `PATCH /stock/counts/:id` (upsert counted items), `GET` variance, `POST /stock/counts/:id/apply` (ADJUSTMENT movements, locks the count).
- [ ] Replace Sprint 1 stub: initial quantities now create INITIAL movements.
- [ ] Reconciliation job `pnpm stock:verify` compares Σ movements vs `variants.quantity`.
- [ ] Tests: concurrency (two sales racing for the last unit), negative stock rejection, average-cost math.

---

## Sprint 3 — Sales, returns, receipts
**Goal:** POS backend that is atomic and auditable.

- [ ] Schema: `sales`, `sale_items`, `returns`, `return_items`, `sale_counters`.
- [ ] `POST /sales`: validate items, lock variants, check stock, snapshot `unitPrice` + `unitCost` per line, compute totals server-side (ignore client totals), enforce seller discount cap from settings, allocate sale number `AS-000001` atomically, create SALE movements, write audit — all in one transaction. Idempotency key header to avoid double-charge on retry.
- [ ] `GET /sales` (filters: date, seller, payment, status; sellers see only their own), `GET /sales/:id`.
- [ ] `POST /sales/:id/void` (manager; reverses movements; status VOID).
- [ ] `POST /sales/:id/returns` (partial allowed; restock flag per line creates RETURN movements; sale status updates; refund recorded).
- [ ] `GET /sales/:id/receipt` → JSON + printable HTML (and a `?format=pdf` via `@react-pdf/renderer` or HTML print — keep simple).
- [ ] Park/hold sales: `POST /sales/parked`, `GET`, `DELETE` (per user, max 3, TTL 24 h).
- [ ] Tests: totals computed server-side, discount cap, double-submit idempotency, void restores stock, partial return math.

---

## Sprint 4 — Analytics
**Goal:** every report in the spec, fast enough on the free tier.

- [ ] SQL-first analytics in `src/analytics/*.ts` (Drizzle `sql` templates), all accept `{ from, to, tz }`.
- [ ] `GET /analytics/dashboard` — KPIs (total cash + by method, gross profit, margin %, COGS, units in stock, SKUs in stock, stock value cost/retail, sales count, avg basket, low/out counts). Combine into ≤ 4 queries.
- [ ] `GET /analytics/sales-trend?interval=day|week|month` (revenue, profit, count; fill empty buckets).
- [ ] `GET /analytics/brands`, `/categories` (stock units, stock value, revenue, profit).
- [ ] `GET /analytics/top-products?by=units|revenue&limit`, `/top-variants`.
- [ ] `GET /analytics/slow-movers?days=` (no sales in N days, qty > 0, value tied up).
- [ ] `GET /analytics/size-color` (qty on hand matrix).
- [ ] `GET /analytics/sellers`, `/returns`, `/payment-mix`, `/stock-ageing`, `/price-list`.
- [ ] `GET /analytics/export?report=` → CSV stream.
- [ ] Caching: 60-s `Cache-Control: private, max-age=60` + Upstash memo keyed by report+range; invalidate on sale/purchase/adjust.
- [ ] Indexes: `sales(created_at)`, `sale_items(variant_id)`, `stock_movements(variant_id, created_at)`.
- [ ] Tests: profit = Σ(price−cost)·qty − refunds; brand split sums equal totals.

---

## Sprint 5 — Users, settings, audit, notifications
**Goal:** overall management.

- [ ] `GET/POST /users`, `PATCH /users/:id` (role, name), `POST /users/:id/disable|enable`, `POST /users/:id/reset-password` (sets must-change flag or emails link), `POST /users/:id/revoke-sessions`.
- [ ] Prevent disabling the last ADMIN; prevent self-demotion of last admin.
- [ ] Invite flow email (Resend) with 48-h token.
- [ ] `GET/PATCH /settings` (validated; size & color presets; seller discount cap; low stock default; prefixes).
- [ ] `GET /audit` searchable + paginated.
- [ ] Notifications table + `GET /notifications`, `POST /notifications/:id/read`; producers: low stock on sale/adjust, refund > threshold, login from new device (UA/IP hash).
- [ ] Profile: `PATCH /me`, `POST /me/password`.
- [ ] Tests: last-admin guard, settings validation, notification producers.

---

## Sprint 6 — Hardening, PWA support, import/export, ops
**Goal:** production-ready public app.

- [ ] `POST /products/import` CSV (multipart, streamed, dry-run mode returns row errors), `GET /products/export`, `GET /data/export` (all tables zip, admin only).
- [ ] Barcode label data endpoint `GET /labels?variantIds=` (frontend renders).
- [ ] PWA: `manifest.json`, service worker (next-pwa or Serwist): cache shell + `GET /products` stale-while-revalidate; API mutations network-only; `/offline` route.
- [ ] Health check `GET /health` (db ping), structured logging (pino), request id header, error reporting (Sentry free tier optional).
- [ ] Security pass with `/security-review` skill: dependency audit, headers test, authz test matrix (every route × every role), SQL injection fuzz on `q`, upload type sniffing, secrets scan.
- [ ] Performance: `EXPLAIN ANALYZE` on products list + dashboard; add missing indexes; connection reuse.
- [ ] CI (GitHub Actions): lint, typecheck, test, `drizzle-kit check`, `pnpm audit --audit-level=high`.
- [ ] Backups: Neon branch/point-in-time note + weekly `data/export` scheduled via Vercel Cron (Hobby allows daily crons).
- [ ] DEPLOYMENT.md finalized; custom domain + HSTS preload.

---

## Phase-2 backlog (post-MVP, separate sprints)
- Offline queued sales (client queue + `POST /sales/batch` with per-item idempotency).
- TOTP 2FA for admins.
- Arabic/RTL i18n.
- Customer records & phone-based lookup; WhatsApp receipt links.
- Scheduled email reports (daily summary to owner).
- Multi-branch (`branch_id` on variants quantities → `stock_levels` table).
