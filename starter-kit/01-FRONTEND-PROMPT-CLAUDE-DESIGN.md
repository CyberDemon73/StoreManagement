# Avenue Stock — One-shot Frontend Prompt for Claude Design

> Paste everything below the line into Claude Design in a single message. If Claude Design supports attaching files, also attach `repo/docs/DATA-MODEL.md`, `repo/docs/API-SPEC.md` and `repo/docs/ACCESS-MATRIX.md`; otherwise this prompt is self-contained.

---

You are designing and building the complete frontend for **Avenue Stock**, an inventory, sales and reporting web app for a single retail store that sells products with **sizes and colors** (apparel-style stock). Produce a complete, production-grade, responsive, installable (PWA) frontend as **React + TypeScript + Tailwind CSS** components with realistic mock data, so a developer can drop the screens into a Next.js App Router project and wire them to the API described at the end.

## 1. Who it's for
- The owner (about 40, modern, busy). He checks profit and stock on his phone in the evening and on an iPad in the shop.
- One or two managers (same permissions as owner for now).
- Sellers on the shop floor using a phone or iPad to sell quickly.

## 2. Design direction
- **Mood:** calm, quiet, confident. Think a well-run boutique's back office, not a dashboard full of neon. Mature without feeling old.
- **Palette (CSS tokens — define these and use only these):**
  - `--bg` warm off-white `#F7F6F3`; `--surface` `#FFFFFF`; `--surface-2` `#F1EFEA`
  - `--ink` `#1F2421` (primary text); `--ink-2` `#5B625D` (secondary); `--ink-3` `#9AA09B` (muted)
  - `--line` `#E6E3DC` borders
  - `--accent` deep sage `#3F6B5C`; `--accent-soft` `#E3EDE8`; `--accent-ink` `#FFFFFF`
  - `--ok` `#2F7D5B`; `--warn` `#B7791F`; `--danger` `#B04A3F`; `--info` `#3D6A8A` — each with a `-soft` tint for backgrounds.
  - Dark mode: `--bg #141715`, `--surface #1C201E`, `--surface-2 #232826`, `--ink #ECEEEB`, `--line #2E3331`, accent `#7FB5A0`. Respect `prefers-color-scheme` and a manual toggle.
- **Typography:** Inter (or Geist). Base 15px on mobile, 14px on desktop tables. Headings 600 weight, generous letter-spacing on small caps labels. Numbers in tables use `font-variant-numeric: tabular-nums`.
- **Shape:** 12px radius cards, 8px radius inputs, 1px `--line` borders, almost no drop shadows (one soft shadow for floating sheets/menus only).
- **Spacing:** 8-pt grid. Roomy. Minimum touch target 44×44.
- **Icons:** lucide-react, 20px, stroke 1.75.
- **Motion:** 150–200 ms ease-out; sheets slide up on mobile, drawers slide in from the right on desktop. No bouncing.
- **Charts:** Recharts (or any lightweight lib) using the tokens above; muted fills, one accent line; always include a plain-number fallback under each chart for accessibility.

## 3. Responsive behaviour (design all three)
| Breakpoint | Nav | Layout |
|---|---|---|
| Mobile < 768 | Bottom tab bar (5 tabs max: Home · Products · Sell · Sales · More) + top bar with page title and avatar | Single column, cards, full-screen sheets for forms |
| Tablet 768–1279 (iPad portrait & landscape) | Collapsible icon rail on the left (expands on tap/hover) | Two columns where useful (list + detail), POS = catalogue left / cart right |
| Desktop ≥ 1280 | Full sidebar with sections and labels | Tables, side drawers for detail/edit, 3–4 KPI columns |

Show how the **same screen** adapts across all three for at least: Dashboard, Products list, Product detail (variant matrix), New Sale (POS).

## 4. App shell & global components
Build a component library first, then compose screens from it:
`AppShell`, `Sidebar`, `IconRail`, `BottomTabBar`, `TopBar`, `PageHeader` (title, breadcrumb, primary action), `KpiCard` (value, delta, sparkline), `DataTable` (sortable columns, sticky header, row selection, pagination 25/50/100, column visibility, empty state), `CardGrid`, `SearchInput` (with ⌘K global search), `FilterBar` (chips + "More filters" sheet), `DateRangePicker` (presets: Today, Yesterday, 7d, 30d, This month, Last month, Custom), `Sheet` (mobile bottom sheet), `Drawer` (desktop side panel), `Dialog`, `Toast`, `Badge` (status/role), `Avatar`, `Stepper`, `QuantityInput` (big − / + for touch), `MoneyInput`, `Select`/`Combobox`, `Tabs`, `Skeleton`, `EmptyState` (illustration-free, icon + text + action), `ErrorState`, `OfflineBanner`, `UpdateAvailableToast`, `InstallPwaPrompt`, `RoleBadge`, `ViewingAsBanner`, `ColorSwatch`, `SizeChip`, `VariantMatrix` (sizes × colors grid, each cell shows qty with low/out colouring, tap to edit), `BarcodeScannerButton` (opens camera scanner sheet; mock it), `Receipt` (print-friendly), `ChartCard`.

Every data screen must include **loading (skeleton), empty, error and offline** states.

## 5. Roles & navigation
Three roles: `ADMIN`, `MANAGER` (identical to admin for now), `SELLER`.

- **Admin/Manager nav:** Dashboard · Products · Sell · Sales · Stock (Receive, Adjust, Movements, Low stock, Stock count) · Analytics · Catalog (Brands, Categories, Suppliers) · Users · Settings · Audit log.
- **Seller nav:** Home · Products · Sell · My sales · Profile.
- Admin/Manager top bar has a **"View as seller"** toggle; when on, the UI renders exactly the seller experience with a persistent `ViewingAsBanner` ("Viewing as Seller — Exit"). Also include a **role switcher** in the profile menu for a user who holds more than one role.
- Sellers never see cost price, profit, stock value, analytics, users or settings. Design the product cards/tables so hiding the cost column doesn't break alignment.

## 6. Screens to produce (all of them)

### Auth
1. **Login** — centered card, store logo mark, email, password (show/hide), "Remember this device", forgot link. Error states: wrong credentials, account disabled, locked out (shows minutes remaining), rate limited.
2. **Forgot password** / **Reset password** (token link) / **Set first password** (invited user).
3. **First-run setup wizard** (3 steps: create admin → store name & currency → done).

### Owner / Manager
4. **Dashboard** — date range at top-right. KPI row: Total cash (with payment-method mini-breakdown), Gross profit (+ margin %), COGS, Items in stock (units + SKUs), Stock value at cost, Stock value at retail, Sales count, Avg basket. Then: Sales & profit trend (line), Brand split (donut + legend with value), Top 5 products (bar), Low stock (list with Receive shortcut), Recent sales (compact list). Mobile: KPIs scroll horizontally in a 2-row snap carousel.
5. **Analytics** — tabs: Sales · Profit · Inventory · Brands · Sellers · Returns. Each tab: date range, 2–4 KPI cards, 1–2 charts, a detail table, Export CSV button. Include a **Size & color heatmap** under Inventory and a **Slow movers** table (days since last sale, value tied up). Sellers tab: table of sellers with sales, revenue, avg basket, discounts given, returns.
6. **Products list** — desktop: table (image thumb, name, brand, category, variants count, total qty, cost, price, margin %, status, updated). Mobile: cards. Search bar (name/SKU/barcode), filter chips (Brand, Category, Size, Color, Stock status: In stock / Low / Out, Price range, Status: Active/Archived), sort menu, bulk select → Archive / Change category / Print labels. Pagination footer. Quick-view drawer on row click.
7. **Product detail** — header (image gallery, name, brand, category, status, baseSKU, actions: Edit, Archive, Print labels, Receive stock). Tabs: **Variants** (the `VariantMatrix`: sizes as rows, colors as columns, each cell = qty with soft green/amber/red background for ok/low/out; tap a cell → sheet with qty, cost, price, SKU, barcode, threshold, and "Adjust quantity" with reason), **Movements** (timeline), **Sales** (table), **Details** (description, tags, timestamps, created by).
8. **Product create / edit** — desktop: single page with sections; mobile: 5-step stepper. Steps: Basics (name, brand combobox w/ create-new, category, description, tags) → Images (drag-drop / camera, reorder, cover) → Variants (choose sizes from presets or add custom; choose colors from presets with swatch or add custom name + hex; preview generated matrix; option to set initial quantity per cell) → Pricing (default cost & price, override per variant, show margin live) → Review & save. Validation messages inline.
9. **Receive stock (Purchase)** — supplier combobox, invoice ref, date; line items: search or scan → choose variant → qty (big stepper) → unit cost; running total; "Post purchase" confirm dialog explaining stock will increase and average cost will update. Also a **Purchases list** page.
10. **Stock adjustment** — single (pick variant, new qty or delta, reason select: Damaged / Lost / Found / Correction / Other, note) and **bulk** (table edit). Confirm step shows before/after.
11. **Stock movements** — filterable timeline/table: date, variant, type badge, delta (+/− colored), unit cost, reference link, user.
12. **Low stock & Out of stock** — grouped list, threshold shown, Receive shortcut, "Mark threshold" inline.
13. **Stock count** — start session → scan/enter counts (progress bar) → variance review (system vs counted, highlight differences) → Apply (creates adjustments).
14. **Sales list** — filters: date, seller, payment method, status; table/cards; row → **Sale detail drawer** with items, totals, payment, seller, timestamps, Receipt (print/share), Return items, Void (manager, reason required).
15. **Return / refund flow** — from a sale: tick items + qty, restock toggle per line, refund method, reason, confirm summary.
16. **Brands**, **Categories**, **Suppliers** — simple CRUD lists with product counts, inline rename, archive.
17. **Users** — table (avatar, name, email, role badge, status, last login), Create user sheet (name, email, role, temp password or send invite), Edit role, Disable/Enable, Force password reset, Sessions (sign out everywhere).
18. **Settings** — sections: Store (name, logo, phone, address), Localization (currency default EGP, timezone default Africa/Cairo, date format), Inventory (default low-stock threshold, size presets editor, color presets editor with swatches), Sales (sale number prefix, seller discount cap %, allow negative stock = off), Receipt (header/footer text, show logo), Security (session length, require password change every N days), Data (Export all CSV, Import products CSV with preview + error rows), Appearance (light/dark/system).
19. **Audit log** — searchable table: time, user, action, entity, summary, expandable before/after JSON.
20. **Barcode labels** — select variants → choose template (A4 grid / 40×30 thermal) → print preview.
21. **Notifications** — bell with list: low stock, large refund, new device login.

### Seller
22. **Seller Home** — greeting, big "New sale" button, today's own numbers (sales count, revenue — never profit), low-stock glance (names only), recent own sales.
23. **New Sale (POS)** — the most important screen; design it for speed with thumbs:
    - Left/top: search field + scan button; result cards show image, name, brand, price and a **size/color picker** (sizes as chips, colors as swatches; disabled with "0" when out; shows available qty).
    - Right/bottom (mobile: sticky cart bar that expands into a sheet): cart lines (thumb, name, size·color, qty stepper, line total, remove), subtotal, discount (amount or %, capped for sellers with inline "max 10%" message), total, payment method segmented control (Cash / Card / Wallet / Transfer), optional customer name/phone, note, **Charge** button with total on it.
    - After charge: success screen with receipt, "New sale", "Share receipt", "Print".
    - Hold/park a sale (max 3 parked).
24. **Products (seller view)** — same list, no cost/margin columns, qty per variant visible.
25. **My sales** — own sales only, receipt, "Start return".
26. **Profile** — name, email, role(s), change password, theme, sign out, switch role.

### Shared / system
27. **Global search** (⌘K / search icon) — products, SKUs, sale numbers, users (manager only).
28. **404**, **403 (no access)**, **Session expired**, **Offline** page (cached catalogue browsable, "You're offline — sales will sync when back online" banner for phase 2).
29. **PWA**: `manifest.json` (name "Avenue Stock", short_name "Avenue", theme colour = `--accent`, background = `--bg`, display standalone, icons 192/512 maskable), install prompt component, update toast, iOS "Add to Home Screen" hint.

## 7. Mock data
Provide a `mock/` folder with realistic data: 3 brands, 6 categories, 40 products, ~250 variants across sizes (XS–XXL, 36–45 for shoes) and colors (name + hex), 120 sales over the last 60 days, 3 users (one per role), movements, and settings. All money in **integer minor units** (e.g. 12500 = 125.00 EGP) with a `formatMoney(minor, currency)` helper.

## 8. Code & structure requirements
- React 18 + TypeScript strict, Tailwind with the token config, lucide-react, Recharts. No UI framework that fights Tailwind; shadcn/ui-style primitives are fine.
- Folder structure: `components/ui/*`, `components/app/*`, `screens/<area>/<Screen>.tsx`, `lib/format.ts`, `lib/api.ts` (typed fetch wrapper with the endpoint list below, mocked), `types.ts` (shared types matching the data model below), `mock/*`.
- Every screen exports a component and is reachable from a simple router stub (`/dashboard`, `/products`, `/products/[id]`, `/sell`, `/sales`, `/stock/receive`, `/stock/adjust`, `/stock/movements`, `/stock/low`, `/stock/count`, `/analytics`, `/catalog/brands`, `/catalog/categories`, `/catalog/suppliers`, `/users`, `/settings`, `/audit`, `/labels`, `/home` (seller), `/my-sales`, `/profile`, `/login`, `/forgot`, `/reset`, `/setup`).
- Accessibility: semantic landmarks, labels on every input, focus rings using `--accent`, keyboard navigable tables, `aria-live` for cart totals and toasts, colour never the only signal (add text/icon).
- Performance: virtualise lists > 200 rows, lazy-load charts, images with `loading="lazy"` and fixed aspect ratios.
- Print stylesheet for Receipt and Labels.
- Comment at the top of each screen: which API endpoints it calls and which role(s) can see it.

## 9. Data model (types to mirror)
```ts
type Role = 'ADMIN' | 'MANAGER' | 'SELLER';
type User = { id: string; name: string; email: string; role: Role; status: 'ACTIVE'|'DISABLED'; lastLoginAt?: string };
type Brand = { id: string; name: string; logoUrl?: string; isActive: boolean };
type Category = { id: string; name: string; parentId?: string };
type Product = { id: string; name: string; brandId: string; categoryId: string; description?: string; baseSku: string; images: string[]; defaultCost?: number; defaultPrice: number; status: 'ACTIVE'|'ARCHIVED'; tags: string[]; createdAt: string; updatedAt: string };
type Variant = { id: string; productId: string; size: string; color: { name: string; hex: string }; sku: string; barcode?: string; costPrice?: number /* hidden for sellers */; sellPrice: number; quantity: number; lowStockThreshold: number };
type MovementType = 'INITIAL'|'PURCHASE'|'SALE'|'RETURN'|'ADJUSTMENT';
type StockMovement = { id: string; variantId: string; type: MovementType; qtyDelta: number; unitCost?: number; reference?: { kind: 'sale'|'purchase'|'return'|'count'; id: string }; reason?: string; userId: string; createdAt: string };
type PaymentMethod = 'CASH'|'CARD'|'WALLET'|'TRANSFER';
type Sale = { id: string; number: string; sellerId: string; items: SaleItem[]; subtotal: number; discount: number; total: number; paymentMethod: PaymentMethod; status: 'COMPLETED'|'PARTIALLY_REFUNDED'|'REFUNDED'|'VOID'; customerName?: string; customerPhone?: string; note?: string; createdAt: string };
type SaleItem = { id: string; variantId: string; qty: number; unitPrice: number; unitCost?: number };
type Return = { id: string; saleId: string; items: { saleItemId: string; qty: number; restock: boolean }[]; refundAmount: number; refundMethod: PaymentMethod; reason: string; createdAt: string };
type Purchase = { id: string; supplierId?: string; invoiceRef?: string; items: { variantId: string; qty: number; unitCost: number }[]; total: number; receivedAt: string; createdBy: string };
type Supplier = { id: string; name: string; phone?: string; notes?: string };
type Settings = { storeName: string; logoUrl?: string; currency: string; timezone: string; lowStockDefault: number; saleNumberPrefix: string; sellerDiscountCapPct: number; sizePresets: string[]; colorPresets: { name: string; hex: string }[]; receiptHeader?: string; receiptFooter?: string };
type DashboardKpis = { totalCash: number; cashByMethod: Record<PaymentMethod, number>; grossProfit: number; marginPct: number; cogs: number; unitsInStock: number; skusInStock: number; stockValueCost: number; stockValueRetail: number; salesCount: number; avgBasket: number; lowStockCount: number; outOfStockCount: number };
type Paginated<T> = { data: T[]; page: number; pageSize: number; total: number };
```

## 10. API the frontend will call (mock these in `lib/api.ts`)
All JSON, cookie session, base `/api/v1`. Errors: `{ error: { code, message, fields? } }`.
- `POST /auth/login` · `POST /auth/logout` · `POST /auth/forgot` · `POST /auth/reset` · `GET /auth/me` · `POST /setup` (first run)
- `GET /products?q&brandId&categoryId&size&color&stock=in|low|out&minPrice&maxPrice&status&sort&page&pageSize` · `POST /products` · `GET /products/:id` · `PATCH /products/:id` · `POST /products/:id/archive` · `POST /products/import` · `GET /products/export`
- `GET /products/:id/variants` · `POST /products/:id/variants` (bulk create from sizes×colors) · `PATCH /variants/:id` · `DELETE /variants/:id` · `GET /variants/lookup?barcode|sku`
- `GET /stock/movements?variantId&type&from&to&page` · `POST /stock/adjustments` · `POST /stock/purchases` · `GET /stock/purchases` · `GET /stock/low` · `POST /stock/counts` · `PATCH /stock/counts/:id` · `POST /stock/counts/:id/apply`
- `POST /sales` · `GET /sales?from&to&sellerId&paymentMethod&status&page` · `GET /sales/:id` · `POST /sales/:id/void` · `POST /sales/:id/returns` · `GET /sales/:id/receipt`
- `GET /analytics/dashboard?from&to` · `GET /analytics/sales-trend?from&to&interval` · `GET /analytics/brands?from&to` · `GET /analytics/categories` · `GET /analytics/top-products?by=units|revenue` · `GET /analytics/top-variants` · `GET /analytics/slow-movers?days` · `GET /analytics/size-color` · `GET /analytics/sellers?from&to` · `GET /analytics/returns` · `GET /analytics/payment-mix` · `GET /analytics/export?report`
- `GET/POST/PATCH /brands`, `/categories`, `/suppliers`
- `GET /users` · `POST /users` · `PATCH /users/:id` · `POST /users/:id/disable` · `POST /users/:id/reset-password` · `POST /users/:id/revoke-sessions`
- `GET /settings` · `PATCH /settings`
- `GET /audit?q&userId&entity&from&to&page`
- `GET /notifications` · `POST /notifications/:id/read`

## 11. Deliverables checklist (confirm each at the end)
- [ ] Token file + Tailwind config (light & dark)
- [ ] Component library (§4) with stories/examples page
- [ ] All 29 screens/areas (§6) at mobile, tablet, desktop
- [ ] Role-aware navigation + View-as-seller + role switcher
- [ ] Loading / empty / error / offline states everywhere
- [ ] POS flow fully interactive with mock cart state
- [ ] Variant matrix editor fully interactive
- [ ] Charts with accessible number fallbacks
- [ ] Mock data + typed `lib/api.ts`
- [ ] PWA manifest + install prompt + offline page + print styles
- [ ] A `FRONTEND-HANDOFF.md` describing folder structure, how each screen maps to endpoints, and what to replace when wiring real APIs

Start by showing the token palette and the app shell at three breakpoints, then build the component library, then every screen in the order listed. Do not skip screens; if you must summarise, summarise the least important ones (labels, notifications) last.
