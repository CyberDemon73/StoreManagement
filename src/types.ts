/**
 * Shared frontend types. They mirror docs/DATA-MODEL.md and the response shapes in
 * docs/API-SPEC.md. Money is always an integer in minor units (piastres): 12500 = EGP 125.00.
 */
import type { Permission, Role } from '@/lib/permissions';

export type { Permission, Role };

export type UserStatus = 'ACTIVE' | 'DISABLED' | 'INVITED';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Every role this account may act as; `role` is the primary one. */
  roles: Role[];
  status: UserStatus;
  lastLoginAt?: string;
  lastDevice?: string;
  sessions?: number;
  mustChangePassword?: boolean;
}

export interface Brand {
  id: string;
  name: string;
  logoUrl?: string;
  isActive: boolean;
  productCount?: number;
  variantCount?: number;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  isActive: boolean;
  productCount?: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  notes?: string;
  isActive: boolean;
  purchaseCount?: number;
  lastPurchaseAt?: string;
}

export type ProductStatus = 'ACTIVE' | 'ARCHIVED';

export interface Product {
  id: string;
  name: string;
  brandId: string;
  categoryId: string;
  description?: string;
  baseSku: string;
  images: string[];
  /** Hidden for sellers. */
  defaultCost?: number;
  defaultPrice: number;
  status: ProductStatus;
  tags: string[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** `GET /products` row: product + aggregates. */
export interface ProductListItem extends Product {
  brand: Pick<Brand, 'id' | 'name'>;
  category: Pick<Category, 'id' | 'name'>;
  variantCount: number;
  totalQty: number;
  lowCount: number;
  outCount: number;
  minPrice: number;
  maxPrice: number;
  lowStock: boolean;
  coverImage?: string;
  /** Hidden for sellers. */
  marginPct?: number;
  /** Placeholder tint used while there is no image. */
  tint: string;
}

export interface ProductDetail extends ProductListItem {
  variants: Variant[];
  sizes: string[];
  colors: ColorRef[];
  soldLast30d: number;
}

export interface ColorRef {
  name: string;
  hex: string;
}

export interface Variant {
  id: string;
  productId: string;
  size: string;
  color: ColorRef;
  sku: string;
  barcode?: string;
  /** Weighted-average cost. Hidden for sellers. */
  costPrice?: number;
  sellPrice: number;
  quantity: number;
  lowStockThreshold: number;
  isActive: boolean;
}

/** Variant joined with its product, used by lookups, low-stock and movements. */
export interface VariantWithProduct extends Variant {
  product: Pick<Product, 'id' | 'name' | 'baseSku' | 'images'> & { brandName: string; tint: string };
}

export type StockStatus = 'ok' | 'low' | 'out';

export type MovementType = 'INITIAL' | 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT';

export type AdjustmentReason = 'DAMAGED' | 'LOST' | 'FOUND' | 'CORRECTION' | 'OTHER';

export interface MovementReference {
  kind: 'sale' | 'purchase' | 'return' | 'count';
  id: string;
  label: string;
}

export interface StockMovement {
  id: string;
  variantId: string;
  variant: Pick<Variant, 'size' | 'color' | 'sku'> & { productName: string };
  type: MovementType;
  qtyDelta: number;
  qtyAfter: number;
  /** Hidden for sellers. */
  unitCost?: number;
  reference?: MovementReference;
  reason?: string;
  /** Null for system-generated rows. */
  userId: string | null;
  userName: string;
  createdAt: string;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'WALLET' | 'TRANSFER';

export type SaleStatus = 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOID';

export interface SaleItem {
  id: string;
  variantId: string;
  productName: string;
  size: string;
  color: ColorRef;
  sku: string;
  tint: string;
  qty: number;
  unitPrice: number;
  /** Snapshot at sale time. Hidden for sellers. */
  unitCost?: number;
  lineTotal: number;
  returnedQty: number;
}

export interface Sale {
  id: string;
  number: string;
  sellerId: string;
  sellerName: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  discountPct?: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  customerName?: string;
  customerPhone?: string;
  note?: string;
  device?: string;
  /** Hidden for sellers. */
  cost?: number;
  profit?: number;
  returns: Return[];
  voidReason?: string;
  createdAt: string;
}

export interface Return {
  id: string;
  saleId: string;
  items: { saleItemId: string; qty: number; restock: boolean }[];
  refundAmount: number;
  refundMethod: PaymentMethod;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface PurchaseItem {
  variantId: string;
  qty: number;
  unitCost: number;
}

export interface Purchase {
  id: string;
  number: string;
  supplierId?: string;
  supplierName?: string;
  invoiceRef?: string;
  items: PurchaseItem[];
  lineCount: number;
  unitCount: number;
  total: number;
  receivedAt: string;
  createdBy: string;
  createdByName: string;
  note?: string;
}

export type StockCountStatus = 'OPEN' | 'APPLIED' | 'CANCELLED';

export interface StockCountItem {
  variantId: string;
  variant: Pick<Variant, 'size' | 'color' | 'sku' | 'costPrice'> & { productName: string };
  systemQty: number;
  countedQty: number | null;
  countedBy?: string;
  countedAt?: string;
}

export interface StockCount {
  id: string;
  number: string;
  status: StockCountStatus;
  scope: string;
  startedBy: string;
  startedByName: string;
  startedAt: string;
  appliedAt?: string;
  counters: string[];
  items: StockCountItem[];
}

export interface SizePreset {
  name: string;
  sizes: string[];
}

export interface Settings {
  storeName: string;
  logoUrl?: string;
  phone?: string;
  address?: string;
  currency: string;
  timezone: string;
  dateFormat: 'DD/MM/YYYY' | 'YYYY-MM-DD';
  lowStockDefault: number;
  saleNumberPrefix: string;
  nextSaleNumber: number;
  sellerDiscountCapPct: number;
  allowNegativeStock: boolean;
  requirePhoneOnTransfer: boolean;
  sizePresets: SizePreset[];
  colorPresets: ColorRef[];
  receiptHeader?: string;
  receiptFooter?: string;
  receiptShowLogo: boolean;
  sessionIdleHours: number;
  passwordRotationDays: number | null;
  lockoutEnabled: boolean;
  largeRefundAlert: number;
}

export interface DashboardKpis {
  totalCash: number;
  cashByMethod: Record<PaymentMethod, number>;
  grossProfit: number;
  marginPct: number;
  cogs: number;
  unitsInStock: number;
  skusInStock: number;
  stockValueCost: number;
  stockValueRetail: number;
  salesCount: number;
  avgBasket: number;
  lowStockCount: number;
  outOfStockCount: number;
  /** Deltas vs the previous period of the same length, in percent. */
  deltas: { totalCash: number; grossProfit: number; salesCount: number; avgBasket: number };
}

export interface TrendPoint {
  bucket: string;
  revenue: number;
  profit: number;
  cogs: number;
  count: number;
}

export interface BrandSplit {
  id: string;
  name: string;
  revenue: number;
  sharePct: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  brand: string;
  units: number;
  revenue: number;
  profit?: number;
  marginPct?: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  trend: TrendPoint[];
  brandSplit: BrandSplit[];
  topProducts: TopProduct[];
  lowStock: VariantWithProduct[];
  recentSales: Sale[];
}

export interface SlowMover {
  variantId: string;
  productName: string;
  brand: string;
  size: string;
  color: ColorRef;
  sku: string;
  qty: number;
  daysSinceLastSale: number;
  valueAtCost: number;
  soldLast90d: number;
  suggestion: string;
}

export interface SizeColorMatrix {
  sizes: string[];
  colors: ColorRef[];
  cells: { size: string; color: string; qty: number; sold: number }[];
}

export interface SellerStats {
  userId: string;
  name: string;
  salesCount: number;
  revenue: number;
  avgBasket: number;
  discountGiven: number;
  discountPct: number;
  returnsCount: number;
  returnsValue: number;
  returnRatePct: number;
}

export interface CategoryStats {
  id: string;
  name: string;
  unitsInStock: number;
  unitsSold: number;
  stockValueCost: number;
  stockValueRetail: number;
  revenue: number;
  profit: number;
  marginPct: number;
  daysOfCover: number;
}

export interface ReturnsReport {
  ratePct: number;
  count: number;
  value: number;
  byReason: { reason: string; count: number; value: number }[];
}

export interface PaymentMix {
  method: PaymentMethod;
  count: number;
  total: number;
}

export type AuditAction =
  | 'sale.create' | 'sale.void' | 'return.create' | 'variant.adjust' | 'purchase.post' | 'count.apply'
  | 'product.create' | 'product.update' | 'product.archive' | 'settings.update' | 'user.create'
  | 'user.update' | 'user.disable' | 'auth.login' | 'auth.logout';

export interface AuditEntry {
  id: string;
  userId?: string;
  userName: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  entityLabel: string;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  createdAt: string;
}

export type NotificationKind = 'LOW_STOCK' | 'LARGE_REFUND' | 'NEW_DEVICE_LOGIN' | 'COUNT_APPLIED';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
  actionLabel?: string;
  readAt?: string;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type ApiErrorCode =
  | 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'RATE_LIMITED' | 'LOCKED' | 'INSUFFICIENT_STOCK' | 'INTERNAL' | 'OFFLINE' | 'ACCOUNT_DISABLED';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string>; retryAfter?: number };
}

/* ---------- Cart (client-side only; the server recomputes everything) ---------- */

export interface CartLine {
  variantId: string;
  productId: string;
  productName: string;
  size: string;
  color: ColorRef;
  sku: string;
  tint: string;
  unitPrice: number;
  qty: number;
  available: number;
}

export interface Cart {
  lines: CartLine[];
  discount: { type: 'PCT' | 'AMOUNT'; value: number };
  paymentMethod: PaymentMethod;
  customerName?: string;
  customerPhone?: string;
  note?: string;
}

export interface ParkedSale {
  id: string;
  cart: Cart;
  parkedAt: string;
  label: string;
}

export interface DateRange {
  from: string; // ISO date (YYYY-MM-DD)
  to: string;
  label: string;
  preset: DateRangePreset;
}

export type DateRangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';
