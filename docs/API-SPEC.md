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
| POST | /me/password | auth | `{ current, next }` | 204 (revokes other sessions) |
| GET | /health | public | — | `{ ok, db }` |

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
| GET/POST/PATCH | /brands, /brands/:id | catalog.read / catalog.write | `{ name, logoUrl?, isActive? }`; GET includes `productCount` |
| GET/POST/PATCH | /categories, /categories/:id | catalog.read / catalog.write | `{ name, parentId? }` |
| GET/POST/PATCH | /suppliers, /suppliers/:id | catalog.read / catalog.write | |
| POST | /uploads | products.write | multipart image ≤ 5 MB → `{ url }` |
| POST | /products/import | export.csv | multipart CSV, `?dryRun=1` → `{ rows, errors[] }` |
| GET | /products/export | export.csv | CSV stream |

## Stock
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | /stock/movements | stock.read.ledger | `variantId, productId, type, from, to, userId, page` |
| POST | /stock/adjustments | stock.adjust | `{ items: [{ variantId, qtyDelta | newQty, reason: DAMAGED|LOST|FOUND|CORRECTION|OTHER, note? }] }` |
| POST | /stock/purchases | stock.receive | `{ supplierId?, invoiceRef?, receivedAt?, note?, items: [{ variantId, qty, unitCost }] }` |
| GET | /stock/purchases, /stock/purchases/:id | stock.receive | |
| GET | /stock/low | stock.read | `{ low: [...], out: [...] }` grouped by product |
| POST | /stock/counts | stock.count.manage | starts a session (snapshots system qty for active variants or `?productIds=`) |
| GET | /stock/counts/:id | stock.count.read | items + variance |
| PATCH | /stock/counts/:id | stock.count.read | `{ items: [{ variantId, countedQty }] }` (sellers may count) |
| POST | /stock/counts/:id/apply | stock.count.manage | creates ADJUSTMENT movements, status APPLIED |
| GET | /labels | products.write | `?variantIds=a,b,c` → label data |

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
| GET | /users | users.manage | |
| POST | /users | users.manage | `{ name, email, role, password? }` — without password sends invite |
| PATCH | /users/:id | users.manage | `{ name?, role? }` last-admin guard |
| POST | /users/:id/disable, /enable | users.manage | last-admin guard |
| POST | /users/:id/reset-password | users.manage | `{ mode: 'EMAIL'|'TEMP' }` |
| POST | /users/:id/revoke-sessions | users.manage | |
| GET | /settings | auth (public subset) / settings.write (full) | |
| PATCH | /settings | settings.write | partial, validated |
| GET | /audit | audit.read | `page, pageSize` today (Sprint 0); `q, userId, entity, action, from, to` arrive in Sprint 5 |
| GET | /notifications | auth | unread first |
| POST | /notifications/:id/read | auth | and `/notifications/read-all` |
| GET | /data/export | export.csv (ADMIN) | zip of CSVs |
