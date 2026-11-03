# Sprint 1 — Catalogue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full catalogue CRUD (brands, categories, suppliers, products, size×color variant matrix) with search/filter/sort/pagination, seller cost-stripping, image upload, and a seeded dataset, with every stock quantity backed by an immutable movements ledger from day one.

**Architecture:** Same layering as Sprint 0: thin routes under `src/app/api/v1` → `parse()` → `withAuth` → services in `src/services` taking `Db` + `AuthUser` → role-aware serializers in `src/serializers`. A minimal `stock_movements` table and `applyMovement()` (row lock, negative check, weighted-average cost) are pulled forward from Sprint 2 so `variants.quantity` is never written directly. The product list is one SQL-first query (lateral aggregate over variants) so sorting by price/qty is server-side. Response shapes follow the frontend's `src/types.ts` (`Product`, `ProductListItem`, `ProductDetail`, `Variant`, `VariantWithProduct`, `Brand`, `Category`, `Supplier`, `Paginated<T>`).

**Tech Stack:** adds `@vercel/blob` (2.x) and `sharp` (0.35) to the Sprint 0 stack.

**Spec:** `CLAUDE.md`, `docs/SPRINTS.md` (Sprint 1), `docs/DATA-MODEL.md` (catalog + `stock_movements`), `docs/API-SPEC.md` (Catalog), `docs/ACCESS-MATRIX.md`, `docs/SECURITY.md` (Input: search, uploads), `FRONTEND-HANDOFF.md` + `src/types.ts` (consumer shapes), `docs/plans/sprint-0.md` (conventions: `withAuth`, `parse`, `audit`, `route-manifest`, test helpers).

## Global Constraints

- Money is integer minor units; `.int().nonnegative()` on every money field. Dates UTC `timestamptz`.
- **`variants.quantity` is written only by `applyMovement()` in `src/services/stock.ts`** inside a transaction with `SELECT … FOR UPDATE`; rejects a negative result unless `settings.allowNegativeStock`.
- Every route: `withAuth({ permission })` with keys from ACCESS-MATRIX (`products.read`, `products.write`, `variants.write`, `catalog.read`, `catalog.write`); every schema `.strict()`; registered in `src/lib/route-manifest.ts` with `access` matching (the matrix test asserts it).
- SELLER responses pass through `stripCostFields` (`costPrice`, `defaultCost`, `unitCost`, `margin*`, `profit*`, `stockValueCost`, `cogs` removed at any depth). Test with a deep key scan.
- Every mutation calls `audit(db, actor, action, entity, entityId, before, after)`.
- Search `q`: trim, max 100 chars, parameterised ILIKE/trigram only. IDs are UUIDs validated before the DB. Pagination `page ≥ 1`, `pageSize 1..100` default 25 → `{ data, page, pageSize, total }`.
- Uploads: `image/jpeg|png|webp` by **magic bytes** (sharp `metadata().format`), ≤ 5 MB, re-encoded via sharp (strips metadata), random filename, public Vercel Blob URL.
- Soft delete via `status`/`isActive`; never hard-delete rows referenced by movements.
- SKU: `BASE-SIZE-COLOR`, `SIZE`/`COLOR` = value uppercased with non-`[A-Z0-9]` removed; `baseSku` defaults to `<first 2 letters of brand>-<first 3 letters of name>` uppercased; all SKUs unique (409 `CONFLICT` with `fields`).
- Stock status: `low` = `qty > 0 AND qty <= low_stock_threshold`; `out` = `qty <= 0`.
- Conventional commits, one per task, explicit `git add <paths>` (another session shares the tree).

## Review Focus

1. `GET /products?q=` with `' OR 1=1 --`, `%`, `_`, a 10 KB string → 200 or 400, never 500. (Task 6 test.)
2. Creating a product whose generated or supplied SKU collides → 409 with `fields.baseSku` / `fields.sku`, nothing inserted (transaction rolled back). (Task 5 test.)
3. Upload of a `.jpg`-named file whose bytes are not an image (or a 6 MB image) → 400 / 413, not 500, nothing stored. (Task 8 test.)
4. Archiving a brand/category that products reference → it stays readable on those products (`isActive:false`), not 500 or orphaned. (Task 4 test.)
5. A SELLER hitting any product/variant read endpoint never receives `costPrice`/`defaultCost`/`marginPct`, including nested variants and lookup results. (Tasks 5, 6, 7 tests via `expectNoSellerKeys`.)

---

## File structure

```
src/db/schema/catalog.ts        brands, categories, suppliers, products, variants (+ indexes)
src/db/schema/stock.ts          movementTypeEnum, referenceKindEnum, stockMovements
src/db/schema/index.ts          + exports
drizzle/0002_*.sql              generated
src/services/stock.ts           applyMovement(), MovementInput  (minimal; Sprint 2 extends)
src/services/catalog.ts         brands / categories / suppliers CRUD + counts
src/services/products.ts        create / get / patch / archive, addVariants, sku helpers
src/services/products-list.ts   listProducts() SQL-first query
src/services/variants.ts        patchVariant, deleteVariant, lookupVariant, searchVariants
src/services/uploads.ts         storeImage()
src/lib/blob.ts                 putBlob() + setBlobForTests()
src/lib/sku.ts                  skuPart(), buildSku(), defaultBaseSku()
src/schemas/catalog.ts          brand/category/supplier bodies
src/schemas/products.ts         productCreateBody, productPatchBody, productListQuery, variantMatrixBody,
                                variantPatchBody, variantLookupQuery, variantSearchQuery
src/serializers/catalog.ts      toBrand/toCategory/toSupplier/toProduct/toProductListItem/toProductDetail/
                                toVariant/toVariantWithProduct + forRole()
src/app/api/v1/{brands,categories,suppliers}/route.ts  + [id]/route.ts
src/app/api/v1/products/route.ts, [id]/route.ts, [id]/archive, [id]/unarchive, [id]/variants
src/app/api/v1/variants/[id]/route.ts, lookup/route.ts, search/route.ts
src/app/api/v1/uploads/route.ts
src/db/seed.ts                  seeded catalogue generator; src/db/verify-stock.ts  (pnpm stock:verify)
tests/helpers/catalog.ts        createBrand/createCategory/createProduct/expectNoSellerKeys
tests/db/catalog-schema.test.ts  tests/services/stock.test.ts  tests/catalog/*.test.ts
tests/products/*.test.ts  tests/variants/*.test.ts  tests/uploads/upload.test.ts  tests/db/seed.test.ts
```

Shared types (defined once):

```ts
// src/services/stock.ts
export type MovementType = 'INITIAL' | 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT';
export interface MovementInput { variantId: string; type: MovementType; qtyDelta: number; unitCost?: number | null;
  reference?: { kind: 'sale'|'purchase'|'return'|'count'; id: string } | null; reason?: string | null; userId: string | null }
export interface MovementResult { movementId: string; quantity: number; costPrice: number | null }
// src/serializers/catalog.ts — output types re-declared here (backend must not import src/types.ts, frontend-owned):
export interface ColorRef { name: string; hex: string }
export interface VariantOut { id; productId; size; color: ColorRef; sku; barcode?: string; costPrice?: number; sellPrice; quantity; lowStockThreshold; isActive }
export interface ProductOut { id; name; brandId; categoryId; description?; baseSku; images: string[]; defaultCost?: number; defaultPrice; status; tags: string[]; createdBy?: string; createdAt; updatedAt }
export interface ProductListItemOut extends ProductOut { brand: {id,name}; category: {id,name}; variantCount; totalQty; lowCount; outCount; minPrice; maxPrice; lowStock: boolean; coverImage?: string; marginPct?: number; tint: string }
export interface ProductDetailOut extends ProductListItemOut { variants: VariantOut[]; sizes: string[]; colors: ColorRef[]; soldLast30d: number }
export interface VariantWithProductOut extends VariantOut { product: { id; name; baseSku; images: string[]; brandName: string; tint: string } }
```

---

### Task 1: Catalog + stock_movements schema and migration

**Files:**
- Create: `src/db/schema/catalog.ts`, `src/db/schema/stock.ts`; Modify: `src/db/schema/index.ts`, `tests/helpers/db.ts` (TABLES list), `docs/DATA-MODEL.md` (`products.created_by` nullable; `variants.color_hex char(7)` validated in app)
- Test: `tests/db/catalog-schema.test.ts`

**Interfaces (Produces):**
- `brands` (id, name text unique, logoUrl, isActive default true, createdAt, updatedAt); `categories` (id, name, parentId fk null set-null, isActive, createdAt, updatedAt, unique(name, parentId)); `suppliers` (id, name, phone, notes, isActive, createdAt, updatedAt)
- `productStatusEnum('product_status', ['ACTIVE','ARCHIVED'])`; `products` (id, name, brandId fk restrict, categoryId fk restrict, description, baseSku unique, images jsonb `string[]` default [], defaultCost int null, defaultPrice int, status default ACTIVE, tags text[] default '{}', createdBy fk users set-null, createdAt, updatedAt; indexes brandId, categoryId, status, baseSku, GIN trigram on name: `index('products_name_trgm_idx').using('gin', sql\`${t.name} gin_trgm_ops\`)`)
- `variants` (id, productId fk cascade, size, colorName, colorHex char(7), sku unique, barcode unique null, costPrice int null, sellPrice int, quantity int default 0, lowStockThreshold int default 3, isActive default true, createdAt, updatedAt; unique(productId,size,colorName); indexes productId, quantity)
- `movementTypeEnum('movement_type', ['INITIAL','PURCHASE','SALE','RETURN','ADJUSTMENT'])`, `referenceKindEnum('reference_kind', ['sale','purchase','return','count'])`; `stockMovements` (id, variantId fk restrict, type, qtyDelta int, unitCost int null, referenceKind null, referenceId uuid null, reason, userId fk set-null, createdAt; indexes (variantId, createdAt desc), (referenceKind, referenceId), (createdAt))
- `TABLES` in test helper gains `stock_movements, variants, products, suppliers, categories, brands` (before `users`).

- [x] **Step 1: Failing test**: all six tables select `[]`; inserting two variants with same `(productId,size,colorName)` → pg code `23505`; same `sku` → `23505`; `barcode` null twice allowed; `products.name` trigram index exists (`select indexname from pg_indexes where indexname='products_name_trgm_idx'` → 1 row).
- [x] **Step 2: Run** `pnpm vitest run tests/db/catalog-schema` → FAIL (tables missing).
- [x] **Step 3: Write schema files; `pnpm db:generate`; read the SQL (no DROPs; enums; GIN index uses `gin_trgm_ops`); add rollback comment line.**
- [x] **Step 4: Run** → PASS; `pnpm typecheck`.
- [x] **Step 5: Commit** `chore(db): catalog tables, variants and stock_movements ledger (migration 0002)`

---

### Task 2: Minimal stock ledger — `applyMovement()`

**Files:**
- Create: `src/services/stock.ts`, `src/db/verify-stock.ts`; Modify: `package.json` (`stock:verify: tsx src/db/verify-stock.ts`)
- Test: `tests/services/stock.test.ts`

**Interfaces (Produces):**
- `applyMovement(tx: Db, input: MovementInput): Promise<MovementResult>` — `SELECT … FOR UPDATE` on the variant; `newQty = quantity + qtyDelta`; if `newQty < 0` and `!settings.allowNegativeStock` → `AppError('INSUFFICIENT_STOCK', …, { fields: { [variantId]: 'Insufficient stock' } })`; for `INITIAL`/`PURCHASE` with `unitCost != null` and `qtyDelta > 0`: `costPrice = round((oldQty*oldCost + qtyDelta*unitCost) / (oldQty + qtyDelta))` (oldCost null → unitCost); inserts the movement, updates `quantity` (+ `costPrice`, `updatedAt`). Must be called with a transaction handle (`tx`); the function itself does not open one.
- `verifyStock(db): Promise<{ ok: boolean; mismatches: { variantId; quantity; ledger }[] }>` — compares `variants.quantity` with `Σ qty_delta`.
- `pnpm stock:verify` prints mismatches, exit 1 if any.

- [x] **Step 1: Failing tests** (fixture: brand, category, product, variant qty 0 via direct insert in the test helper only): INITIAL +10 @ 500 → quantity 10, costPrice 500, one movement row; PURCHASE +10 @ 700 → costPrice 600; SALE −25 → throws `INSUFFICIENT_STOCK` with `fields[variantId]`, quantity unchanged, no movement row; with `settings.allowNegativeStock=true` → allowed; `verifyStock` ok after the above, and `ok:false` after a test-only direct `UPDATE variants SET quantity = 99`.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement** (`db.transaction(async (tx) => applyMovement(tx, …))` in tests). **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(stock): applyMovement ledger with row lock, negative-stock guard, weighted-average cost; stock:verify`

---

### Task 3: Schemas, SKU helpers, serializers, test helpers

**Files:**
- Create: `src/lib/sku.ts`, `src/schemas/catalog.ts`, `src/schemas/products.ts`, `src/serializers/catalog.ts`, `tests/helpers/catalog.ts`
- Test: `tests/lib/sku.test.ts`, `tests/serializers/catalog.test.ts`

**Interfaces (Produces):**
- `skuPart(s: string): string` (uppercase, strip non `[A-Z0-9]`), `buildSku(base, size, colorName): string` = `${base}-${skuPart(size)}-${skuPart(colorName)}`, `defaultBaseSku(brandName, productName): string` = `${skuPart(brandName).slice(0,2)}-${skuPart(productName).slice(0,3)}` (pad with `X` to lengths 2/3).
- `src/schemas/catalog.ts`: `brandBody = z.object({ name: z.string().trim().min(1).max(60), logoUrl: z.string().url().max(500).optional(), isActive: z.boolean().optional() }).strict()`, `brandPatch = brandBody.partial().strict()`; `categoryBody { name 1..60, parentId: uuidSchema.optional(), isActive? }` + patch; `supplierBody { name 1..100, phone: z.string().trim().max(30).optional(), notes: z.string().trim().max(1000).optional(), isActive? }` + patch.
- `src/schemas/products.ts`: `colorRef = z.object({ name: z.string().trim().min(1).max(30), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict()`; `variantMatrixBody = z.object({ sizes: z.array(z.string().trim().min(1).max(20)).min(1).max(30), colors: z.array(colorRef).min(1).max(30), initialQty: z.union([z.number().int().nonnegative(), z.record(z.string(), z.number().int().nonnegative())]).optional(), costPrice: money.optional(), sellPrice: money.optional() }).strict()` where `money = z.number().int().nonnegative()`; `productCreateBody { name 1..200, brandId uuid, categoryId uuid, description ≤2000?, baseSku: z.string().trim().regex(/^[A-Za-z0-9-]{2,40}$/).transform(toUpperCase)?, images: z.array(z.string().url().startsWith('https://')).max(10)?, defaultCost: money?, defaultPrice: money, tags: z.array(z.string().trim().min(1).max(30)).max(20)?, variants: variantMatrixBody? }.strict()`; `productPatchBody = productCreateBody.omit({ variants: true }).partial().strict()`; `productListQuery = paginationQuery.extend({ q: z.string().trim().max(100).optional(), brandId: uuid?, categoryId: uuid?, size: z.string().max(20)?, color: z.string().max(30)?, stock: z.enum(['in','low','out'])?, minPrice: z.coerce.number().int().nonnegative()?, maxPrice: same?, status: z.enum(['ACTIVE','ARCHIVED','ALL']).default('ACTIVE'), sort: z.enum(['name','-name','updated','-updated','price','-price','qty','-qty']).default('-updated') }).strict()`; `variantPatchBody { sellPrice: money?, costPrice: money?, lowStockThreshold: z.number().int().nonnegative()?, barcode: z.string().trim().min(4).max(32).nullable()?, isActive: boolean?, sku: z.string().trim().regex(/^[A-Za-z0-9-]{2,60}$/).transform(upper)? }.strict()` (no `quantity` key: strict rejects it); `variantLookupQuery = z.object({ barcode: z.string().trim().min(1).max(64).optional(), sku: z.string().trim().min(1).max(64).optional() }).strict().refine(one of them)`; `variantSearchQuery { q: z.string().trim().min(1).max(100), limit: z.coerce.number().int().min(1).max(50).default(20) }.strict()`.
- `src/serializers/catalog.ts`: pure mappers from DB rows (+ aggregates) to the `*Out` types above; `forRole<T>(value: T, role: Role): T` = `role === 'SELLER' ? stripCostFields(value) : value`. `marginPct` only when `defaultCost` present: `round((defaultPrice - defaultCost) / defaultPrice * 1000) / 10`, `null` when `defaultPrice` is 0. `tint` = first colour hex of the product's variants (by `createdAt`) else `'#E6E3DC'`.
- `tests/helpers/catalog.ts`: `seedCatalog(db): Promise<{ brand, category, supplier }>`, `createProductDirect(db, { name, baseSku, brandId, categoryId, defaultPrice, defaultCost? })`, `createVariantDirect(db, { productId, size, colorName, colorHex, sku, sellPrice, costPrice?, quantity? })` (test-only insert; quantity here is fixture setup, documented), `expectNoSellerKeys(value: unknown)` (deep scan for `FORBIDDEN_SELLER_KEYS`).

- [x] **Step 1: Failing tests**: `buildSku('NL-CHI','32 W','Navy Blue') === 'NL-CHI-32W-NAVYBLUE'`; `defaultBaseSku('Northline','Chino Slim') === 'NO-CHI'`; `defaultBaseSku('A','B') === 'AX-BXX'`; `productListQuery` default `{ page:1, pageSize:25, status:'ACTIVE', sort:'-updated' }`, `sort=price-asc` rejected; `variantPatchBody` rejects `{ quantity: 5 }`; serializer: `toVariant(row)` → `color: { name, hex }`, no `colorName`; `forRole(detail, 'SELLER')` passes `expectNoSellerKeys`; `marginPct(1000, 600) === 40`.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(catalog): schemas, SKU helpers, role-aware serializers`

---

### Task 4: Brands, categories, suppliers — services + routes

**Files:**
- Create: `src/services/catalog.ts`; routes `src/app/api/v1/brands/route.ts`, `brands/[id]/route.ts`, same for `categories`, `suppliers`; Modify: `src/lib/route-manifest.ts`
- Test: `tests/catalog/brands.test.ts`, `tests/catalog/categories.test.ts`, `tests/catalog/suppliers.test.ts`

**Interfaces (Produces):**
- `listBrands(db): Promise<BrandOut[]>` (`productCount` = ACTIVE products, `variantCount`), `createBrand(db, user, input, ctx)`, `patchBrand(db, user, id, patch, ctx)`; same trio for categories (`productCount`) and suppliers (`purchaseCount: 0`, `lastPurchaseAt: null` until Sprint 2). Duplicate name → `CONFLICT` with `fields.name`. Unknown id → `NOT_FOUND`. Category `parentId` must exist and not be itself. Every mutation audits (`brand.create`, `brand.update`, …).
- Routes: `GET` (`catalog.read`), `POST` (`catalog.write`, 201), `PATCH /:id` (`catalog.write`). Manifest entries with `sampleBody`/`sampleParams` (`{ id: '00000000-0000-4000-8000-000000000001' }`).

- [x] **Step 1: Failing tests** per entity: MANAGER create → 201 with `isActive:true`; list includes `productCount` (0, then 1 after `createProductDirect`); duplicate name → 409 `fields.name`; PATCH `isActive:false` → brand still returned on `GET /brands` and a product referencing it still loads (Task 5 covers product GET; here assert the brand row keeps its id); SELLER `GET` → 200, SELLER `POST` → 403; unknown id PATCH → 404; extra field → 400; audit row written. Categories: `parentId` self → 400; unknown parent → 404.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement + register 9 routes.** **Step 4: Run** `pnpm vitest run tests/catalog tests/authz` → PASS.
- [x] **Step 5: Commit** `feat(catalog): brands, categories, suppliers CRUD with counts`

---

### Task 5: Products — create (with matrix), detail, patch, archive/unarchive

**Files:**
- Create: `src/services/products.ts`; routes `products/route.ts` (POST only here; GET added in Task 6), `products/[id]/route.ts` (GET, PATCH), `products/[id]/archive/route.ts`, `products/[id]/unarchive/route.ts`; Modify: manifest
- Test: `tests/products/create.test.ts`, `tests/products/detail.test.ts`

**Interfaces (Produces):**
- `createProduct(db, user, input: ProductCreateInput, ctx): Promise<ProductDetailOut>` — one transaction: resolve brand (for default base SKU) + category (404 if missing/inactive? → 404 only if missing; inactive allowed), insert product, then `addVariantsTx(tx, user, product, matrix, ctx)`; SKU/baseSku unique violation → `CONFLICT` with `fields.baseSku` or `fields.sku` (map pg `23505` by constraint name); audit `product.create`.
- `addVariantsTx(tx, user, product, matrix: VariantMatrixInput, ctx): Promise<VariantOut[]>` — for each `size × color` not already present (`(productId,size,colorName)`): insert with `sku = buildSku(baseSku,size,color.name)`, `sellPrice = matrix.sellPrice ?? product.defaultPrice`, `costPrice = matrix.costPrice ?? product.defaultCost`, `lowStockThreshold = settings.lowStockDefault`; `qty = typeof initialQty === 'number' ? initialQty : initialQty?.[`${size}|${color.name}`] ?? 0`; if `qty > 0` → `applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: qty, unitCost: costPrice ?? null, reason: 'Initial stock', userId: user.id })`.
- `getProductDetail(db, id): Promise<ProductDetailOut | null>` (variants ordered by size then colour, `sizes` = distinct sizes in insertion order, `colors` = distinct `{name,hex}`, aggregates as in Task 6 via `listProducts({ ids:[id] })`-free direct computation, `soldLast30d: 0`).
- `patchProduct(db, user, id, patch, ctx)` (baseSku change does **not** rename variant SKUs; conflict → 409), `setProductStatus(db, user, id, 'ACTIVE'|'ARCHIVED', ctx)`; all audit with before/after.
- Routes: `POST /products` (`products.write`, 201, `forRole`), `GET /products/:id` (`products.read`, 404 when missing; sellers get stripped), `PATCH /products/:id`, `POST /products/:id/archive|unarchive` (`products.write`).

- [x] **Step 1: Failing tests**: create with `variants { sizes:['S','M'], colors:[{name:'Black',hex:'#000000'},{name:'Navy Blue',hex:'#1f2a44'}], initialQty: { 'S|Black': 5 }, costPrice: 400 }` → 201; `variants.length === 4`; SKUs include `NO-CHI-S-BLACK` and `NO-CHI-M-NAVYBLUE`; `S|Black` quantity 5 with one INITIAL movement, others 0 and no movement; `tint === '#000000'`; `sizes` `['S','M']`, `colors` 2; default `baseSku` when omitted = `NO-CHI`; supplied `baseSku: 'nl-chi'` stored `NL-CHI`; duplicate baseSku → 409 `fields.baseSku` and `products` count unchanged; unknown `brandId` → 404; SELLER `POST` → 403; `GET /products/:id` as SELLER → 200 and `expectNoSellerKeys(body)` while MANAGER body has `defaultCost` and `variants[0].costPrice`; `marginPct` present for manager; archive → `status:'ARCHIVED'`, unarchive → `ACTIVE`; PATCH `{ name }` audits with `before.name`/`after.name`; PATCH with `variants` key → 400; 404 for a random uuid; malformed id (`/products/abc`) → 400.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement + register.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(products): create with size×color matrix and INITIAL movements, detail, patch, archive`

---

### Task 6: Product list — search, filters, sort, pagination

**Files:**
- Create: `src/services/products-list.ts`; Modify: `src/app/api/v1/products/route.ts` (add GET), manifest
- Test: `tests/products/list.test.ts`

**Interfaces (Produces):**
- `listProducts(db, query: ProductListQuery): Promise<Paginated<ProductListItemOut>>` — SQL-first (drizzle `sql` + CTE): products ⋈ brands ⋈ categories, lateral aggregate over **active** variants (`variantCount`, `totalQty`, `lowCount`, `outCount`, `minPrice`/`maxPrice` of `sellPrice` falling back to `defaultPrice` when no variants, `tint` = first colour hex by `createdAt`, `coverImage` = `images[0]`); filters: `status` (`ALL` = no filter), `brandId`, `categoryId`, `size`/`color` (EXISTS on variants, exact match case-insensitive), `stock` (`in`: `totalQty > 0 AND lowCount = 0`; `low`: `lowCount > 0`; `out`: `outCount > 0`), `minPrice`/`maxPrice` against `maxPrice`/`minPrice` overlap; `q`: `name ILIKE %q%` OR `base_sku ILIKE %q%` OR `brand.name ILIKE %q%` OR EXISTS variant (`sku ILIKE %q%` OR `barcode = q`), with `%`/`_` in `q` escaped; sort map `name→name`, `updated→updated_at`, `price→min_price`, `qty→total_qty`, secondary `id`; `total` via `count(*) over()`.

- [x] **Step 1: Failing tests** (fixture: 3 products, variants with qtys 0/2/50, thresholds 3, two brands): default list returns ACTIVE only, newest-updated first, `page 1 pageSize 25 total 3`; `q=chi` matches name; `q=<sku>` matches by variant SKU; `q=<barcode>` exact; `q=' OR 1=1 --` → 200 empty; `q=%` → 200 and **not** everything (escaped); `q` 10 KB → 400; `stock=out` returns the qty-0 product only; `stock=low` the qty-2 one; `sort=price` ascending by `minPrice`, `sort=-qty` descending; `brandId` filter; `status=ARCHIVED`/`ALL`; `pageSize=2&page=2` → 1 row, `total 3`; `pageSize=500` → 400; SELLER list → `expectNoSellerKeys` and no `marginPct`; MANAGER row has `marginPct`.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement + register GET.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(products): list with search, filters, sort whitelist and pagination`

---

### Task 7: Variants — add to product, patch, delete, lookup, search

**Files:**
- Create: `src/services/variants.ts`; routes `products/[id]/variants/route.ts` (GET, POST), `variants/[id]/route.ts` (PATCH, DELETE), `variants/lookup/route.ts`, `variants/search/route.ts`; Modify: manifest, `docs/API-SPEC.md` (add `GET /variants/search?q&limit` → `VariantWithProduct[]`, `products.read`)
- Test: `tests/variants/matrix.test.ts`, `tests/variants/patch-delete.test.ts`, `tests/variants/lookup-search.test.ts`

**Interfaces (Produces):**
- `listProductVariants(db, productId): Promise<VariantOut[]>`; `addVariants(db, user, productId, matrix, ctx): Promise<VariantOut[]>` (transaction → `addVariantsTx`; returns only the newly created cells; 404 unknown product).
- `patchVariant(db, user, id, patch, ctx): Promise<VariantOut>` (sku/barcode conflict → 409 `fields.sku`/`fields.barcode`; audit `variant.update`); `deleteVariant(db, user, id, ctx)` → `CONFLICT 'Variant has stock or movements'` unless `quantity === 0 AND no stock_movements`, else hard delete + audit `variant.delete`.
- `lookupVariant(db, { barcode?, sku? }): Promise<VariantWithProductOut | null>` (sku case-insensitive); `searchVariants(db, q, limit): Promise<VariantWithProductOut[]>` over ACTIVE products: `sku ILIKE %q%` OR `barcode = q` OR `product.name ILIKE %q%`, ordered by sku.
- Routes: `GET/POST /products/:id/variants` (`products.read` / `variants.write`), `PATCH/DELETE /variants/:id` (`variants.write`; DELETE → 204), `GET /variants/lookup` (`products.read`; 404 when none), `GET /variants/search` (`products.read`).

- [x] **Step 1: Failing tests**: POST matrix on existing product with one overlapping cell → returns only new cells, no duplicate SKU error; `initialQty: 3` (number) applies to every new cell with INITIAL movements; PATCH `sellPrice` → 200 and audit; PATCH `{ quantity: 9 }` → 400; PATCH duplicate `barcode` → 409 `fields.barcode`; DELETE with qty 0 and no movements → 204 and row gone; DELETE after an INITIAL movement → 409; lookup by `sku` lower-case → 200 `product.brandName` present; lookup unknown → 404; lookup with neither param → 400; search `q` by product name returns `VariantWithProduct[]` ≤ `limit`; SELLER lookup/search → `expectNoSellerKeys`; SELLER PATCH → 403.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement + register + API-SPEC line.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(variants): matrix add, patch (no quantity), delete guard, lookup and search`

---

### Task 8: Image upload — `POST /uploads`

**Files:**
- Create: `src/lib/blob.ts`, `src/services/uploads.ts`, `src/app/api/v1/uploads/route.ts`; Modify: manifest, `package.json` deps (`@vercel/blob`, `sharp`), `src/lib/env.ts` (`BLOB_READ_WRITE_TOKEN?`), `.env.example` comment
- Test: `tests/uploads/upload.test.ts`

**Interfaces (Produces):**
- `src/lib/blob.ts`: `putBlob(name: string, body: Buffer, contentType: string): Promise<{ url: string }>` (Vercel `put(name, body, { access:'public', contentType, addRandomSuffix:false })`; throws `AppError('INTERNAL','Storage not configured')` when token unset and no test transport), `setBlobForTests(fn | null)`.
- `storeImage(user, file: { bytes: Buffer; declaredType: string; size: number }): Promise<{ url: string }>` — `size > 5_242_880` → `AppError VALIDATION status 413`; `sharp(bytes).metadata()` format ∉ {jpeg,png,webp} (or throws) → `VALIDATION 'Unsupported image'`; re-encode with `sharp(bytes).rotate()` to the same format (jpeg quality 85 / png / webp quality 85); name `products/${crypto.randomUUID()}.${ext}`; audit `upload.create` with `{ url, bytes }`.
- Route: `withAuth({ permission: 'products.write' })`, `const form = await req.formData(); const file = form.get('file')` must be a `File` → else 400; returns 201 `{ url }`. Manifest `sampleBody` unsupported for multipart: add `sampleRequest?: () => Request` support in `RouteSpec`/matrix (`call` accepts a prebuilt body) — simplest: `RouteSpec.sampleForm?: () => FormData` and `tests/helpers/http.ts` `call({ form })` sends it without JSON content-type.

- [x] **Step 1: Failing tests** (generate images with `sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer()`): PNG upload as MANAGER → 201 `{ url }` matching `/^https:\/\/.+\/products\/[0-9a-f-]{36}\.png$/`, captured blob `contentType 'image/png'`, bytes differ from input (re-encoded) and `sharp(captured).metadata()` has no `exif`; JPEG with EXIF (`.jpeg().withMetadata({ exif: … })`) → stored without exif; a text file named `evil.jpg` → 400 `Unsupported image`; 6 MB buffer → 413; no `file` field → 400; SELLER → 403; anonymous → 401.
- [x] **Step 2: Run** → FAIL. **Step 3: `pnpm add @vercel/blob sharp`; implement; register.** **Step 4: Run** → PASS; `pnpm build` (sharp external: add to `serverExternalPackages`).
- [x] **Step 5: Commit** `feat(uploads): image upload with magic-byte check, re-encode and Vercel Blob`

---

### Task 9: Seed generator + stock:verify on seed

**Files:**
- Modify: `src/db/seed.ts`; Test: `tests/db/seed.test.ts`

**Interfaces (Produces):**
- `seed(db, opts?: { userId?: string | null }): Promise<{ brands; categories; products; variants; movements }>` — idempotent (skips when any brand exists); deterministic PRNG (mulberry32, seed 42); 3 brands (`Northline`, `Casa Lino`, `Verano`), 6 categories (`Tops`, `Bottoms`, `Dresses`, `Outerwear`, `Shoes`, `Accessories`), 2 suppliers, 40 products (names from a fixed list), sizes per category (`XS..XL` / `28..36` / `38..45` shoes / `ONE` accessories), 2–3 colours from a fixed palette → ~250 variants; each gets an INITIAL movement of 0–40 units at a cost 55–70 % of price via `applyMovement`; ~8 % left at 0; settings row ensured.
- CLI (`pnpm db:seed`) unchanged entry.

- [x] **Step 1: Failing test**: `seed(db)` → counts `brands 3, categories 6, products 40, variants between 200 and 320`; `verifyStock(db).ok === true`; second `seed(db)` makes no change; every variant's `sku` matches `/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/` or `/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/`.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (note runtime; PGlite + ~250 movements should stay < 15 s).
- [x] **Step 5: Commit** `feat(db): deterministic catalogue seed with INITIAL movements`

---

### Task 10: Docs, checklist, verification, security review

**Files:**
- Modify: `docs/SPRINTS.md` (tick Sprint 1 boxes, note the pulled-forward ledger on the initial-qty line), `docs/DECISIONS.md` (ledger pulled forward; shapes follow `src/types.ts`; SKU rule; `variants/search`; sharp/blob seam; `created_by` nullable), `docs/API-SPEC.md` (response-shape notes: `color` object, list aggregates, `tint`), `docs/DATA-MODEL.md` (stock_movements now live), `README.md` (BLOB token row → "Sprint 1: required for uploads"), `.env.example`.

- [x] **Step 1: Docs edits.**
- [x] **Step 2: Verify** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm audit --audit-level=high` — paste output.
- [x] **Step 3: Tick checkboxes; commit** `docs: sprint 1 checklist, decisions, API shape notes`
- [x] **Step 4: `/security-review`** (A1 matrix, A2 seller-stripping across all read routes, C3 fuzz `q`, C4 uploads, E1 `grep -rn "set({ quantity" src/` → only `services/stock.ts`, E2 `pnpm stock:verify` on seed).

## Deferred
- `GET /labels`, CSV import/export (Sprint 6); purchases/adjustments/counts (Sprint 2); `soldLast30d` real value (Sprint 3).
- Supplier `purchaseCount`/`lastPurchaseAt` stay 0/null until Sprint 2.
