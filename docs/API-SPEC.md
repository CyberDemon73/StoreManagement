# API specification — `/api/v1`

Conventions
- JSON only. Auth via session cookie (`__Host-as_session`). All non-GET requests must pass the Origin check **and** send `X-Requested-With: AvenueStock` (403 otherwise). Every response carries `X-Request-Id`.
- Pagination: `?page=1&pageSize=25` (max 100) → `{ data, page, pageSize, total }`.
- Dates ISO-8601 UTC. Money integer minor units.
- Errors: `{ error: { code: 'VALIDATION'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'RATE_LIMITED'|'LOCKED'|'INSUFFICIENT_STOCK'|'INTERNAL', message, fields?: Record<string,string>, retryAfter?: number } }` with 400/401/403/404/409/429/423/409/500. `retryAfter` (seconds) accompanies 423/429 together with a `Retry-After` header. Unknown body keys appear in `fields` as `'Unknown field'`. Bodies over 1 MB → 413 `VALIDATION`.
- Permission column uses keys from `ACCESS-MATRIX.md`. `SELLER` responses pass through `serializers/seller.ts` which removes `costPrice`, `defaultCost`, `unitCost`, `margin*`, `profit*`.
- Idempotency: `POST /sales` and `POST /stock/purchases` accept `Idempotency-Key` header (uuid); replay returns the original response.

## Auth & setup
| Method | Path | Perm | Body / Query | Response |
|---|---|---|---|---|
| POST | /setup | public (only if 0 users) | `{ name, email, password, storeName, currency, setupToken }` — `setupToken` must equal env `SETUP_TOKEN` (403 otherwise; 409 once a user exists) | 201 `{ user }` + session cookie |
| POST | /auth/login | public (rate limited) | `{ email, password, remember? }` | `{ user }` + cookie; 401 bad credentials, 423 locked (`retryAfter`), 429 rate limited |
| POST | /auth/logout | auth | — | 204 |
| GET | /auth/me | auth | — | `{ user, permissions: string[], settingsPublic }` |
| POST | /auth/forgot | public (rate limited) | `{ email }` | 204 always |
| POST | /auth/reset | public | `{ token, password }` | 204 |
| PATCH | /me | auth | `{ name }` | `{ user }` |
| POST | /me/password | auth | `{ current, next }` — throttled 5 / 15 min per user | 204 + new session cookie (revokes every other session and outstanding reset links; clears `mustChangePassword`) |
| POST | /auth/accept-invite | public (IP-limited) | `{ token, password }` — invite token 48 h, single use | 200 `{ user }` + session cookie; 400 invalid/expired/used |
| GET | /health | public | — | `{ ok, db: 'up' }`; 503 `{ ok: false, db: 'down' }` |
| GET | /cron/daily | Bearer `CRON_SECRET` (else 401) | — | `{ purged, weekly, stockVerify?, backup? }`; Vercel Cron `0 2 * * *` |

## Catalog
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | /products | products.read | `q, brandId, categoryId, size, color, stock=in|low|out, minPrice, maxPrice, status, sort=name|updated|price|qty (+`-` for desc), page, pageSize`. Each item includes `brand`, `category`, `variantCount`, `totalQty`, `minPrice`, `maxPrice`, `lowStock: bool`, `coverImage` |
| POST | /products | products.write | `{ name, brandId, categoryId, description?, baseSku?, images?, defaultCost?, defaultPrice, tags?, variants?: { sizes: string[], colors: {name,hex}[], initialQty?: number, costPrice?, sellPrice? } }` → creates product + matrix |
| GET | /products/:id | products.read | includes `variants[]` |
| PATCH | /products/:id | products.write | partial of POST body minus variants |
| POST | /products/:id/archive | products.write | and `/unarchive` |
| GET | /products/:id/variants | products.read | |
| POST | /products/:id/variants | variants.write | `{ sizes[], colors[], initialQty?, costPrice?, sellPrice? }` — adds only missing cells |
| PATCH | /variants/:id | variants.write | `{ sellPrice?, costPrice?, lowStockThreshold?, barcode?, isActive? }` — **no quantity** |
| DELETE | /variants/:id | variants.write | 409 unless qty 0 and no movements |
| GET | /variants/lookup | products.read | `?barcode=` or `?sku=` → variant + product |
| GET | /variants/search | products.read | `?q&limit` (limit 1..50, default 20) → `VariantWithProduct[]` over ACTIVE products: sku/name contains or exact barcode, ordered by sku |
| GET/POST/PATCH | /brands, /brands/:id | catalog.read / catalog.write | `{ name, logoUrl?, isActive? }`; GET includes `productCount` |
| GET/POST/PATCH | /categories, /categories/:id | catalog.read / catalog.write | `{ name, parentId? }` |
| GET/POST/PATCH | /suppliers, /suppliers/:id | catalog.read / catalog.write | |
| POST | /uploads | products.write | multipart image ≤ 4 MB (Vercel request bodies are capped at 4.5 MB) → `{ url }` |
| POST | /products/import | export.csv | multipart field `file` (CSV ≤ 2 MB, ≤ 5,000 rows; columns `name, brand, category, size, color, colorHex?, price, cost?, qty?, barcode?`, unknown columns ignored; row 2 = first data row). `?dryRun=1` → 200 `{ rows, ok, errors: [{ row, message, data }] }`, no writes. Without dryRun: all-or-nothing → 201 `{ rows, ok, errors: [], created: { products, variants } }`, or 400 `{ error, rows, ok, errors }` writing nothing. Opening qty booked as INITIAL movements |
| GET | /products/export | export.csv | `text/csv` (BOM, formula-neutralised), one row per active variant: import columns + `sku`; re-imports unchanged |

## Stock
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | /stock/movements | stock.read.ledger | `variantId, productId, type, from, to, userId, page` |
| POST | /stock/adjustments | stock.adjust | `{ items: [{ variantId, qtyDelta | newQty, reason: DAMAGED|LOST|FOUND|CORRECTION|OTHER, note? }] }` |
| POST | /stock/purchases | stock.receive | `{ supplierId?, invoiceRef?, receivedAt?, note?, items: [{ variantId, qty, unitCost }] }` |
| GET | /stock/purchases, /stock/purchases/:id | stock.receive | |
| GET | /stock/low | stock.read | `{ low: [...], out: [...] }` grouped by product |
| POST | /stock/counts | stock.count.manage | starts a session (snapshots system qty for active variants or `?productIds=`) |
| GET | /stock/counts | stock.count.read | 20 most recent sessions, newest first, each with items |
| GET | /stock/counts/:id | stock.count.read | items + variance |
| PATCH | /stock/counts/:id | stock.count.read | `{ items: [{ variantId, countedQty }] }` (sellers may count) |
| POST | /stock/counts/:id/apply | stock.count.manage | creates ADJUSTMENT movements, status APPLIED |
| POST | /stock/counts/:id/cancel | stock.count.manage | OPEN → CANCELLED; apply/patch afterwards → 409 |
| GET | /labels | products.write | `?variantIds=a,b,c` (1–200 uuids) → `VariantWithProduct[]` in request order, unknown ids omitted, never cost |

## Sales
| Method | Path | Perm | Notes |
|---|---|---|---|
| POST | /sales | sales.create | `{ items: [{ variantId, qty, unitPrice? }], discount?: { type: 'AMOUNT'|'PCT', value }, paymentMethod, customerName?, customerPhone?, note? }`. Server recomputes prices (unitPrice override allowed only for managers), applies discount cap, allocates number, locks stock. 409 `INSUFFICIENT_STOCK` with `fields[variantId]`. |
| GET | /sales | sales.read (own for seller) | `from, to, sellerId, paymentMethod, status, q(number/customer), page` |
| GET | /sales/:id | sales.read (own) | with items, seller, returns |
| POST | /sales/:id/void | sales.void | `{ reason }` reverses movements |
| POST | /sales/:id/returns | returns.create (own) | `{ items: [{ saleItemId, qty, restock }], refundMethod, reason }` |
| GET | /sales/:id/receipt | sales.read (own) | `?format=json|html` |
| GET/POST/DELETE | /sales/parked, /sales/parked/:id | sales.create | per-user, max 3 |

## Analytics (all `analytics.read`; all accept `from, to`; `tz` from settings)
| Path | Response (shape) |
|---|---|
| /analytics/dashboard | `DashboardKpis` (see frontend types) + `trend[]`, `topProducts[]`, `brandSplit[]`, `lowStock[]`, `recentSales[]` |
| /analytics/sales-trend?interval=day\|week\|month | `[{ bucket, revenue, profit, cogs, count }]` empty buckets filled |
| /analytics/brands, /analytics/categories | `[{ id, name, unitsInStock, stockValueCost, stockValueRetail, unitsSold, revenue, profit, marginPct }]` |
| /analytics/top-products?by=units\|revenue\|profit&limit=10 | `[{ productId, name, brand, units, revenue, profit, marginPct }]` |
| /analytics/top-variants | same + size/color |
| /analytics/slow-movers?days=30 | `[{ variantId, product, size, color, qty, daysSinceLastSale, valueAtCost }]` |
| /analytics/size-color | `{ sizes[], colors[], cells: [{ size, color, qty }] }` |
| /analytics/sellers | `[{ userId, name, salesCount, revenue, avgBasket, discountGiven, returnsCount, returnsValue }]` |
| /analytics/returns | `{ rate, count, value, byReason[] }` |
| /analytics/payment-mix | `[{ method, count, total }]` |
| /analytics/stock-ageing | buckets 0–30 / 31–60 / 61–90 / 90+ days with units + value |
| /analytics/price-list | paginated variants with cost, price, margin |
| /analytics/export?report=<any above> | CSV stream |

## Users, settings, audit, notifications
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | /users | users.manage | `User[]` with `roles`, `sessions` (active count), `lastLoginAt` |
| POST | /users | users.manage | `{ name, email, role, mode: 'INVITE'|'TEMP' }` → 201 `{ user, temporaryPassword? }`. INVITE emails a 48 h link (status INVITED); TEMP returns a 16-char password once and sets `mustChangePassword`. Only an ADMIN may create an ADMIN. Duplicate email → 409 `fields.email` |
| PATCH | /users/:id | users.manage | `{ name?, role? }` non-empty; to/from ADMIN or on an ADMIN account: ADMIN only (403); last active ADMIN / own role → 409; role change revokes sessions and reset links |
| POST | /users/:id/disable, /enable | users.manage | disable: not self, not last ADMIN (409); revokes sessions and reset links. enable restores INVITED for never-accepted invites |
| POST | /users/:id/reset-password | users.manage | `{ mode: 'EMAIL'|'TEMP' }` → `{ temporaryPassword? }`. Kills old reset links and sessions; emails the target and notifies every ADMIN (`ACCOUNT_RESET`). EMAIL on an INVITED user re-sends the invite; TEMP on INVITED → 409 |
| POST | /users/:id/revoke-sessions | users.manage | 204 |
| GET | /settings | auth | `settings.read.full` → full `Settings` incl. `nextSaleNumber`; others → public subset |
| PATCH | /settings | settings.write | strict partial: `timezone` (pg_timezone_names), `currency` /^[A-Z]{3}$/, `saleNumberPrefix` /^[A-Z]{1,6}$/ not PO/SC, `sellerDiscountCapPct` 0–100, `lowStockDefault` 0–1000, `largeRefundAlert` ≥ 1, `sessionIdleHours` 1–72 (≤ absolute days × 24), `sessionAbsoluteDays` 1–30, text ≤ 500 (blank clears), `logoUrl` https, presets, `dateFormat`, `requirePhoneOnTransfer`, `receiptShowLogo`. Unknown keys (`lockoutEnabled`, `passwordRotationDays`, `nextSaleNumber`) → 400. Audits changed keys only |
| GET | /audit | audit.read | `page, pageSize, q, userId, entity, action, from, to` (store-local days) → paginated `AuditEntry` with `userName`, `entityLabel`, `summary` |
| GET | /notifications | auth | own only; unread first then newest, max 50. Kinds: LOW_STOCK, LARGE_REFUND, NEW_DEVICE_LOGIN, COUNT_APPLIED, ACCOUNT_RESET |
| POST | /notifications/:id/read | auth | and `/notifications/read-all`; 204; another user's id → 404 |

A user with `mustChangePassword` gets 403 `FORBIDDEN` `fields.password = 'Password change required'` on every authenticated route except `GET /auth/me`, `POST /auth/logout`, `POST /me/password`. Login of an INVITED user → 403 `Invitation not accepted`.
| GET | /data/export | data.export.all (ADMIN) | `application/zip`, one CSV per table; no sessions, tokens, idempotency keys, failed logins, known devices or password hashes. Audited |
