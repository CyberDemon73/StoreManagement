/**
 * In-memory mock backend. Implements the semantics of docs/API-SPEC.md closely enough for the
 * UI to be fully interactive: sales reduce stock, purchases update average cost, adjustments
 * write movements, everything is audited. Replace by real routes via src/lib/api.ts.
 */
import * as D from './data';
import type {
  AdjustmentReason, AuditAction, AuditEntry, Brand, BrandSplit, Cart, Category, CategoryStats, ColorRef,
  DashboardData, DashboardKpis, MovementType, Notification, Paginated, ParkedSale, PaymentMethod, PaymentMix,
  Product, ProductDetail, ProductListItem, Purchase, Return, ReturnsReport, Sale, SaleItem, SellerStats, Settings,
  SizeColorMatrix, SlowMover, StockCount, StockMovement, Supplier, TopProduct, TrendPoint, User, Variant,
  VariantWithProduct, Role,
} from '@/types';
import { stockStatus } from '@/lib/format';

let counter = 50_000;
const uid = (p: string) => `${p}_${(counter++).toString(36)}`;
const nowIso = () => new Date().toISOString();

export class MockError extends Error {
  constructor(public code: string, message: string, public status: number, public fields?: Record<string, string>, public retryAfter?: number) {
    super(message);
  }
}
const notFound = (what: string) => new MockError('NOT_FOUND', `${what} not found`, 404);

/* ---------- lookups ---------- */
const product = (id: string) => D.products.find((p) => p.id === id) ?? (() => { throw notFound('Product'); })();
const variant = (id: string) => D.variants.find((v) => v.id === id) ?? (() => { throw notFound('Variant'); })();
const brandOf = (id: string) => D.brands.find((b) => b.id === id);
const categoryOf = (id: string) => D.categories.find((c) => c.id === id);
const userName = (id: string) => D.users.find((u) => u.id === id)?.name ?? 'System';

export function withProduct(v: Variant): VariantWithProduct {
  const p = product(v.productId);
  return { ...v, product: { id: p.id, name: p.name, baseSku: p.baseSku, images: p.images, brandName: brandOf(p.brandId)?.name ?? '', tint: D.productTint[p.id] ?? '#E6E3DC' } };
}

function listItem(p: Product): ProductListItem {
  const vs = D.variants.filter((v) => v.productId === p.id && v.isActive);
  const totalQty = vs.reduce((a, v) => a + v.quantity, 0);
  const lowCount = vs.filter((v) => stockStatus(v.quantity, v.lowStockThreshold) === 'low').length;
  const outCount = vs.filter((v) => v.quantity <= 0).length;
  const prices = vs.map((v) => v.sellPrice);
  const cost = p.defaultCost;
  return {
    ...p, brand: { id: p.brandId, name: brandOf(p.brandId)?.name ?? '' }, category: { id: p.categoryId, name: categoryOf(p.categoryId)?.name ?? '' },
    variantCount: vs.length, totalQty, lowCount, outCount, minPrice: Math.min(...prices, p.defaultPrice), maxPrice: Math.max(...prices, p.defaultPrice),
    lowStock: lowCount > 0 || outCount > 0, coverImage: p.images[0], marginPct: cost ? ((p.defaultPrice - cost) / p.defaultPrice) * 100 : undefined,
    tint: D.productTint[p.id] ?? '#E6E3DC',
  };
}

function audit(userId: string, action: AuditAction, entity: string, entityLabel: string, summary: string, extra: Partial<AuditEntry> = {}) {
  D.audit.unshift({ id: uid('au'), userId, userName: userName(userId), action, entity, entityLabel, summary, createdAt: nowIso(), ...extra });
}

/** The one place stock changes. Mirrors services/stock.ts applyMovement(). */
function applyMovement(v: Variant, type: MovementType, qtyDelta: number, userId: string, extra: Partial<StockMovement> = {}, unitCost?: number) {
  const next = v.quantity + qtyDelta;
  if (next < 0 && !D.settings.allowNegativeStock) {
    throw new MockError('INSUFFICIENT_STOCK', `Only ${v.quantity} left of ${v.sku}`, 409, { [v.id]: `Only ${v.quantity} available` });
  }
  if ((type === 'PURCHASE' || type === 'INITIAL') && unitCost !== undefined && qtyDelta > 0) {
    const old = Math.max(0, v.quantity);
    v.costPrice = Math.round((old * (v.costPrice ?? unitCost) + qtyDelta * unitCost) / (old + qtyDelta));
  }
  v.quantity = next;
  const p = product(v.productId);
  const mv: StockMovement = {
    id: uid('mv'), variantId: v.id, variant: { size: v.size, color: v.color, sku: v.sku, productName: p.name }, type, qtyDelta, qtyAfter: next,
    unitCost: unitCost ?? v.costPrice, userId, userName: userName(userId), createdAt: nowIso(), ...extra,
  };
  D.movements.push(mv);
  if (next <= v.lowStockThreshold && type === 'SALE') {
    D.notifications.unshift({ id: uid('n'), kind: 'LOW_STOCK', title: 'Low stock', body: `${p.name} · ${v.size} · ${v.color.name} is at ${next}.`, href: '/stock/low', actionLabel: 'Receive', createdAt: nowIso() });
  }
  return mv;
}

/* ---------- pagination helper ---------- */
function paginate<T>(rows: T[], page = 1, pageSize = 25): Paginated<T> {
  const size = Math.min(100, Math.max(1, pageSize));
  const start = (page - 1) * size;
  return { data: rows.slice(start, start + size), page, pageSize: size, total: rows.length };
}

/* =========================================================================================
 * Auth
 * ======================================================================================= */
export interface LoginResult { user: User; permissionsRole: Role }
export function login(email: string, password: string): User {
  const e = email.trim().toLowerCase();
  if (e === 'locked@avenue.eg') throw new MockError('LOCKED', 'Too many attempts — locked', 423, undefined, 720);
  if (e === 'ratelimited@avenue.eg') throw new MockError('RATE_LIMITED', 'Too many requests from this device', 429, undefined, 30);
  const u = D.users.find((x) => x.email === e);
  if (!u || password.length < 10 || password === 'wrong-password') throw new MockError('UNAUTHENTICATED', 'Wrong email or password', 401);
  if (u.status === 'DISABLED') throw new MockError('ACCOUNT_DISABLED', 'This account is disabled', 403);
  if (u.status === 'INVITED') throw new MockError('UNAUTHENTICATED', 'Finish setting your password from the invite link first', 401);
  u.lastLoginAt = nowIso();
  audit(u.id, 'auth.login', 'Session', 'Session', 'Signed in · this device');
  return { ...u };
}

/* =========================================================================================
 * Catalog
 * ======================================================================================= */
export interface ProductListParams {
  q?: string; brandId?: string; categoryId?: string; size?: string; color?: string; stock?: 'in' | 'low' | 'out';
  minPrice?: number; maxPrice?: number; status?: 'ACTIVE' | 'ARCHIVED' | 'ALL'; sort?: string; page?: number; pageSize?: number;
}
export function listProducts(params: ProductListParams = {}): Paginated<ProductListItem> {
  let rows = D.products.map(listItem);
  const status = params.status ?? 'ACTIVE';
  if (status !== 'ALL') rows = rows.filter((r) => r.status === status);
  if (params.q) {
    const q = params.q.trim().toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.baseSku.toLowerCase().includes(q) || r.brand.name.toLowerCase().includes(q)
      || D.variants.some((v) => v.productId === r.id && (v.sku.toLowerCase().includes(q) || v.barcode === q)));
  }
  if (params.brandId) rows = rows.filter((r) => r.brandId === params.brandId);
  if (params.categoryId) rows = rows.filter((r) => r.categoryId === params.categoryId);
  if (params.size) rows = rows.filter((r) => D.variants.some((v) => v.productId === r.id && v.size === params.size));
  if (params.color) rows = rows.filter((r) => D.variants.some((v) => v.productId === r.id && v.color.name === params.color));
  if (params.stock === 'low') rows = rows.filter((r) => r.lowCount > 0);
  if (params.stock === 'out') rows = rows.filter((r) => r.outCount > 0);
  if (params.stock === 'in') rows = rows.filter((r) => r.totalQty > 0);
  if (params.minPrice !== undefined) rows = rows.filter((r) => r.maxPrice >= params.minPrice!);
  if (params.maxPrice !== undefined) rows = rows.filter((r) => r.minPrice <= params.maxPrice!);
  const sort = params.sort ?? '-updated';
  const desc = sort.startsWith('-');
  const key = sort.replace(/^-/, '');
  rows.sort((a, b) => {
    const va = key === 'name' ? a.name : key === 'price' ? a.defaultPrice : key === 'qty' ? a.totalQty : a.updatedAt;
    const vb = key === 'name' ? b.name : key === 'price' ? b.defaultPrice : key === 'qty' ? b.totalQty : b.updatedAt;
    const c = va < vb ? -1 : va > vb ? 1 : 0;
    return desc ? -c : c;
  });
  return paginate(rows, params.page, params.pageSize);
}

export function getProduct(id: string): ProductDetail {
  const p = product(id);
  const vs = D.variants.filter((v) => v.productId === id);
  const since = Date.now() - 30 * 86_400_000;
  const sold = D.sales.filter((s) => s.status !== 'VOID' && new Date(s.createdAt).getTime() >= since).flatMap((s) => s.items).filter((i) => vs.some((v) => v.id === i.variantId)).reduce((a, i) => a + i.qty, 0);
  return { ...listItem(p), variants: vs, sizes: D.productSizes[id] ?? [...new Set(vs.map((v) => v.size))], colors: D.productColors[id] ?? uniqColors(vs.map((v) => v.color)), soldLast30d: sold };
}
function uniqColors(cs: ColorRef[]): ColorRef[] { const m = new Map(cs.map((c) => [c.name, c])); return [...m.values()]; }

export interface CreateProductInput {
  name: string; brandId: string; categoryId: string; description?: string; baseSku?: string; images?: string[]; defaultCost?: number; defaultPrice: number; tags?: string[];
  variants?: { sizes: string[]; colors: ColorRef[]; initialQty?: Record<string, number> | number; barcodes?: Record<string, string>; costPrice?: number; sellPrice?: number };
}
export function createProduct(input: CreateProductInput, userId: string): ProductDetail {
  const baseSku = input.baseSku?.trim() || `${(brandOf(input.brandId)?.name ?? 'XX').slice(0, 2).toUpperCase()}-${input.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}`;
  if (D.products.some((p) => p.baseSku === baseSku)) throw new MockError('CONFLICT', 'Base SKU already used', 409, { baseSku: 'Already used by another product' });
  const id = uid('p');
  const now = nowIso();
  const p: Product = { id, name: input.name, brandId: input.brandId, categoryId: input.categoryId, description: input.description, baseSku, images: input.images ?? [], defaultCost: input.defaultCost, defaultPrice: input.defaultPrice, status: 'ACTIVE', tags: input.tags ?? [], createdBy: userId, createdAt: now, updatedAt: now };
  D.products.push(p);
  D.productTint[id] = input.variants?.colors[0]?.hex ?? '#E6E3DC';
  if (input.variants) {
    D.productSizes[id] = input.variants.sizes;
    D.productColors[id] = input.variants.colors;
    addVariants(id, input.variants, userId);
  }
  audit(userId, 'product.create', 'Product', p.name, `${input.variants ? input.variants.sizes.length * input.variants.colors.length : 0} variants`);
  return getProduct(id);
}

export function updateProduct(id: string, patch: Partial<Omit<Product, 'id'>>, userId: string): ProductDetail {
  const p = product(id);
  const before = { ...p };
  Object.assign(p, patch, { updatedAt: nowIso() });
  audit(userId, 'product.update', 'Product', p.name, Object.keys(patch).join(', '), { before, after: { ...p } });
  return getProduct(id);
}

export function archiveProduct(id: string, userId: string, archive = true): ProductDetail {
  const p = product(id);
  p.status = archive ? 'ARCHIVED' : 'ACTIVE';
  p.updatedAt = nowIso();
  audit(userId, 'product.archive', 'Product', p.name, archive ? 'Archived' : 'Restored');
  return getProduct(id);
}

export function addVariants(productId: string, input: NonNullable<CreateProductInput['variants']>, userId: string): Variant[] {
  const p = product(productId);
  const made: Variant[] = [];
  for (const size of input.sizes) {
    for (const color of input.colors) {
      if (D.variants.some((v) => v.productId === productId && v.size === size && v.color.name === color.name)) continue;
      const v: Variant = { id: uid('v'), productId, size, color, sku: `${p.baseSku}-${size.replace(/\s+/g, '')}-${color.name.slice(0, 3).toUpperCase()}`, barcode: String(6220009000000 + counter), costPrice: input.costPrice ?? p.defaultCost, sellPrice: input.sellPrice ?? p.defaultPrice, quantity: 0, lowStockThreshold: D.settings.lowStockDefault, isActive: true };
      D.variants.push(v);
      const q = typeof input.initialQty === 'number' ? input.initialQty : input.initialQty?.[`${size}|${color.name}`] ?? 0;
      if (q > 0) applyMovement(v, 'INITIAL', q, userId, { reason: 'Product created' }, v.costPrice);
      made.push(v);
    }
  }
  D.productSizes[productId] = [...new Set([...(D.productSizes[productId] ?? []), ...input.sizes])];
  D.productColors[productId] = uniqColors([...(D.productColors[productId] ?? []), ...input.colors]);
  return made;
}

export function updateVariant(id: string, patch: Partial<Pick<Variant, 'sellPrice' | 'costPrice' | 'lowStockThreshold' | 'barcode' | 'isActive' | 'sku'>>, userId: string): Variant {
  const v = variant(id);
  const before = { ...v };
  Object.assign(v, patch);
  audit(userId, 'product.update', 'Variant', v.sku, Object.keys(patch).join(', '), { before, after: { ...v } });
  return { ...v };
}

export function lookupVariant(q: { barcode?: string; sku?: string }): VariantWithProduct {
  const v = D.variants.find((x) => (q.barcode && x.barcode === q.barcode) || (q.sku && x.sku.toLowerCase() === q.sku.toLowerCase()));
  if (!v) throw notFound('Variant');
  return withProduct(v);
}

export function searchVariants(q: string, limit = 20): VariantWithProduct[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return D.variants.filter((v) => { const p = product(v.productId); return p.status === 'ACTIVE' && (v.sku.toLowerCase().includes(s) || v.barcode === s || p.name.toLowerCase().includes(s)); }).slice(0, limit).map(withProduct);
}

export const listBrands = (): Brand[] => D.brands.map((b) => ({ ...b, productCount: D.products.filter((p) => p.brandId === b.id && p.status === 'ACTIVE').length, variantCount: D.variants.filter((v) => product(v.productId).brandId === b.id).length }));
export const listCategories = (): Category[] => D.categories.map((c) => ({ ...c, productCount: D.products.filter((p) => p.categoryId === c.id && p.status === 'ACTIVE').length }));
export const listSuppliers = (): Supplier[] => D.suppliers.map((s) => { const ps = D.purchases.filter((p) => p.supplierId === s.id); return { ...s, purchaseCount: ps.length, lastPurchaseAt: ps.at(-1)?.receivedAt }; });

export function upsertBrand(input: Partial<Brand> & { name: string }): Brand {
  if (input.id) { const b = D.brands.find((x) => x.id === input.id)!; Object.assign(b, input); return b; }
  const b: Brand = { id: uid('b'), name: input.name, isActive: true, logoUrl: input.logoUrl }; D.brands.push(b); return b;
}
export function upsertCategory(input: Partial<Category> & { name: string }): Category {
  if (input.id) { const c = D.categories.find((x) => x.id === input.id)!; Object.assign(c, input); return c; }
  const c: Category = { id: uid('c'), name: input.name, isActive: true, parentId: input.parentId }; D.categories.push(c); return c;
}
export function upsertSupplier(input: Partial<Supplier> & { name: string }): Supplier {
  if (input.id) { const s = D.suppliers.find((x) => x.id === input.id)!; Object.assign(s, input); return s; }
  const s: Supplier = { id: uid('s'), name: input.name, isActive: true, phone: input.phone, notes: input.notes }; D.suppliers.push(s); return s;
}

/* =========================================================================================
 * Stock
 * ======================================================================================= */
export interface MovementParams { variantId?: string; productId?: string; type?: MovementType; from?: string; to?: string; userId?: string; q?: string; page?: number; pageSize?: number }
export function listMovements(params: MovementParams = {}): Paginated<StockMovement> {
  let rows = [...D.movements].reverse();
  if (params.variantId) rows = rows.filter((m) => m.variantId === params.variantId);
  if (params.productId) rows = rows.filter((m) => variant(m.variantId).productId === params.productId);
  if (params.type) rows = rows.filter((m) => m.type === params.type);
  if (params.userId) rows = rows.filter((m) => m.userId === params.userId);
  if (params.from) rows = rows.filter((m) => m.createdAt >= params.from!);
  if (params.to) rows = rows.filter((m) => m.createdAt.slice(0, 10) <= params.to!);
  if (params.q) { const q = params.q.toLowerCase(); rows = rows.filter((m) => m.variant.sku.toLowerCase().includes(q) || m.variant.productName.toLowerCase().includes(q) || m.reference?.label.toLowerCase().includes(q)); }
  return paginate(rows, params.page, params.pageSize);
}

export interface AdjustmentInput { variantId: string; qtyDelta?: number; newQty?: number; reason: AdjustmentReason; note?: string }
export function createAdjustments(items: AdjustmentInput[], userId: string): StockMovement[] {
  const out: StockMovement[] = [];
  for (const it of items) {
    const v = variant(it.variantId);
    const delta = it.newQty !== undefined ? it.newQty - v.quantity : it.qtyDelta ?? 0;
    if (delta === 0) continue;
    const before = v.quantity;
    out.push(applyMovement(v, 'ADJUSTMENT', delta, userId, { reason: it.reason + (it.note ? ` · “${it.note}”` : '') }));
    audit(userId, 'variant.adjust', 'Variant', v.sku, `Quantity ${before} → ${v.quantity} · ${it.reason}${it.note ? ` · “${it.note}”` : ''}`, { before: { quantity: before }, after: { quantity: v.quantity } });
  }
  return out;
}

export interface PurchaseInput { supplierId?: string; invoiceRef?: string; receivedAt?: string; note?: string; items: { variantId: string; qty: number; unitCost: number }[] }
export function createPurchase(input: PurchaseInput, userId: string): Purchase {
  if (!input.items.length) throw new MockError('VALIDATION', 'Add at least one line', 400, { items: 'Add at least one line' });
  const id = uid('po');
  const number = `PO-${String(148 + D.purchases.length - 6).padStart(4, '0')}`;
  const at = input.receivedAt ?? nowIso();
  for (const it of input.items) applyMovement(variant(it.variantId), 'PURCHASE', it.qty, userId, { reference: { kind: 'purchase', id, label: `${number}${input.invoiceRef ? ' · ' + input.invoiceRef : ''}` }, createdAt: at }, it.unitCost);
  const total = input.items.reduce((a, i) => a + i.qty * i.unitCost, 0);
  const po: Purchase = { id, number, supplierId: input.supplierId, supplierName: D.suppliers.find((s) => s.id === input.supplierId)?.name, invoiceRef: input.invoiceRef, items: input.items, lineCount: input.items.length, unitCount: input.items.reduce((a, i) => a + i.qty, 0), total, receivedAt: at, createdBy: userId, createdByName: userName(userId), note: input.note };
  D.purchases.push(po);
  audit(userId, 'purchase.post', 'Purchase', number, `${po.unitCount} units · ${total / 100}`);
  return po;
}
export const listPurchases = (page = 1, pageSize = 25): Paginated<Purchase> => paginate([...D.purchases].reverse(), page, pageSize);

export function lowStock(): { low: VariantWithProduct[]; out: VariantWithProduct[] } {
  const active = D.variants.filter((v) => v.isActive && product(v.productId).status === 'ACTIVE');
  const soldIn = (v: Variant, days: number) => { const since = Date.now() - days * 86_400_000; return D.sales.filter((s) => s.status !== 'VOID' && new Date(s.createdAt).getTime() >= since).flatMap((s) => s.items).filter((i) => i.variantId === v.id).reduce((a, i) => a + i.qty, 0); };
  const urgency = (v: Variant) => -soldIn(v, 30);
  return {
    out: active.filter((v) => v.quantity <= 0).sort((a, b) => urgency(a) - urgency(b)).map(withProduct),
    low: active.filter((v) => v.quantity > 0 && v.quantity <= v.lowStockThreshold).sort((a, b) => urgency(a) - urgency(b)).map(withProduct),
  };
}
export function soldLast(variantId: string, days: number): number {
  const since = Date.now() - days * 86_400_000;
  return D.sales.filter((s) => s.status !== 'VOID' && new Date(s.createdAt).getTime() >= since).flatMap((s) => s.items).filter((i) => i.variantId === variantId).reduce((a, i) => a + i.qty, 0);
}

export const listCounts = (): StockCount[] => D.stockCounts;
export const getCount = (id: string): StockCount => D.stockCounts.find((c) => c.id === id) ?? (() => { throw notFound('Stock count'); })();
export function startCount(scope: string, productIds: string[] | undefined, userId: string): StockCount {
  const vs = D.variants.filter((v) => v.isActive && (!productIds || productIds.includes(v.productId)));
  const c: StockCount = { id: uid('sc'), number: `SC-${String(11 + D.stockCounts.length - 1).padStart(4, '0')}`, status: 'OPEN', scope, startedBy: userId, startedByName: userName(userId), startedAt: nowIso(), counters: [userName(userId)], items: vs.map((v) => ({ variantId: v.id, variant: { size: v.size, color: v.color, sku: v.sku, costPrice: v.costPrice, productName: product(v.productId).name }, systemQty: v.quantity, countedQty: null })) };
  D.stockCounts.unshift(c);
  return c;
}
export function saveCountItems(id: string, items: { variantId: string; countedQty: number }[], userId: string): StockCount {
  const c = getCount(id);
  for (const it of items) { const row = c.items.find((r) => r.variantId === it.variantId); if (row) { row.countedQty = it.countedQty; row.countedBy = userName(userId); row.countedAt = nowIso(); } }
  if (!c.counters.includes(userName(userId))) c.counters.push(userName(userId));
  return c;
}
export function applyCount(id: string, userId: string, uncountedAsZero = false): StockCount {
  const c = getCount(id);
  let n = 0;
  for (const row of c.items) {
    const counted = row.countedQty ?? (uncountedAsZero ? 0 : null);
    if (counted === null) continue;
    const v = variant(row.variantId);
    const delta = counted - v.quantity;
    if (delta !== 0) { applyMovement(v, 'ADJUSTMENT', delta, userId, { reason: `Stock count ${c.number}`, reference: { kind: 'count', id: c.id, label: c.number } }); n++; }
  }
  c.status = 'APPLIED'; c.appliedAt = nowIso();
  audit(userId, 'count.apply', 'Stock count', c.number, `${n} adjustments applied`);
  D.notifications.unshift({ id: uid('n'), kind: 'COUNT_APPLIED', title: 'Stock count applied', body: `${c.number} applied by ${userName(userId)} · ${n} adjustments.`, href: '/stock/movements', createdAt: nowIso() });
  return c;
}

/* =========================================================================================
 * Sales
 * ======================================================================================= */
export interface SaleParams { from?: string; to?: string; sellerId?: string; paymentMethod?: PaymentMethod; status?: Sale['status']; q?: string; productId?: string; page?: number; pageSize?: number }
export function listSales(params: SaleParams = {}): Paginated<Sale> {
  let rows = [...D.sales].reverse();
  if (params.from) rows = rows.filter((s) => s.createdAt.slice(0, 10) >= params.from!);
  if (params.to) rows = rows.filter((s) => s.createdAt.slice(0, 10) <= params.to!);
  if (params.sellerId) rows = rows.filter((s) => s.sellerId === params.sellerId);
  if (params.paymentMethod) rows = rows.filter((s) => s.paymentMethod === params.paymentMethod);
  if (params.status) rows = rows.filter((s) => s.status === params.status);
  if (params.productId) rows = rows.filter((s) => s.items.some((i) => variant(i.variantId).productId === params.productId));
  if (params.q) { const q = params.q.toLowerCase(); rows = rows.filter((s) => s.number.toLowerCase().includes(q) || s.customerName?.toLowerCase().includes(q) || s.customerPhone?.includes(q)); }
  return paginate(rows, params.page, params.pageSize);
}
export const getSale = (id: string): Sale => D.sales.find((s) => s.id === id) ?? (() => { throw notFound('Sale'); })();

export function computeCart(cart: Cart, role: Role) {
  const subtotal = cart.lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
  const cap = D.settings.sellerDiscountCapPct;
  let discount = cart.discount.type === 'PCT' ? Math.round((subtotal * cart.discount.value) / 100) : Math.round(cart.discount.value * 100);
  discount = Math.min(discount, subtotal);
  let capHit = false;
  if (role === 'SELLER' && discount > Math.round((subtotal * cap) / 100)) { discount = Math.round((subtotal * cap) / 100); capHit = true; }
  return { subtotal, discount, total: subtotal - discount, capHit, cap, count: cart.lines.reduce((a, l) => a + l.qty, 0) };
}

export function createSale(cart: Cart, userId: string, role: Role): Sale {
  if (!cart.lines.length) throw new MockError('VALIDATION', 'Cart is empty', 400);
  const fields: Record<string, string> = {};
  for (const l of cart.lines) { const v = variant(l.variantId); if (v.quantity < l.qty && !D.settings.allowNegativeStock) fields[l.variantId] = `Only ${v.quantity} available`; }
  if (Object.keys(fields).length) throw new MockError('INSUFFICIENT_STOCK', 'Some items are no longer in stock', 409, fields);
  const { subtotal, discount, total } = computeCart(cart, role);
  const id = uid('sa');
  const number = `${D.settings.saleNumberPrefix}${D.settings.nextSaleNumber++}`;
  const items: SaleItem[] = cart.lines.map((l) => {
    const v = variant(l.variantId);
    applyMovement(v, 'SALE', -l.qty, userId, { reference: { kind: 'sale', id, label: number } });
    return { id: uid('si'), variantId: v.id, productName: l.productName, size: v.size, color: v.color, sku: v.sku, tint: l.tint, qty: l.qty, unitPrice: v.sellPrice, unitCost: v.costPrice, lineTotal: v.sellPrice * l.qty, returnedQty: 0 };
  });
  const cost = items.reduce((a, i) => a + (i.unitCost ?? 0) * i.qty, 0);
  const sale: Sale = { id, number, sellerId: userId, sellerName: userName(userId), items, subtotal, discount, discountPct: cart.discount.type === 'PCT' ? cart.discount.value : undefined, total, paymentMethod: cart.paymentMethod, status: 'COMPLETED', customerName: cart.customerName || undefined, customerPhone: cart.customerPhone || undefined, note: cart.note || undefined, device: 'This device', cost, profit: total - cost, returns: [], createdAt: nowIso() };
  D.sales.push(sale);
  audit(userId, 'sale.create', 'Sale', number, `${items.length} item(s) · ${(total / 100).toFixed(2)} · ${cart.paymentMethod}`);
  return sale;
}

export function voidSale(id: string, reason: string, userId: string): Sale {
  const s = getSale(id);
  if (s.status === 'VOID') throw new MockError('CONFLICT', 'Already void', 409);
  if (!reason.trim()) throw new MockError('VALIDATION', 'Reason is required', 400, { reason: 'Required' });
  for (const it of s.items) applyMovement(variant(it.variantId), 'ADJUSTMENT', it.qty - it.returnedQty, userId, { reason: `Void ${s.number}`, reference: { kind: 'sale', id: s.id, label: s.number } });
  s.status = 'VOID'; s.voidReason = reason;
  audit(userId, 'sale.void', 'Sale', s.number, `Voided · “${reason}”`);
  return s;
}

export interface ReturnInput { items: { saleItemId: string; qty: number; restock: boolean }[]; refundMethod: PaymentMethod; reason: string; note?: string }
export function createReturn(saleId: string, input: ReturnInput, userId: string): Sale {
  const s = getSale(saleId);
  const lines = input.items.filter((i) => i.qty > 0);
  if (!lines.length) throw new MockError('VALIDATION', 'Pick at least one item', 400);
  let refund = 0;
  for (const l of lines) {
    const it = s.items.find((x) => x.id === l.saleItemId);
    if (!it) throw notFound('Sale item');
    if (it.qty - it.returnedQty < l.qty) throw new MockError('VALIDATION', `Only ${it.qty - it.returnedQty} can be returned`, 400, { [l.saleItemId]: 'Too many' });
    it.returnedQty += l.qty;
    refund += Math.round(it.unitPrice * l.qty * (1 - (s.discountPct ?? 0) / 100));
    if (l.restock) applyMovement(variant(it.variantId), 'RETURN', l.qty, userId, { reference: { kind: 'return', id: s.id, label: `Return ← ${s.number}` } });
  }
  const rt: Return = { id: uid('rt'), saleId, items: lines, refundAmount: refund, refundMethod: input.refundMethod, reason: input.reason, createdBy: userId, createdAt: nowIso() };
  D.returns.push(rt); s.returns.push(rt);
  s.status = s.items.every((i) => i.returnedQty >= i.qty) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  audit(userId, 'return.create', 'Sale', s.number, `Refund ${(refund / 100).toFixed(2)} · ${input.reason}`);
  if (refund >= D.settings.largeRefundAlert) D.notifications.unshift({ id: uid('n'), kind: 'LARGE_REFUND', title: 'Large refund', body: `EGP ${(refund / 100).toFixed(2)} refunded on ${s.number} by ${userName(userId)}.`, href: '/sales', actionLabel: 'Review sale', createdAt: nowIso() });
  return s;
}

export const listParked = (): ParkedSale[] => D.parkedSales.slice(0, 3).map((p) => ({ ...p, cart: { ...p.cart } }));
export function parkSale(cart: Cart, label: string): ParkedSale {
  if (D.parkedSales.length >= 3) throw new MockError('CONFLICT', 'You can park at most 3 sales', 409);
  const p: ParkedSale = { id: uid('pk'), cart, parkedAt: nowIso(), label }; D.parkedSales.push(p); return p;
}
export function unparkSale(id: string): ParkedSale { const i = D.parkedSales.findIndex((p) => p.id === id); if (i < 0) throw notFound('Parked sale'); return D.parkedSales.splice(i, 1)[0]!; }

/* =========================================================================================
 * Analytics
 * ======================================================================================= */
const inRange = (iso: string, from: string, to: string) => { const d = iso.slice(0, 10); return d >= from && d <= to; };
const salesIn = (from: string, to: string) => D.sales.filter((s) => s.status !== 'VOID' && inRange(s.createdAt, from, to));
function shiftRange(from: string, to: string) {
  const f = new Date(from).getTime(), t = new Date(to).getTime();
  const len = t - f + 86_400_000;
  return { from: new Date(f - len).toISOString().slice(0, 10), to: new Date(t - len).toISOString().slice(0, 10) };
}
const delta = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : 100) : ((cur - prev) / prev) * 100);

function kpis(from: string, to: string): DashboardKpis {
  const rows = salesIn(from, to);
  const totals = (xs: Sale[]) => ({ cash: xs.reduce((a, s) => a + s.total, 0), profit: xs.reduce((a, s) => a + (s.profit ?? 0), 0), count: xs.length });
  const cur = totals(rows);
  const prev = totals((() => { const r = shiftRange(from, to); return salesIn(r.from, r.to); })());
  const cashByMethod: Record<PaymentMethod, number> = { CASH: 0, CARD: 0, WALLET: 0, TRANSFER: 0 };
  for (const s of rows) cashByMethod[s.paymentMethod] += s.total;
  const refunds = D.returns.filter((r) => inRange(r.createdAt, from, to)).reduce((a, r) => a + r.refundAmount, 0);
  const grossProfit = cur.profit - Math.round(refunds * 0.4);
  const cogs = rows.reduce((a, s) => a + (s.cost ?? 0), 0);
  const active = D.variants.filter((v) => v.isActive && product(v.productId).status === 'ACTIVE');
  const low = lowStock();
  const avgBasket = cur.count ? Math.round(cur.cash / cur.count) : 0;
  const prevAvg = prev.count ? Math.round(prev.cash / prev.count) : 0;
  return {
    totalCash: cur.cash, cashByMethod, grossProfit, marginPct: cur.cash ? (grossProfit / cur.cash) * 100 : 0, cogs,
    unitsInStock: active.reduce((a, v) => a + Math.max(0, v.quantity), 0), skusInStock: active.filter((v) => v.quantity > 0).length,
    stockValueCost: active.reduce((a, v) => a + Math.max(0, v.quantity) * (v.costPrice ?? 0), 0), stockValueRetail: active.reduce((a, v) => a + Math.max(0, v.quantity) * v.sellPrice, 0),
    salesCount: cur.count, avgBasket, lowStockCount: low.low.length, outOfStockCount: low.out.length,
    deltas: { totalCash: delta(cur.cash, prev.cash), grossProfit: delta(cur.profit, prev.profit), salesCount: delta(cur.count, prev.count), avgBasket: delta(avgBasket, prevAvg) },
  };
}

export function salesTrend(from: string, to: string, interval: 'day' | 'week' | 'month' = 'day'): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>();
  const f = new Date(from), t = new Date(to);
  for (let d = new Date(f); d <= t; d.setDate(d.getDate() + 1)) { const k = d.toISOString().slice(0, 10); buckets.set(k, { bucket: k, revenue: 0, profit: 0, cogs: 0, count: 0 }); }
  for (const s of salesIn(from, to)) { const b = buckets.get(s.createdAt.slice(0, 10)); if (b) { b.revenue += s.total; b.profit += s.profit ?? 0; b.cogs += s.cost ?? 0; b.count++; } }
  let pts = [...buckets.values()];
  if (interval !== 'day') {
    const g = new Map<string, TrendPoint>();
    for (const p of pts) { const d = new Date(p.bucket); const k = interval === 'month' ? p.bucket.slice(0, 7) : new Date(d.getTime() - d.getDay() * 86_400_000).toISOString().slice(0, 10); const cur = g.get(k) ?? { bucket: k, revenue: 0, profit: 0, cogs: 0, count: 0 }; cur.revenue += p.revenue; cur.profit += p.profit; cur.cogs += p.cogs; cur.count += p.count; g.set(k, cur); }
    pts = [...g.values()];
  }
  return pts;
}

export function brandSplit(from: string, to: string): BrandSplit[] {
  const by = new Map<string, number>();
  for (const s of salesIn(from, to)) for (const i of s.items) { const b = product(variant(i.variantId).productId).brandId; by.set(b, (by.get(b) ?? 0) + i.lineTotal); }
  const total = [...by.values()].reduce((a, b) => a + b, 0) || 1;
  return D.brands.map((b) => ({ id: b.id, name: b.name, revenue: by.get(b.id) ?? 0, sharePct: ((by.get(b.id) ?? 0) / total) * 100 })).sort((a, b) => b.revenue - a.revenue);
}

export function topProducts(from: string, to: string, by: 'units' | 'revenue' | 'profit' = 'units', limit = 5): TopProduct[] {
  const m = new Map<string, TopProduct>();
  for (const s of salesIn(from, to)) for (const i of s.items) {
    const p = product(variant(i.variantId).productId);
    const cur = m.get(p.id) ?? { productId: p.id, name: p.name, brand: brandOf(p.brandId)?.name ?? '', units: 0, revenue: 0, profit: 0 };
    cur.units += i.qty; cur.revenue += i.lineTotal; cur.profit = (cur.profit ?? 0) + (i.unitPrice - (i.unitCost ?? 0)) * i.qty; m.set(p.id, cur);
  }
  return [...m.values()].map((t) => ({ ...t, marginPct: t.revenue ? ((t.profit ?? 0) / t.revenue) * 100 : 0 })).sort((a, b) => (b[by] ?? 0) - (a[by] ?? 0)).slice(0, limit);
}

export function dashboard(from: string, to: string): DashboardData {
  const low = lowStock();
  return { kpis: kpis(from, to), trend: salesTrend(from, to), brandSplit: brandSplit(from, to), topProducts: topProducts(from, to, 'units', 5), lowStock: [...low.out, ...low.low].slice(0, 6), recentSales: [...D.sales].reverse().slice(0, 6) };
}

export function slowMovers(days = 60): SlowMover[] {
  const now = Date.now();
  return D.variants.filter((v) => v.quantity > 0 && product(v.productId).status === 'ACTIVE').map((v) => {
    const last = D.variantLastSaleAt[v.id] ?? product(v.productId).createdAt;
    const d = Math.floor((now - new Date(last).getTime()) / 86_400_000);
    const p = product(v.productId);
    return { variantId: v.id, productName: p.name, brand: brandOf(p.brandId)?.name ?? '', size: v.size, color: v.color, sku: v.sku, qty: v.quantity, daysSinceLastSale: d, valueAtCost: v.quantity * (v.costPrice ?? 0), soldLast90d: soldLast(v.id, 90), suggestion: d > 90 ? 'Markdown 20%' : d > 70 ? 'Bundle' : d > 60 ? 'Move to front' : 'Watch' };
  }).filter((m) => m.daysSinceLastSale >= days).sort((a, b) => b.valueAtCost - a.valueAtCost);
}

export function sizeColor(brandId?: string, from?: string, to?: string): SizeColorMatrix {
  const vs = D.variants.filter((v) => !brandId || product(v.productId).brandId === brandId);
  const sizes = [...new Set(vs.map((v) => v.size))].sort((a, b) => (SIZE_ORDER.indexOf(a) + 1 || 99 + parseInt(a)) - (SIZE_ORDER.indexOf(b) + 1 || 99 + parseInt(b)));
  const colors = uniqColors(vs.map((v) => v.color));
  const f = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), t = to ?? new Date().toISOString().slice(0, 10);
  const sold = new Map<string, number>();
  for (const s of salesIn(f, t)) for (const i of s.items) sold.set(i.variantId, (sold.get(i.variantId) ?? 0) + i.qty);
  const cells = sizes.flatMap((size) => colors.map((c) => { const cvs = vs.filter((v) => v.size === size && v.color.name === c.name); return { size, color: c.name, qty: cvs.reduce((a, v) => a + Math.max(0, v.quantity), 0), sold: cvs.reduce((a, v) => a + (sold.get(v.id) ?? 0), 0) }; }));
  return { sizes, colors, cells };
}
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'];

export function sellers(from: string, to: string): SellerStats[] {
  return D.users.filter((u) => u.status !== 'INVITED').map((u) => {
    const ss = salesIn(from, to).filter((s) => s.sellerId === u.id);
    const revenue = ss.reduce((a, s) => a + s.total, 0);
    const disc = ss.reduce((a, s) => a + s.discount, 0);
    const rts = D.returns.filter((r) => inRange(r.createdAt, from, to) && ss.some((s) => s.id === r.saleId));
    return { userId: u.id, name: u.name, salesCount: ss.length, revenue, avgBasket: ss.length ? Math.round(revenue / ss.length) : 0, discountGiven: disc, discountPct: revenue ? (disc / (revenue + disc)) * 100 : 0, returnsCount: rts.length, returnsValue: rts.reduce((a, r) => a + r.refundAmount, 0), returnRatePct: ss.length ? (rts.length / ss.length) * 100 : 0 };
  }).filter((s) => s.salesCount > 0).sort((a, b) => b.revenue - a.revenue);
}

export function categoryStats(from: string, to: string): CategoryStats[] {
  return D.categories.filter((c) => c.isActive).map((c) => {
    const vs = D.variants.filter((v) => product(v.productId).categoryId === c.id && product(v.productId).status === 'ACTIVE');
    const items = salesIn(from, to).flatMap((s) => s.items).filter((i) => vs.some((v) => v.id === i.variantId));
    const unitsSold = items.reduce((a, i) => a + i.qty, 0), revenue = items.reduce((a, i) => a + i.lineTotal, 0), profit = items.reduce((a, i) => a + (i.unitPrice - (i.unitCost ?? 0)) * i.qty, 0);
    const unitsInStock = vs.reduce((a, v) => a + Math.max(0, v.quantity), 0);
    const days = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1);
    return { id: c.id, name: c.name, unitsInStock, unitsSold, stockValueCost: vs.reduce((a, v) => a + Math.max(0, v.quantity) * (v.costPrice ?? 0), 0), stockValueRetail: vs.reduce((a, v) => a + Math.max(0, v.quantity) * v.sellPrice, 0), revenue, profit, marginPct: revenue ? (profit / revenue) * 100 : 0, daysOfCover: unitsSold ? Math.round(unitsInStock / (unitsSold / days)) : 999 };
  });
}

export function returnsReport(from: string, to: string): ReturnsReport {
  const rts = D.returns.filter((r) => inRange(r.createdAt, from, to));
  const by = new Map<string, { count: number; value: number }>();
  for (const r of rts) { const c = by.get(r.reason) ?? { count: 0, value: 0 }; c.count++; c.value += r.refundAmount; by.set(r.reason, c); }
  const count = salesIn(from, to).length || 1;
  return { ratePct: (rts.length / count) * 100, count: rts.length, value: rts.reduce((a, r) => a + r.refundAmount, 0), byReason: [...by.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.count - a.count) };
}

export function paymentMix(from: string, to: string): PaymentMix[] {
  const m: Record<PaymentMethod, PaymentMix> = { CASH: { method: 'CASH', count: 0, total: 0 }, CARD: { method: 'CARD', count: 0, total: 0 }, WALLET: { method: 'WALLET', count: 0, total: 0 }, TRANSFER: { method: 'TRANSFER', count: 0, total: 0 } };
  for (const s of salesIn(from, to)) { m[s.paymentMethod].count++; m[s.paymentMethod].total += s.total; }
  return Object.values(m);
}

/* =========================================================================================
 * Users, settings, audit, notifications
 * ======================================================================================= */
export const listUsers = (): User[] => D.users.map((u) => ({ ...u }));
export function createUser(input: { name: string; email: string; role: Role; mode: 'INVITE' | 'TEMP' }, byUser: string): User {
  if (D.users.some((u) => u.email === input.email.toLowerCase())) throw new MockError('CONFLICT', 'Email already in use', 409, { email: 'Already in use' });
  const u: User = { id: uid('u'), name: input.name, email: input.email.toLowerCase(), role: input.role, roles: [input.role], status: input.mode === 'INVITE' ? 'INVITED' : 'ACTIVE', mustChangePassword: input.mode === 'TEMP', sessions: 0 };
  D.users.push(u);
  audit(byUser, 'user.create', 'User', u.email, `Created with role ${u.role} · ${input.mode === 'INVITE' ? 'invite sent' : 'temporary password'}`);
  return u;
}
export function updateUser(id: string, patch: Partial<Pick<User, 'name' | 'role' | 'status' | 'roles'>>, byUser: string): User {
  const u = D.users.find((x) => x.id === id) ?? (() => { throw notFound('User'); })();
  if (patch.status === 'DISABLED' && u.role === 'ADMIN' && D.users.filter((x) => x.role === 'ADMIN' && x.status === 'ACTIVE').length <= 1) throw new MockError('CONFLICT', 'Cannot disable the last admin', 409);
  const before = { ...u };
  Object.assign(u, patch);
  audit(byUser, patch.status ? 'user.disable' : 'user.update', 'User', u.email, Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(', '), { before, after: { ...u } });
  return { ...u };
}
export function revokeSessions(id: string): User { const u = D.users.find((x) => x.id === id) ?? (() => { throw notFound('User'); })(); u.sessions = 0; return { ...u }; }

export const getSettings = (): Settings => ({ ...D.settings });
export function updateSettings(patch: Partial<Settings>, byUser: string): Settings {
  const before = { ...D.settings };
  Object.assign(D.settings, patch);
  audit(byUser, 'settings.update', 'Settings', 'Settings', Object.keys(patch).map((k) => `${k} ${String((before as Record<string, unknown>)[k])} → ${String((patch as Record<string, unknown>)[k])}`).join(' · '), { before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])), after: patch as Record<string, unknown> });
  return getSettings();
}

export interface AuditParams { q?: string; userId?: string; entity?: string; from?: string; to?: string; page?: number; pageSize?: number }
export function listAudit(params: AuditParams = {}): Paginated<AuditEntry> {
  let rows = D.audit;
  if (params.q) { const q = params.q.toLowerCase(); rows = rows.filter((a) => a.summary.toLowerCase().includes(q) || a.entityLabel.toLowerCase().includes(q) || a.action.includes(q)); }
  if (params.userId) rows = rows.filter((a) => a.userId === params.userId);
  if (params.entity) rows = rows.filter((a) => a.entity === params.entity);
  if (params.from) rows = rows.filter((a) => a.createdAt.slice(0, 10) >= params.from!);
  if (params.to) rows = rows.filter((a) => a.createdAt.slice(0, 10) <= params.to!);
  return paginate(rows, params.page, params.pageSize);
}

export const listNotifications = (): Notification[] => [...D.notifications].sort((a, b) => (a.readAt ? 1 : 0) - (b.readAt ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
export function markRead(id?: string): Notification[] { for (const n of D.notifications) if (!id || n.id === id) n.readAt = n.readAt ?? nowIso(); return listNotifications(); }

/* ---------- invariants (dev aid) ---------- */
export function verifyLedger(): { ok: boolean; mismatches: string[] } {
  const sums = new Map<string, number>();
  for (const m of D.movements) sums.set(m.variantId, (sums.get(m.variantId) ?? 0) + m.qtyDelta);
  const mismatches = D.variants.filter((v) => (sums.get(v.id) ?? 0) !== v.quantity).map((v) => `${v.sku}: qty ${v.quantity} vs Σ ${sums.get(v.id) ?? 0}`);
  return { ok: mismatches.length === 0, mismatches };
}

export const raw = D;
