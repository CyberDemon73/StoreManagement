/**
 * Typed API client. Every screen talks to the backend only through this module.
 *
 *   USE_MOCK = true  → calls go to the in-memory store in src/mock/store.ts (with latency,
 *                      seller field stripping and simulated failure modes).
 *   USE_MOCK = false → calls go to fetch(`/api/v1${path}`) with the cookie session.
 *
 * Each method documents the REST endpoint it maps to (docs/API-SPEC.md). When wiring the
 * real backend, flip USE_MOCK and delete the mock branch; signatures stay the same.
 */
import * as store from '@/mock/store';
import { MockError } from '@/mock/store';
import type {
  AdjustmentReason, ApiErrorBody, ApiErrorCode, AuditEntry, Brand, BrandSplit, Cart, Category, CategoryStats,
  ColorRef, DashboardData, MovementType, Notification, Paginated, ParkedSale, PaymentMethod, PaymentMix, Product,
  ProductDetail, ProductListItem, Purchase, ReturnsReport, Role, Sale, SellerStats, Settings, SizeColorMatrix, SlowMover,
  StockCount, StockMovement, Supplier, TopProduct, TrendPoint, User, Variant, VariantWithProduct,
} from '@/types';

/**
 * Routes that exist on the backend are called for real; everything else still goes to the mock
 * store. Add a prefix here as each backend sprint lands (Sprint 2: /stock, 3: /sales, 4: /analytics,
 * 5: /users /settings /audit /notifications /me, 6: import/export). NEXT_PUBLIC_USE_MOCK=1 forces
 * the mock everywhere for a demo without a database.
 */
export const USE_MOCK_ALL = process.env.NEXT_PUBLIC_USE_MOCK === '1';
const LIVE_PREFIXES = ['/auth/', '/setup', '/products', '/variants', '/brands', '/categories', '/suppliers', '/uploads', '/stock', '/sales', '/analytics', '/users', '/settings', '/audit', '/notifications', '/me/password', '/me'];
const MOCK_ONLY = [/^\/products\/(export|import)/, /^\/variants\/[^/]+\/sold/];
export function isLive(path: string): boolean {
  if (USE_MOCK_ALL) return false;
  if (MOCK_ONLY.some((r) => r.test(path))) return false;
  return LIVE_PREFIXES.some((p) => path === p || path.startsWith(p));
}
const BASE = '/api/v1';

export interface ImportRowError { row: number; message: string; data: Record<string, string> }
export interface ImportPreview { rows: number; ok: number; errors: ImportRowError[] }
export interface ImportCommit extends ImportPreview { created: { products: number; variants: number } }

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public status: number, public fields?: Record<string, string>, public retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/* ---------- client context (who is calling) ---------- */
interface ClientContext { userId: string; role: Role }
let ctx: ClientContext = { userId: 'anon', role: 'SELLER' };
export function setApiContext(next: ClientContext) { ctx = next; }

/* ---------- mock controls (used by the States gallery and tests) ---------- */
export const mockControls = {
  latency: [120, 420] as [number, number],
  /** When set, the next N calls fail with this code. */
  failNext: 0,
  failCode: 'INTERNAL' as ApiErrorCode,
  offline: false,
};

const STRIP_FOR_SELLER = new Set(['costPrice', 'defaultCost', 'unitCost', 'margin', 'marginPct', 'profit', 'stockValueCost', 'cogs', 'cost', 'valueAtCost', 'grossProfit']);
function stripForSeller<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripForSeller) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!STRIP_FOR_SELLER.has(k)) out[k] = stripForSeller(v);
    return out as T;
  }
  return value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mock<T>(fn: () => T): Promise<T> {
  const [a, b] = mockControls.latency;
  await sleep(a + Math.random() * (b - a));
  if (mockControls.offline || (typeof navigator !== 'undefined' && !navigator.onLine)) throw new ApiError('OFFLINE', "You're offline", 0);
  if (mockControls.failNext > 0) { mockControls.failNext--; throw new ApiError(mockControls.failCode, 'The server returned an error (500). Nothing was changed.', 500); }
  try {
    const result = fn();
    // Deep-clone so screens never hold references into the store.
    const cloned = JSON.parse(JSON.stringify(result)) as T;
    return ctx.role === 'SELLER' ? stripForSeller(cloned) : cloned;
  } catch (e) {
    if (e instanceof MockError) throw new ApiError(e.code as ApiErrorCode, e.message, e.status, e.fields, e.retryAfter);
    throw e;
  }
}

async function request<T>(method: string, path: string, body?: unknown, query?: Record<string, unknown>, extraHeaders?: Record<string, string>): Promise<T> {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString() : '';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs}`, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-Requested-With': 'AvenueStock', ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('OFFLINE', "You're offline", 0);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T | ApiErrorBody;
  if (!res.ok) { const e = (data as ApiErrorBody).error; throw new ApiError(e?.code ?? 'INTERNAL', e?.message ?? res.statusText, res.status, e?.fields, e?.retryAfter); }
  return data as T;
}

async function requestMultipart<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'AvenueStock' }, body: form });
  } catch {
    throw new ApiError('OFFLINE', "You're offline", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T | ApiErrorBody;
  if (!res.ok) { const e = (data as ApiErrorBody).error; throw new ApiError(e?.code ?? 'INTERNAL', e?.message ?? res.statusText, res.status, e?.fields, e?.retryAfter); }
  return data as T;
}

const call = <T>(mockFn: () => T, method: string, path: string, body?: unknown, query?: Record<string, unknown>, extraHeaders?: Record<string, string>): Promise<T> =>
  isLive(path) ? request<T>(method, path, body, query, extraHeaders) : mock(mockFn);

/** Keep only the keys a strict Zod body accepts (unknown keys are a 400). */
const pick = <T extends object>(obj: T, keys: (keyof T)[]): Partial<T> => {
  const out: Partial<T> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};
const httpsOnly = (urls: string[] | undefined) => urls?.filter((u) => u.startsWith('https://'));
/** The API returns a single role; the UI models the roles a user may act as. */
const withRoles = (u: User & { roles?: Role[]; lastLoginAt?: string | null }): User => ({ ...u, roles: u.roles ?? [u.role], lastLoginAt: u.lastLoginAt ?? undefined });

/* =========================================================================================
 * API surface
 * ======================================================================================= */
export const api = {
  auth: {
    /** POST /auth/login */
    login: async (email: string, password: string, remember = false) => {
      try {
        const r = await call<{ user: User }>(() => ({ user: store.login(email, password) }), 'POST', '/auth/login', { email, password, remember });
        return { user: withRoles(r.user) };
      } catch (e) {
        // The server answers 403 FORBIDDEN "Account disabled" for a disabled user. Other 403s (for
        // example the CSRF origin check when APP_URL does not match the page origin) keep their message.
        if (e instanceof ApiError && e.code === 'FORBIDDEN' && /disabled/i.test(e.message)) throw new ApiError('ACCOUNT_DISABLED', e.message, e.status);
        throw e;
      }
    },
    /** POST /auth/logout */
    logout: () => call<void>(() => undefined, 'POST', '/auth/logout'),
    /** GET /auth/me */
    me: async () => {
      const r = await call<{ user: User; permissions: string[] } | null>(() => null, 'GET', '/auth/me');
      return r ? { user: withRoles(r.user), permissions: r.permissions } : null;
    },
    /** POST /auth/forgot */
    forgot: (email: string) => call<void>(() => undefined, 'POST', '/auth/forgot', { email }),
    /** POST /auth/reset */
    reset: (token: string, password: string) => call<void>(() => undefined, 'POST', '/auth/reset', { token, password }),
    /** POST /setup */
    setup: (input: { name: string; email: string; password: string; storeName: string; currency: string; setupToken: string }) => call<{ user: User }>(() => ({ user: store.listUsers()[0]! }), 'POST', '/setup', input),
    /** POST /me/password */
    /** POST /me/password → 204; rotates the session cookie. */
    changePassword: (current: string, next: string) => call<void>(() => undefined, 'POST', '/me/password', { current, next }),
    /** POST /auth/accept-invite → 200 { user } + cookie. */
    acceptInvite: (token: string, password: string) => call<{ user: User }>(() => ({ user: store.listUsers()[0]! }), 'POST', '/auth/accept-invite', { token, password }),
    /** PATCH /me → updated user */
    updateMe: (patch: { name: string }) => call<User>(() => ({ ...store.listUsers()[0]!, name: patch.name }), 'PATCH', '/me', patch),
  },

  products: {
    /** GET /products */
    list: (params: store.ProductListParams = {}) => call<Paginated<ProductListItem>>(() => store.listProducts(params), 'GET', '/products', undefined, params as Record<string, unknown>),
    /** GET /products/:id */
    get: (id: string) => call<ProductDetail>(() => store.getProduct(id), 'GET', `/products/${id}`),
    /** POST /products */
    create: (input: store.CreateProductInput) => call<ProductDetail>(() => store.createProduct(input, ctx.userId), 'POST', '/products', { ...input, images: httpsOnly(input.images), baseSku: input.baseSku || undefined, description: input.description || undefined }),
    /** PATCH /products/:id */
    update: (id: string, patch: Partial<Omit<Product, 'id'>>) => call<ProductDetail>(() => store.updateProduct(id, patch, ctx.userId), 'PATCH', `/products/${id}`, { ...pick(patch, ['name', 'brandId', 'categoryId', 'description', 'baseSku', 'defaultCost', 'defaultPrice', 'tags']), ...(patch.images ? { images: httpsOnly(patch.images) } : {}) }),
    /** POST /products/:id/archive | /unarchive */
    archive: (id: string, archive = true) => call<ProductDetail>(() => store.archiveProduct(id, ctx.userId, archive), 'POST', `/products/${id}/${archive ? 'archive' : 'unarchive'}`),
    /** POST /products/:id/variants */
    addVariants: (id: string, input: NonNullable<store.CreateProductInput['variants']>) => call<Variant[]>(() => store.addVariants(id, input, ctx.userId), 'POST', `/products/${id}/variants`, input),
    /** GET /products/export → CSV stream. Returns a blob: URL ready to download. */
    exportCsv: async (): Promise<string> => {
      if (!isLive('/products/export')) return 'data:text/csv,' + encodeURIComponent('id,name,baseSku\n' + store.raw.products.map((p) => `${p.id},${p.name},${p.baseSku}`).join('\n'));
      const res = await fetch('/api/v1/products/export', { credentials: 'same-origin', headers: { 'X-Requested-With': 'AvenueStock' } });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new ApiError(e.error?.code ?? 'INTERNAL', e.error?.message ?? res.statusText, res.status); }
      return URL.createObjectURL(await res.blob());
    },
  },

  variants: {
    /** PATCH /variants/:id (never quantity — use stock.adjust) */
    update: (id: string, patch: Partial<Pick<Variant, 'sellPrice' | 'costPrice' | 'lowStockThreshold' | 'barcode' | 'isActive' | 'sku'>>) => call<Variant>(() => store.updateVariant(id, patch, ctx.userId), 'PATCH', `/variants/${id}`, pick(patch, ['sellPrice', 'costPrice', 'lowStockThreshold', 'barcode', 'isActive', 'sku'])),
    /** GET /variants/lookup?barcode|sku */
    lookup: (q: { barcode?: string; sku?: string }) => call<VariantWithProduct>(() => store.lookupVariant(q), 'GET', '/variants/lookup', undefined, q),
    /** GET /products?q (variant-level search used by POS, receive, adjust, labels) */
    search: (q: string, limit = 20) => call<VariantWithProduct[]>(() => store.searchVariants(q, limit), 'GET', '/variants/search', undefined, { q, limit }),
  },

  catalog: {
    /** GET /brands */
    brands: () => call<Brand[]>(() => store.listBrands(), 'GET', '/brands'),
    /** POST|PATCH /brands */
    saveBrand: (input: Partial<Brand> & { name: string }) => call<Brand>(() => store.upsertBrand(input), input.id ? 'PATCH' : 'POST', input.id ? `/brands/${input.id}` : '/brands', { ...pick(input, ['name', 'isActive']), ...(input.logoUrl?.startsWith('https://') ? { logoUrl: input.logoUrl } : {}) }),
    /** GET /categories */
    categories: () => call<Category[]>(() => store.listCategories(), 'GET', '/categories'),
    saveCategory: (input: Partial<Category> & { name: string; parentId?: string | null }) => call<Category>(() => store.upsertCategory({ ...input, parentId: input.parentId ?? undefined }), input.id ? 'PATCH' : 'POST', input.id ? `/categories/${input.id}` : '/categories', pick(input, ['name', 'parentId', 'isActive'])),
    /** GET /suppliers */
    suppliers: () => call<Supplier[]>(() => store.listSuppliers(), 'GET', '/suppliers'),
    saveSupplier: (input: Partial<Supplier> & { name: string }) => call<Supplier>(() => store.upsertSupplier(input), input.id ? 'PATCH' : 'POST', input.id ? `/suppliers/${input.id}` : '/suppliers', pick(input, ['name', 'phone', 'notes', 'isActive'])),
  },

  stock: {
    /** GET /stock/movements */
    movements: (params: store.MovementParams = {}) => call<Paginated<StockMovement>>(() => store.listMovements(params), 'GET', '/stock/movements', undefined, params as Record<string, unknown>),
    /** POST /stock/adjustments */
    adjust: (items: store.AdjustmentInput[]) => call<StockMovement[]>(() => store.createAdjustments(items, ctx.userId), 'POST', '/stock/adjustments', { items }),
    /** POST /stock/purchases */
    receive: (input: store.PurchaseInput) => call<Purchase>(() => store.createPurchase(input, ctx.userId), 'POST', '/stock/purchases', input),
    /** GET /stock/purchases */
    purchases: (page = 1, pageSize = 25) => call<Paginated<Purchase>>(() => store.listPurchases(page, pageSize), 'GET', '/stock/purchases', undefined, { page, pageSize }),
    /** GET /stock/low */
    low: () => call<{ low: VariantWithProduct[]; out: VariantWithProduct[] }>(() => store.lowStock(), 'GET', '/stock/low'),
    /** Units sold in the last N days for a variant (derived from GET /sales). */
    soldLast: (variantId: string, days: number) => call<number>(() => store.soldLast(variantId, days), 'GET', `/variants/${variantId}/sold`, undefined, { days }),
    /** GET /stock/counts */
    counts: () => call<StockCount[]>(() => store.listCounts(), 'GET', '/stock/counts'),
    /** GET /stock/counts/:id */
    count: (id: string) => call<StockCount>(() => store.getCount(id), 'GET', `/stock/counts/${id}`),
    /** POST /stock/counts */
    startCount: (scope: string, productIds?: string[]) => call<StockCount>(() => store.startCount(scope, productIds, ctx.userId), 'POST', '/stock/counts', { scope, productIds }),
    /** PATCH /stock/counts/:id */
    saveCounts: (id: string, items: { variantId: string; countedQty: number }[]) => call<StockCount>(() => store.saveCountItems(id, items, ctx.userId), 'PATCH', `/stock/counts/${id}`, { items }),
    /** POST /stock/counts/:id/apply */
    applyCount: (id: string, uncountedAsZero = false) => call<StockCount>(() => store.applyCount(id, ctx.userId, uncountedAsZero), 'POST', `/stock/counts/${id}/apply`, { uncountedAsZero }),
  },

  sales: {
    /** GET /sales (sellers: own only, enforced server-side) */
    list: (params: store.SaleParams = {}) => call<Paginated<Sale>>(() => store.listSales(ctx.role === 'SELLER' ? { ...params, sellerId: ctx.userId } : params), 'GET', '/sales', undefined, params as Record<string, unknown>),
    /** GET /sales/:id */
    get: (id: string) => call<Sale>(() => store.getSale(id), 'GET', `/sales/${id}`),
    /** POST /sales — server recomputes totals; the cart is a hint. */
    /**
     * POST /sales — the server recomputes totals; the cart is a hint. The UI keeps the discount
     * value in pounds for PCT/AMOUNT typing; the API takes AMOUNT in minor units. A seller over
     * the cap gets 400 fields.discount, so the clamped preview value is what gets sent.
     * `idempotencyKey` (uuid) must be reused when the same checkout is retried.
     */
    create: (cart: Cart, idempotencyKey?: string) => {
      const preview = store.computeCart(cart, ctx.role);
      const discount = cart.discount.type === 'AMOUNT'
        ? { type: 'AMOUNT' as const, value: Math.min(Math.round(cart.discount.value * 100), preview.subtotal) }
        : { type: 'PCT' as const, value: preview.capHit ? preview.cap : cart.discount.value };
      const body = { items: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })), discount: discount.value > 0 ? discount : undefined, paymentMethod: cart.paymentMethod, customerName: cart.customerName || undefined, customerPhone: cart.customerPhone || undefined, note: cart.note || undefined };
      return call<Sale>(() => store.createSale(cart, ctx.userId, ctx.role), 'POST', '/sales', body, undefined, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    },
    /** Client-side preview of what the server will compute (same rules). */
    preview: (cart: Cart) => store.computeCart(cart, ctx.role),
    /** POST /sales/:id/void */
    void: (id: string, reason: string) => call<Sale>(() => store.voidSale(id, reason, ctx.userId), 'POST', `/sales/${id}/void`, { reason }),
    /** POST /sales/:id/returns */
    /** POST /sales/:id/returns — refund amounts come back from the server (`returns[].refundAmount`); never recompute them client-side. */
    createReturn: (id: string, input: store.ReturnInput, idempotencyKey?: string) => call<Sale>(() => store.createReturn(id, input, ctx.userId), 'POST', `/sales/${id}/returns`, { items: input.items.filter((i) => i.qty > 0), refundMethod: input.refundMethod, reason: input.reason, note: input.note || undefined }, undefined, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
    /** GET /sales/parked */
    parked: () => call<ParkedSale[]>(() => store.listParked(), 'GET', '/sales/parked'),
    /** POST /sales/parked */
    park: (cart: Cart, label: string) => call<ParkedSale>(() => store.parkSale(cart, label), 'POST', '/sales/parked', { cart, label }),
    /** Sales list: the server scopes sellers to their own sales; `sellerId` is only sent for managers. */
    /** DELETE /sales/parked/:id (returns the cart to resume) */
    unpark: (id: string) => call<ParkedSale>(() => store.unparkSale(id), 'DELETE', `/sales/parked/${id}`),
  },

  analytics: {
    /** GET /analytics/dashboard?from&to */
    dashboard: (from: string, to: string) => call<DashboardData>(() => store.dashboard(from, to), 'GET', '/analytics/dashboard', undefined, { from, to }),
    /** GET /analytics/sales-trend */
    trend: (from: string, to: string, interval: 'day' | 'week' | 'month' = 'day') => call<TrendPoint[]>(() => store.salesTrend(from, to, interval), 'GET', '/analytics/sales-trend', undefined, { from, to, interval }),
    /** GET /analytics/brands */
    brands: (from: string, to: string) => call<BrandSplit[]>(() => store.brandSplit(from, to), 'GET', '/analytics/brands', undefined, { from, to }),
    /** GET /analytics/categories */
    categories: (from: string, to: string) => call<CategoryStats[]>(() => store.categoryStats(from, to), 'GET', '/analytics/categories', undefined, { from, to }),
    /** GET /analytics/top-products */
    topProducts: (from: string, to: string, by: 'units' | 'revenue' | 'profit' = 'units', limit = 10) => call<TopProduct[]>(() => store.topProducts(from, to, by, limit), 'GET', '/analytics/top-products', undefined, { from, to, by, limit }),
    /** GET /analytics/slow-movers?days */
    slowMovers: (days = 60) => call<SlowMover[]>(() => store.slowMovers(days), 'GET', '/analytics/slow-movers', undefined, { days }),
    /** GET /analytics/size-color */
    sizeColor: (brandId?: string, from?: string, to?: string) => call<SizeColorMatrix>(() => store.sizeColor(brandId, from, to), 'GET', '/analytics/size-color', undefined, { brandId, from, to }),
    /** GET /analytics/sellers */
    sellers: (from: string, to: string) => call<SellerStats[]>(() => store.sellers(from, to), 'GET', '/analytics/sellers', undefined, { from, to }),
    /** GET /analytics/returns */
    returns: (from: string, to: string) => call<ReturnsReport>(() => store.returnsReport(from, to), 'GET', '/analytics/returns', undefined, { from, to }),
    /** GET /analytics/payment-mix */
    paymentMix: (from: string, to: string) => call<PaymentMix[]>(() => store.paymentMix(from, to), 'GET', '/analytics/payment-mix', undefined, { from, to }),
    /** GET /analytics/export?report= → CSV */
    exportCsv: (report: string, from: string, to: string) => call<string>(() => `data:text/csv,${encodeURIComponent(`report,from,to\n${report},${from},${to}`)}`, 'GET', '/analytics/export', undefined, { report, from, to }),
  },

  uploads: {
    /** POST /uploads (multipart `file`, ≤ 4 MB, jpeg/png/webp) → { url }. Mock keeps a local object URL. */
    image: (file: File): Promise<{ url: string }> => {
      if (!isLive('/uploads')) return mock(() => ({ url: URL.createObjectURL(file) }));
      const form = new FormData();
      form.append('file', file);
      return requestMultipart<{ url: string }>('/uploads', form);
    },
  },

  users: {
    /** GET /users */
    list: () => call<User[]>(() => store.listUsers(), 'GET', '/users'),
    /** POST /users */
    /** POST /users → 201 { user, temporaryPassword? } (TEMP only, shown once). */
    create: (input: { name: string; email: string; role: Role; mode: 'INVITE' | 'TEMP' }) => call<{ user: User; temporaryPassword?: string }>(() => ({ user: store.createUser(input, ctx.userId) }), 'POST', '/users', input),
    /** PATCH /users/:id */
    update: (id: string, patch: Partial<Pick<User, 'name' | 'role'>>) => call<User>(() => store.updateUser(id, patch, ctx.userId), 'PATCH', `/users/${id}`, pick(patch, ['name', 'role'])),
    /** POST /users/:id/disable | /enable */
    setEnabled: (id: string, enabled: boolean) => call<User>(() => store.updateUser(id, { status: enabled ? 'ACTIVE' : 'DISABLED' }, ctx.userId), 'POST', `/users/${id}/${enabled ? 'enable' : 'disable'}`),
    /** POST /users/:id/reset-password */
    resetPassword: (id: string, mode: 'EMAIL' | 'TEMP') => call<{ temporaryPassword?: string }>(() => ({}), 'POST', `/users/${id}/reset-password`, { mode }),
    /** POST /users/:id/revoke-sessions */
    revokeSessions: (id: string) => call<User>(() => store.revokeSessions(id), 'POST', `/users/${id}/revoke-sessions`),
  },

  settings: {
    /** GET /settings */
    get: () => call<Settings>(() => store.getSettings(), 'GET', '/settings'),
    /** PATCH /settings */
    /** PATCH /settings is strict: lockoutEnabled, passwordRotationDays, nextSaleNumber are read-only. */
    update: (patch: Partial<Settings>) => {
      const { lockoutEnabled, passwordRotationDays, nextSaleNumber, ...body } = patch as Settings & Record<string, unknown>;
      void lockoutEnabled; void passwordRotationDays; void nextSaleNumber;
      return call<Settings>(() => store.updateSettings(patch, ctx.userId), 'PATCH', '/settings', body);
    },
    /**
     * POST /products/import?dryRun=1 (multipart `file`) → 200 preview with row errors.
     * File-level problems (> 2 MB, > 5,000 rows, missing columns, not text) → 400 with
     * `fields.file`. Row 2 is the first data row in the error coordinates.
     */
    importPreview: (file: File): Promise<ImportPreview> => {
      if (!isLive('/products')) return mock(() => ({ rows: 40, ok: 37, errors: [
        { row: 7, message: 'Unknown brand', data: { name: 'Chino Slim', brand: 'Northlne', category: 'Men/Trousers', size: '32', color: 'Sand', colorHex: '#C8B89A', price: '1090.00', cost: '510.00', qty: '4', barcode: '' } },
        { row: 23, message: 'Price not a number (use 1090.50 — no thousands separators, at most 2 decimals)', data: { name: 'Canvas Low Sneaker', brand: 'Casa Lino', category: 'Shoes', size: '42', color: 'White', colorHex: '#FFFFFF', price: 'abc', cost: '640.00', qty: '6', barcode: '' } },
        { row: 31, message: 'Ambiguous category — use the full path, e.g. Men/Shirts', data: { name: 'Oxford Shirt', brand: 'Northline', category: 'Shirts', size: 'L', color: 'White', colorHex: '#FFFFFF', price: '690.00', cost: '320.00', qty: '2', barcode: '' } },
      ] }));
      const form = new FormData(); form.append('file', file);
      return requestMultipart<ImportPreview>('/products/import?dryRun=1', form);
    },
    /**
     * POST /products/import (multipart `file`) → 201 commit. The server runs the whole file in
     * a transaction: 400 means nothing was written (and the body carries the same row errors
     * so the UI can show them without a second preview call).
     */
    importCommit: (file: File): Promise<ImportCommit> => {
      if (!isLive('/products')) return mock(() => ({ rows: 40, ok: 40, errors: [], created: { products: 40, variants: 0 } }));
      const form = new FormData(); form.append('file', file);
      return requestMultipart<ImportCommit>('/products/import', form);
    },
  },

  audit: {
    /** GET /audit */
    list: (params: store.AuditParams = {}) => call<Paginated<AuditEntry>>(() => store.listAudit(params), 'GET', '/audit', undefined, params as Record<string, unknown>),
  },

  notifications: {
    /** GET /notifications */
    list: () => call<Notification[]>(() => store.listNotifications(), 'GET', '/notifications'),
    /** POST /notifications/:id/read | /notifications/read-all → 204. Server-side the mock still returns the list for the UI's optimistic update. */
    markRead: async (id?: string): Promise<Notification[]> => {
      if (!isLive('/notifications')) return mock(() => store.markRead(id));
      await request<void>('POST', id ? `/notifications/${id}/read` : '/notifications/read-all');
      return request<Notification[]>('GET', '/notifications');
    },
  },

  /** GET /labels?variantIds= */
  labels: (variantIds: string[]) => call<VariantWithProduct[]>(() => variantIds.map((id) => store.withProduct(store.raw.variants.find((v) => v.id === id)!)), 'GET', '/labels', undefined, { variantIds: variantIds.join(',') }),
};

export type Api = typeof api;
export type { AdjustmentReason, ColorRef, MovementType, PaymentMethod };
