# Avenue Stock — Frontend handoff

The frontend lives inside this Next.js 15 app and runs today entirely on a typed mock client. This document says where everything is, how each screen maps to the API in `docs/API-SPEC.md`, and exactly what to change when the real routes land.

Design source: the Claude Design canvas "Avenue Stock Frontend" (42 artboards). Tokens, component names and copy follow it.

## Run it

```bash
pnpm i
pnpm dev            # http://localhost:3000/login
```

Demo sign-in (mock): any password of 10+ characters.

| Email | Role | Notes |
|---|---|---|
| omar@avenue.eg | Admin | owner |
| salma@avenue.eg | Manager | |
| nour@avenue.eg | Seller + Manager | shows the role switcher |
| karim@avenue.eg | Seller (invited) | cannot sign in yet |
| hana@avenue.eg | Seller (disabled) | shows the disabled error |
| locked@avenue.eg | — | shows the lock-out error |
| ratelimited@avenue.eg | — | shows the rate-limit error |

## Folder structure

```
src/
  app/
    globals.css               design tokens (light + dark) mapped into Tailwind v4 @theme, base styles, print rules
    layout.tsx                Inter font, metadata, manifest, theme bootstrap, <Providers>
    (auth)/                   public pages: login, forgot, reset, set-password, setup
    (app)/                    authenticated pages, one thin page.tsx per route (renders a screen)
      layout.tsx              session redirect → AppShell → route→permission guard (403)
    not-found.tsx, session-expired/
  screens/<area>/<Name>Screen.tsx   one component per screen; header comment = route · roles · endpoints
  components/ui/              primitives (Button, Field, Badge, Card, States, Overlay, Controls, DataTable, Toast)
  components/app/             AppShell (Sidebar/IconRail/BottomTabBar/TopBar), PageHeader, GlobalSearch,
                              Notifications, VariantMatrix, Receipt + LabelCard, Charts (recharts, lazy),
                              BarcodeScanner, SystemBanners (Offline, ViewingAs, InstallPwa, UpdateAvailable),
                              RequirePermission, ServiceWorker, Providers
  lib/
    api.ts                    THE data boundary: typed client, USE_MOCK switch, seller field stripping, ApiError
    use-api.ts                useApi / useMutation / useOnline / useBreakpoint / useDebounced / useLocalStorage
    auth-context.tsx          session, acting role, View-as-seller, role switcher, can(permission)
    theme-context.tsx         light / dark / system
    nav.ts                    nav sections per role, route → permission map (from docs/ACCESS-MATRIX.md)
    format.ts                 formatMoney (minor units), dates, labels, date-range presets, stockStatus
    permissions.ts            (backend-owned) PERMISSIONS per role — reused as-is
  mock/
    data.ts                   seeded dataset: 3 brands, 6 categories, 40 products, ~290 variants, 120+ sales
                              over 60 days, full movements ledger (Σ movements == quantity), users, settings
    store.ts                  in-memory "backend": sales reduce stock, purchases update average cost, etc.
  types.ts                    shared types mirroring docs/DATA-MODEL.md and API-SPEC response shapes
public/
  manifest.json, sw.js, icons/   PWA
docs/plans/frontend.md, frontend-conventions.md
```

## Routes → screens → endpoints → roles

| Route | Screen | Endpoints (docs/API-SPEC.md) | Roles |
|---|---|---|---|
| /login, /forgot, /reset, /set-password, /setup | screens/auth/* | POST /auth/login · /auth/forgot · /auth/reset · /setup | public |
| /dashboard | dashboard/DashboardScreen | GET /analytics/dashboard | Admin, Manager |
| /analytics?tab= | analytics/AnalyticsScreen | GET /analytics/sales-trend, /payment-mix, /top-products, /categories, /size-color, /slow-movers, /brands, /sellers, /returns, /export | Admin, Manager |
| /products | products/ProductsListScreen | GET /products (+filters, sort, page) · GET /brands · /categories · POST /products/:id/archive | all (sellers: no cost/margin) |
| /products/:id | products/ProductDetailScreen | GET /products/:id · PATCH /variants/:id · POST /stock/adjustments · POST /products/:id/variants · GET /stock/movements?productId · GET /sales?productId | all (adjust/cost: managers) |
| /products/new, /products/:id/edit | products/ProductEditScreen | POST /products · PATCH /products/:id · GET /settings (presets) · GET /brands · /categories | Admin, Manager |
| /labels?variantIds= | products/LabelsScreen | GET /labels | Admin, Manager |
| /sell | sell/PosScreen | GET /products?q · GET /products/:id · GET /variants/lookup · POST /sales · GET/POST/DELETE /sales/parked · GET /settings | all |
| /sales?open= | sales/SalesListScreen | GET /sales · GET /sales/:id · POST /sales/:id/void · GET /sales/:id/receipt | Admin, Manager (sellers: /my-sales) |
| /sales/:id/return | sales/ReturnScreen | GET /sales/:id · POST /sales/:id/returns | all (own for sellers) |
| /stock/receive | stock/ReceiveScreen | GET /suppliers · GET /variants/lookup · POST /stock/purchases · GET /stock/purchases | Admin, Manager |
| /stock/adjust | stock/AdjustScreen | POST /stock/adjustments · GET /variants/lookup | Admin, Manager |
| /stock/movements | stock/MovementsScreen | GET /stock/movements | Admin, Manager |
| /stock/low | stock/LowStockScreen | GET /stock/low · PATCH /variants/:id (threshold) | all (actions: managers) |
| /stock/count | stock/CountScreen | POST /stock/counts · GET/PATCH /stock/counts/:id · POST /stock/counts/:id/apply | all count; apply: managers |
| /catalog/brands, /categories, /suppliers | catalog/CatalogScreen | GET/POST/PATCH /brands, /categories, /suppliers | Admin, Manager |
| /users | users/UsersScreen | GET/POST /users · PATCH /users/:id · POST /users/:id/{disable,enable,reset-password,revoke-sessions} | Admin, Manager |
| /settings?section= | settings/SettingsScreen | GET/PATCH /settings · POST /products/import?dryRun=1 · GET /products/export | Admin, Manager |
| /audit | audit/AuditScreen | GET /audit | Admin, Manager |
| /notifications (+ bell) | system/NotificationsScreen, components/app/Notifications | GET /notifications · POST /notifications/:id/read · /read-all | all |
| /home | seller/SellerHomeScreen | GET /sales?from&to (own) · GET /stock/low | all (seller home) |
| /my-sales | seller/MySalesScreen | GET /sales (own) · GET /sales/:id/receipt | all |
| /profile | seller/ProfileScreen | POST /me/password · POST /auth/logout | all |
| /components | system/ComponentsGallery | — (stories page; remove from prod nav if you like) | all |
| /offline, /403, /session-expired, 404 | system/SystemScreens | GET /products (cached) | all |
| ⌘K search | components/app/GlobalSearch | GET /products?q · GET /variants/search · GET /sales?q · GET /users | all (users: managers) |

Role rules live in two places only: `src/lib/nav.ts` (what is linked / which route needs which permission) and `useAuth().can()` inside screens (which columns/actions render). The server must still strip seller fields; the UI never relies on hiding alone.

## Wiring the real API — what to replace

1. **`src/lib/api.ts`** — set `USE_MOCK = false`. Every method already has a `request(method, path, body, query)` branch that calls `/api/v1` with `credentials: 'same-origin'` and `X-Requested-With: AvenueStock` (the CSRF header from `docs/SECURITY.md`). Check each path/param name against the route you implement; the mock branch documents the intended shape. Then delete the `mock(...)` branch and `src/mock/*`.
   - A few client-only conveniences have no route in the spec and are implemented on top of other calls; either add the route or compose on the client: `variants.search(q)` (→ `GET /products?q` + variants), `stock.soldLast(variantId, days)` (→ `GET /sales?variantId`), `sales.preview(cart)` (pure function; keep it client-side but make sure it mirrors the server's discount cap rule), `settings.importPreview(file)` (→ multipart `POST /products/import?dryRun=1`, switch `request()` to FormData for that call), `labels(variantIds)` (→ `GET /labels?variantIds=`).
   - Error handling: `ApiError { code, message, status, fields, retryAfter }` is already the shape of `{ error: {...} }`. `INSUFFICIENT_STOCK` must put `fields[variantId]` so the POS can mark lines. `LOCKED`/`RATE_LIMITED` must send `retryAfter` seconds for the login countdown.
2. **`src/lib/auth-context.tsx`** — replace the localStorage session with `GET /auth/me` on mount (`api.auth.me()` is already wired) and drop the stored `user`; keep `actingRole` / `viewAsSeller` in localStorage (pure UI). `switchRole` should call the role-switch endpoint when one exists (today the UI just re-renders).
3. **Seller stripping** — `stripForSeller()` in `api.ts` exists only to make the mock honest. Remove it once `serializers/seller.ts` does it server-side; the UI already tolerates missing `costPrice`/`profit` fields (`when:` columns, optional types).
4. **Money** — all amounts are integer minor units end to end. `MoneyInput` converts for typing only. Never introduce floats.
5. **Dates** — the client sends `from`/`to` as `YYYY-MM-DD`; the server applies `settings.timezone`.
6. **CSP** — `src/app/layout.tsx` has one inline `<script>` (theme bootstrap). Either pass the middleware nonce into it or move it to `public/theme.js` and list that in `script-src`. recharts and Tailwind need no `unsafe-inline` scripts; `style-src 'unsafe-inline'` is already allowed in the spec.
7. **Service worker** — `public/sw.js` is hand-written (no next-pwa). It caches `/_next/static`, icons, the `/offline` page, and stale-while-revalidates product/catalog GETs; mutations and `/analytics` are network-only. Registration happens only in production builds (`components/app/ServiceWorker.tsx`). Bump `SW_VERSION` on breaking changes. Queued offline sales (phase 2) would hook into `PosScreen`'s charge handler: on `OFFLINE` error, store the cart in IndexedDB and replay with an `Idempotency-Key`.
8. **Images** — product images are URLs in `product.images`; `Thumb` renders them lazily with a fixed aspect. Upload from `ProductEditScreen` currently keeps object URLs in state only; wire it to `POST /uploads` and put the returned URL into `images[]`.
9. **Receipts & labels** — `Receipt` and `LabelCard` are the print components (`.print-area` + `@media print` in globals.css). `GET /sales/:id/receipt?format=html` can simply render `Receipt` server-side if you want server-generated receipts.

## Conventions (short)

- Screens never import mock data; only `api`. Every list has loading / empty / error / offline states (`DataState`, `DataTable` handle them).
- Tokens only (`bg-surface`, `text-ink-2`, `border-line`, status `-soft`/`-ink`); dark mode is automatic through CSS variables.
- Mobile < 768 (bottom tab bar, sheets, cards) · tablet 768–1279 (icon rail, split views) · desktop ≥ 1280 (sidebar, tables, drawers).
- Named exports; `'use client'` screens; strict TS with `noUncheckedIndexedAccess`.
- Verification: `pnpm typecheck && pnpm lint && pnpm build`.

## Deliverables checklist (from the design brief)

- [x] Token file + Tailwind config (light & dark) — `src/app/globals.css`
- [x] Component library with stories/examples page — `src/components/ui`, `/components`
- [x] All 29 screens/areas at mobile, tablet, desktop
- [x] Role-aware navigation + View-as-seller + role switcher
- [x] Loading / empty / error / offline states everywhere
- [x] POS flow fully interactive with mock cart state (persisted, parked sales, stock checks)
- [x] Variant matrix editor fully interactive (select, edit, adjust, create with initial quantities)
- [x] Charts with accessible number fallbacks (`ChartCard fallback`)
- [x] Mock data + typed `lib/api.ts`
- [x] PWA manifest + install prompt + update toast + offline page + print styles
- [x] This handoff

## Camera scanning

The barcode scanner (`src/components/app/BarcodeScanner.tsx`) uses the native `BarcodeDetector` API where available and falls back to ZXing. Cameras only work in a secure context, so when testing on a phone over the LAN run `pnpm dev --experimental-https` (or use the Vercel preview URL). The Permissions-Policy already allows `camera=(self)`.
