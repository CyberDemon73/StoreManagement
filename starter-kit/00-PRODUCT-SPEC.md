# Avenue Stock — Product Specification

> Inventory, sales and reporting platform for a single-store retail business (fashion / apparel style stock with sizes and colors).
> Owner is ~40, wants something calm, clear and fast. Public-facing web app, free hosting, multiple user roles.

---

## 1. Your requirements, organized

### 1.1 Platform & hosting
| Requirement | Decision |
|---|---|
| Web platform, frontend + backend | **One Next.js (App Router) project.** Frontend pages + `app/api/*` route handlers in the same deploy. Avoids CORS, cookie-domain and double-deployment problems. |
| Runs free on Vercel | Vercel Hobby plan (personal use). Serverless/edge functions, free SSL, custom domain. |
| Free database | **Neon Postgres** (serverless Postgres, free tier, scales to zero, official Vercel integration). Alternative: Supabase Postgres (free tier, but projects pause after inactivity). |
| Free supporting services | **Upstash Redis** (free tier) for rate limiting + login lockouts. **Vercel Blob** or **Cloudinary** free tier for product images. **Resend** free tier for password-reset emails. |
| PWA | Installable on phone / iPad / desktop, offline shell, cached product catalogue (read-only when offline), queued sales when offline (phase 2). |
| Responsive | Mobile (≥360px), tablet/iPad (≥768px), desktop (≥1280px). Touch-first POS on mobile/tablet. |
| Security | Public URL ⇒ hardened by default. See §6. |
| Branding | Name: **Avenue Stock**. Quiet, calm colour palette. Mature but not old. |

### 1.2 Core functions (what you asked for)
1. **Products** — list all products in pages; search; filter; sort.
2. **Variants** — every product has **sizes × colors**; each combination has its own quantity, cost, price, SKU/barcode.
3. **CRUD** — add / edit / archive products, variants, brands, categories.
4. **Selling** — sell from stock (deduct the exact size+color variant), record who sold, when, for how much.
5. **Analysis / business analysis** — cost of goods, profit alone, total cash, number of items in stock, brand split, top-selling products, and more (see §4).
6. **Multi-user** — Admin, Manager, Seller. Admin = Manager for now (same permissions, separate labels so you can split later).
7. **Access matrix** — per role, per function, per page (see §3).
8. **Role switch** — Admin/Manager can "View as seller" to see exactly what sellers see (no permission change, just UI preview) and a **role switcher** for a user who holds both roles.
9. **Overall management** — totals, stock health, user management, settings.

---

## 2. Domain model (plain-language)

| Entity | What it is | Key fields |
|---|---|---|
| **User** | A person who logs in | name, email, role (ADMIN / MANAGER / SELLER), status (ACTIVE / DISABLED), lastLoginAt |
| **Brand** | e.g. Nike, Zara | name, logo (optional), isActive |
| **Category** | e.g. T-shirts, Shoes, Jackets | name, parent (optional, 1 level) |
| **Product** | The "style" | name, brand, category, description, baseSKU, images[], defaultCost, defaultPrice, status (ACTIVE / ARCHIVED), tags |
| **Variant** | One **size + color** of a product | size, color (name + hex), sku, barcode, costPrice, sellPrice, quantity, lowStockThreshold |
| **StockMovement** | Immutable ledger line — every change to a variant's quantity | variant, type (PURCHASE / SALE / RETURN / ADJUSTMENT / INITIAL), qtyDelta, unitCost, reference (saleId / purchaseId), reason, user, createdAt |
| **Sale** | A checkout | number (AS-000123), seller, items[], subtotal, discount, total, paymentMethod (CASH / CARD / WALLET / TRANSFER), status (COMPLETED / REFUNDED / PARTIALLY_REFUNDED / VOID), customerName/phone (optional), note |
| **SaleItem** | A line in a sale | variant, qty, unitPrice, unitCost (snapshot at sale time — this makes profit reporting exact) |
| **Return** | Items coming back | sale, items[], refundAmount, reason, restock (yes/no) |
| **Purchase** (recommended) | Goods received from a supplier | supplier, items[], unitCosts, total, receivedAt, invoiceRef |
| **Supplier** (recommended) | Who you buy from | name, phone, notes |
| **StockCount** (recommended) | Physical stock-take session | counted quantities vs system, variance, applied adjustments |
| **AuditLog** | Who did what | user, action, entity, before/after, ip, createdAt |
| **Settings** | Store config | storeName, currency (default EGP), lowStockDefault, receiptFooter, saleNumberPrefix, sizePresets[], colorPresets[] |

**Why a movement ledger?** Quantity is never edited directly. Every change is a movement. This gives you an audit trail, exact cost-of-goods (weighted average or FIFO), and lets analytics be recomputed at any time.

---

## 3. Roles & access matrix

Admin and Manager are **identical today**. Keep both labels so you can later remove things from Manager (e.g. user management, deleting data).

Legend: ✅ full · 👁 view only · ➖ none · ⚙ own records only

### 3.1 Pages
| Page | Admin | Manager | Seller |
|---|---|---|---|
| Dashboard (owner view: profit, cash, stock value) | ✅ | ✅ | ➖ |
| Seller Home (today's sales, quick sell, low stock) | ✅ | ✅ | ✅ |
| Products list / detail | ✅ | ✅ | 👁 (no cost price) |
| Product create / edit / archive | ✅ | ✅ | ➖ |
| Variants (sizes/colors) manage | ✅ | ✅ | ➖ |
| New Sale (POS) | ✅ | ✅ | ✅ |
| Sales history | ✅ | ✅ | ⚙ (own sales) |
| Sale detail / receipt | ✅ | ✅ | ⚙ |
| Returns / refunds | ✅ | ✅ | ⚙ create, needs no approval ≤ X (configurable) |
| Receive stock (purchases) | ✅ | ✅ | ➖ |
| Stock adjustments | ✅ | ✅ | ➖ |
| Stock movements ledger | ✅ | ✅ | ➖ |
| Stock count / stock-take | ✅ | ✅ | 👁 can count, cannot apply |
| Low stock / out of stock | ✅ | ✅ | 👁 |
| Analytics (all reports) | ✅ | ✅ | ➖ |
| Brands / Categories manage | ✅ | ✅ | ➖ |
| Suppliers | ✅ | ✅ | ➖ |
| Users & roles | ✅ | ✅ | ➖ |
| Settings | ✅ | ✅ | ➖ |
| Audit log | ✅ | ✅ | ➖ |
| Profile / change password | ✅ | ✅ | ✅ |
| View-as-seller toggle | ✅ | ✅ | ➖ |

### 3.2 Functions (API-level)
| Function | Admin | Manager | Seller |
|---|---|---|---|
| products.read | ✅ | ✅ | ✅ (costPrice stripped) |
| products.write / archive | ✅ | ✅ | ➖ |
| variants.write | ✅ | ✅ | ➖ |
| stock.receive / adjust | ✅ | ✅ | ➖ |
| stock.read (quantities) | ✅ | ✅ | ✅ |
| sales.create | ✅ | ✅ | ✅ |
| sales.read | ✅ | ✅ | own |
| sales.void | ✅ | ✅ | ➖ |
| sales.discount (max %) | any | any | ≤ 10% (configurable) |
| returns.create | ✅ | ✅ | ✅ (own sales) |
| analytics.read | ✅ | ✅ | ➖ |
| users.manage | ✅ | ✅ | ➖ |
| settings.write | ✅ | ✅ | ➖ |
| audit.read | ✅ | ✅ | ➖ |
| export.csv | ✅ | ✅ | ➖ |

Enforcement happens **in the backend** (middleware + per-handler check) — the UI just hides what the role can't use.

---

## 4. Analytics & business analysis (what the owner sees)

All reports accept a date range (today / 7d / 30d / month / custom) and respect the store's currency.

### 4.1 Headline KPIs (dashboard cards)
- **Total cash** — sum of completed sales total in range, split by payment method.
- **Gross profit** — Σ(unitPrice − unitCost) × qty over sale items in range, minus refunds.
- **Profit margin %** — profit / revenue.
- **Cost of goods sold (COGS)** — Σ unitCost × qty sold.
- **Items in stock** — Σ variant.quantity (units) and number of SKUs > 0.
- **Stock value at cost** — Σ quantity × costPrice.
- **Stock value at retail** — Σ quantity × sellPrice (potential revenue).
- **Sales count / average basket**.
- **Low stock count / out-of-stock count**.

### 4.2 Reports
| Report | Shows |
|---|---|
| Sales trend | Revenue, profit, # sales per day / week / month (line/bar) |
| Brand split | Units in stock, stock value, revenue, profit per brand (donut + table) |
| Category split | Same as brand, by category |
| Top-selling products | By units and by revenue, with margin |
| Top-selling variants | Which size/color actually sells |
| Slow movers / dead stock | No sales in N days, value tied up |
| Size & color distribution | Stock on hand by size and by color (heatmap) |
| Seller performance | Sales count, revenue, average basket, discount given, returns, per seller |
| Payment-method mix | Cash vs card vs wallet |
| Returns & refunds | Rate, reasons, value |
| Inventory movements | Purchases in vs sales out vs adjustments over time |
| Stock ageing | Days since received, bucketed |
| Price-list / margin table | Cost, price, margin % per variant (editable from here) |
| Exports | CSV for every table above; printable PDF summary of the dashboard |

---

## 5. Screens — required + recommended

### 5.1 Auth
- Login (email + password). **No public sign-up** — admins create users.
- Forgot / reset password (email link, 30-min token).
- First-run setup wizard (create the first admin, store name, currency) — only works when DB has zero users.
- Session expired / locked-out states.

### 5.2 Owner / Manager
- **Dashboard** — KPI cards, sales trend chart, brand donut, top products, low-stock list, recent sales.
- **Analytics** — tabs: Sales · Profit · Inventory · Brands · Sellers · Returns, each with date range, charts and export.
- **Products** — paged table on desktop / card grid on mobile; search (name, SKU, barcode, brand); filters (brand, category, size, color, stock status, price range, status); sort; bulk actions (archive, change category, print labels).
- **Product detail** — images, info, **variant matrix (sizes as rows × colors as columns)** with quantity per cell, inline edit of qty via adjustment, cost/price per variant, movement history tab, sales history tab.
- **Product create / edit** — multi-step on mobile, single page on desktop: basics → images → variants (pick sizes + colors ⇒ matrix generated) → pricing → review.
- **Variant editor** — add/remove size or color, set per-cell cost/price/threshold, generate SKUs/barcodes.
- **Receive stock (Purchase)** — pick supplier, scan/search variants, enter qty + unit cost, total; posting creates PURCHASE movements and updates weighted-average cost.
- **Stock adjustment** — single or bulk, reason required (damaged, lost, found, correction).
- **Stock movements ledger** — filterable timeline.
- **Stock count** — start a session, count (with barcode), see variance, apply.
- **Low stock / Out of stock** — list with "receive" shortcut.
- **Sales list** — filters: date, seller, payment, status; detail drawer with receipt, refund button, void (manager).
- **Returns** — from a sale: choose items, restock yes/no, refund method.
- **Brands & Categories** — simple CRUD with product counts.
- **Suppliers** — CRUD.
- **Users** — list, create (set temp password / send invite), change role, disable, reset password, see last login.
- **Settings** — store info, currency, tax (optional), low-stock default, size presets, color presets (name + hex), receipt template, seller discount cap, data export/backup.
- **Audit log** — searchable.
- **Barcode labels** — print sheet (A4 / thermal 40×30 mm) for selected variants.
- **Import** — CSV import of products + variants with preview and error rows.
- **Notifications** — in-app bell: low stock, large refund, new user login from new device.

### 5.3 Seller
- **Seller Home** — today's sales (own), quick "New sale" button, low-stock glance, recent own sales.
- **New Sale (POS)** — search / scan → pick size & color (shows available qty) → cart → discount (capped) → payment method → confirm → receipt (share / print / WhatsApp link).
- **Products (browse)** — same list, no cost price, quantities visible.
- **My Sales** — own history, receipt, start a return.
- **Profile** — change password, switch role (if user has more than one).

### 5.4 System / shared
- Responsive app shell: sidebar on desktop, bottom tab bar on mobile, collapsible rail on iPad.
- Global search (⌘K / search bar): products, SKUs, sales numbers.
- Role badge + "Viewing as Seller" banner when previewing.
- Empty, loading (skeleton), error and offline states for every page.
- PWA install prompt, offline banner, update-available toast.
- 404 / 403 pages.

---

## 6. Security baseline (public app)

- Passwords hashed with **Argon2id**; min 10 chars; breached-password check optional.
- **DB-backed sessions**, httpOnly + Secure + SameSite=Lax cookies, 12-h idle / 30-day absolute, server-side revoke.
- **No self-registration.** Invite/creation by Admin/Manager only.
- **RBAC enforced server-side** on every route; seller responses strip `costPrice`.
- **Rate limiting** (Upstash): login 5/min/IP + 10/hour/email, API 120/min/user. Account lockout 15 min after 10 failures.
- **Input validation** with Zod on every request body/query/params; reject unknown keys.
- **CSRF**: Origin/Referer check on mutations + SameSite cookie.
- **Security headers**: CSP, HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy.
- **Transactions** for every sale/return/adjustment (no negative stock, atomic).
- **Audit log** for all mutations.
- **Secrets** only in Vercel env vars; `.env.example` committed, `.env` never.
- Dependency audit in CI; Dependabot on.
- Optional later: TOTP 2FA for Admin, IP allow-list for Settings.

---

## 7. Non-functional
- P95 API < 400 ms on Neon free tier (keep queries indexed; paginate everything at 25/50/100).
- Lighthouse PWA ≥ 90, accessibility ≥ 90.
- Works on Safari iOS 16+, Chrome, Edge.
- All money stored as **integer minor units (piastres/cents)** to avoid float errors.
- Timezone: store setting (default Africa/Cairo); dates stored UTC.
- i18n-ready (English first; Arabic/RTL as a later phase).

---

## 8. Phasing
| Phase | Scope |
|---|---|
| **MVP (sprints 0–4)** | Auth, roles, products/variants, stock ledger, POS sales, returns, dashboard + core analytics, users, settings, PWA shell |
| **Phase 2** | Purchases/suppliers, stock count, barcode labels, CSV import, audit UI, notifications, offline queued sales |
| **Phase 3** | 2FA, Arabic/RTL, multi-branch, customer records & loyalty, WhatsApp receipts, scheduled email reports |
