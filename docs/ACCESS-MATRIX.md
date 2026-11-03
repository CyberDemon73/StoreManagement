# Access matrix

Roles: `ADMIN`, `MANAGER`, `SELLER`. ADMIN and MANAGER are identical today; keep them separate in code so they can diverge later without a migration.

Implementation: `src/lib/permissions.ts` exports `PERMISSIONS: Record<Role, Set<Permission>>` and `can(user, permission, ctx?)`. `withAuth(handler, { permission })` returns 401 if no session, 403 if `!can`. Ownership checks (`own`) are enforced inside the service with the user id, never by trusting a query param.

## Permission keys

| Permission | ADMIN | MANAGER | SELLER | Notes |
|---|---|---|---|---|
| `products.read` | ✅ | ✅ | ✅ | seller output through `serializers/seller.ts` |
| `products.write` | ✅ | ✅ | ➖ | create/edit/archive, uploads, labels |
| `variants.write` | ✅ | ✅ | ➖ | |
| `catalog.read` | ✅ | ✅ | ✅ | brands/categories/suppliers lists (suppliers hidden for seller in UI) |
| `catalog.write` | ✅ | ✅ | ➖ | |
| `stock.read` | ✅ | ✅ | ✅ | quantities, low stock |
| `stock.read.ledger` | ✅ | ✅ | ➖ | movements |
| `stock.receive` | ✅ | ✅ | ➖ | purchases |
| `stock.adjust` | ✅ | ✅ | ➖ | |
| `stock.count.read` | ✅ | ✅ | ✅ | may enter counts |
| `stock.count.manage` | ✅ | ✅ | ➖ | start / apply |
| `sales.create` | ✅ | ✅ | ✅ | |
| `sales.read` | ✅ | ✅ | own | |
| `sales.price.override` | ✅ | ✅ | ➖ | change unit price in POS |
| `sales.discount.unlimited` | ✅ | ✅ | ➖ | sellers capped by `settings.sellerDiscountCapPct` |
| `sales.void` | ✅ | ✅ | ➖ | |
| `returns.create` | ✅ | ✅ | own | |
| `analytics.read` | ✅ | ✅ | ➖ | |
| `users.manage` | ✅ | ✅ | ➖ | |
| `settings.read.full` | ✅ | ✅ | ➖ | sellers get public subset |
| `settings.write` | ✅ | ✅ | ➖ | |
| `audit.read` | ✅ | ✅ | ➖ | |
| `export.csv` | ✅ | ✅ | ➖ | |
| `data.export.all` | ✅ | ➖ | ➖ | the one place ADMIN > MANAGER today |
| `ui.view_as_seller` | ✅ | ✅ | ➖ | pure UI flag |

## Page → permission (for frontend guards)
| Route | Permission |
|---|---|
| /dashboard, /analytics/* | analytics.read |
| /home (seller home) | sales.create |
| /products, /products/:id | products.read |
| /products/new, /products/:id/edit | products.write |
| /sell | sales.create |
| /sales | sales.read |
| /my-sales | sales.read (own) |
| /stock/receive | stock.receive |
| /stock/adjust | stock.adjust |
| /stock/movements | stock.read.ledger |
| /stock/low | stock.read |
| /stock/count | stock.count.read |
| /catalog/* | catalog.write |
| /users | users.manage |
| /settings | settings.write |
| /audit | audit.read |
| /labels | products.write |
| /products/import, /products/export (API) | export.csv |
| /data/export (API) | data.export.all |
| /cron/daily (API) | Bearer CRON_SECRET, no session |
| /profile | any authenticated |

## Seller field stripping (server-side)
Removed from every response for SELLER: `costPrice`, `defaultCost`, `unitCost`, `margin`, `marginPct`, `profit`, `stockValueCost`, `cogs`. Test `tests/authz/seller-stripping.test.ts` asserts none of these keys appear in any seller-accessible endpoint's JSON (deep key scan).

## Future split (not now)
When MANAGER diverges, candidates to remove: `users.manage`, `settings.write`, `sales.void` above a value, `data.export.all`.
