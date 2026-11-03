import type { RouteHandler } from './auth';
import type { Permission } from './permissions';

export type RouteMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RouteSpec {
  method: RouteMethod;
  /** Path relative to /api/v1, with `:param` for dynamic segments. */
  path: string;
  /**
   * 'public' (no session), 'auth' (any role), or the permission key from docs/ACCESS-MATRIX.md.
   * Must match the options passed to withAuth in the route file; tests/authz/matrix.test.ts asserts it.
   */
  access: 'public' | 'auth' | Permission;
  load: () => Promise<Partial<Record<RouteMethod, RouteHandler>>>;
  /** Body that passes validation, so the authz test reaches the permission check. */
  sampleBody?: unknown;
  sampleParams?: Record<string, string>;
  /** Multipart body (uploads); takes precedence over sampleBody in the authz matrix. */
  sampleForm?: () => FormData;
}

/**
 * Every API route, used by tests/authz/matrix.test.ts to assert the role matrix.
 * A route.ts on disk that is missing here fails that test.
 */
export const ROUTES: RouteSpec[] = [
  { method: 'GET', path: '/health', access: 'public', load: () => import('@/app/api/v1/health/route') },
  {
    method: 'POST',
    path: '/setup',
    access: 'public',
    load: () => import('@/app/api/v1/setup/route'),
    sampleBody: {
      name: 'Owner',
      email: 'owner@example.com',
      password: 'Zq9!vt-plume-orbit',
      storeName: 'Avenue',
      currency: 'EGP',
      setupToken: 'test-setup-token',
    },
  },
  {
    method: 'POST',
    path: '/auth/login',
    access: 'public',
    load: () => import('@/app/api/v1/auth/login/route'),
    sampleBody: { email: 'nobody@example.com', password: 'Zq9!vt-plume-orbit' },
  },
  { method: 'POST', path: '/auth/logout', access: 'auth', load: () => import('@/app/api/v1/auth/logout/route') },
  { method: 'GET', path: '/auth/me', access: 'auth', load: () => import('@/app/api/v1/auth/me/route') },
  {
    method: 'POST',
    path: '/auth/forgot',
    access: 'public',
    load: () => import('@/app/api/v1/auth/forgot/route'),
    sampleBody: { email: 'nobody@example.com' },
  },
  {
    method: 'POST',
    path: '/auth/reset',
    access: 'public',
    load: () => import('@/app/api/v1/auth/reset/route'),
    sampleBody: { token: 'x'.repeat(43), password: 'Zq9!vt-plume-orbit' },
  },
  { method: 'GET', path: '/audit', access: 'audit.read', load: () => import('@/app/api/v1/audit/route') },
  // --- catalog (brands, categories, suppliers) ---
  { method: 'GET', path: '/brands', access: 'catalog.read', load: () => import('@/app/api/v1/brands/route') },
  { method: 'POST', path: '/brands', access: 'catalog.write', load: () => import('@/app/api/v1/brands/route'), sampleBody: { name: 'Sample' } },
  {
    method: 'PATCH',
    path: '/brands/:id',
    access: 'catalog.write',
    load: () => import('@/app/api/v1/brands/[id]/route'),
    sampleBody: { name: 'Renamed' },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  { method: 'GET', path: '/categories', access: 'catalog.read', load: () => import('@/app/api/v1/categories/route') },
  {
    method: 'POST',
    path: '/categories',
    access: 'catalog.write',
    load: () => import('@/app/api/v1/categories/route'),
    sampleBody: { name: 'Sample' },
  },
  {
    method: 'PATCH',
    path: '/categories/:id',
    access: 'catalog.write',
    load: () => import('@/app/api/v1/categories/[id]/route'),
    sampleBody: { name: 'Renamed' },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  { method: 'GET', path: '/suppliers', access: 'catalog.read', load: () => import('@/app/api/v1/suppliers/route') },
  {
    method: 'POST',
    path: '/suppliers',
    access: 'catalog.write',
    load: () => import('@/app/api/v1/suppliers/route'),
    sampleBody: { name: 'Sample' },
  },
  {
    method: 'PATCH',
    path: '/suppliers/:id',
    access: 'catalog.write',
    load: () => import('@/app/api/v1/suppliers/[id]/route'),
    sampleBody: { name: 'Renamed' },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  // --- products ---
  { method: 'GET', path: '/products', access: 'products.read', load: () => import('@/app/api/v1/products/route') },
  { method: 'GET', path: '/products/export', access: 'export.csv', load: () => import('@/app/api/v1/products/export/route') },
  {
    method: 'POST',
    path: '/products/import',
    access: 'export.csv',
    load: () => import('@/app/api/v1/products/import/route'),
    sampleForm: () => {
      const f = new FormData();
      f.append('file', new Blob(['name,brand,category,size,color,price\n'], { type: 'text/csv' }), 'p.csv');
      return f;
    },
  },
  { method: 'GET', path: '/labels', access: 'products.write', load: () => import('@/app/api/v1/labels/route') },
  { method: 'GET', path: '/data/export', access: 'data.export.all', load: () => import('@/app/api/v1/data/export/route') },
  // Public to the session layer; the handler requires Bearer CRON_SECRET.
  { method: 'GET', path: '/cron/daily', access: 'public', load: () => import('@/app/api/v1/cron/daily/route') },
  {
    method: 'POST',
    path: '/products',
    access: 'products.write',
    load: () => import('@/app/api/v1/products/route'),
    sampleBody: { name: 'Sample', brandId: '00000000-0000-4000-8000-000000000001', categoryId: '00000000-0000-4000-8000-000000000002', defaultPrice: 1000 },
  },
  {
    method: 'GET',
    path: '/products/:id',
    access: 'products.read',
    load: () => import('@/app/api/v1/products/[id]/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'PATCH',
    path: '/products/:id',
    access: 'products.write',
    load: () => import('@/app/api/v1/products/[id]/route'),
    sampleBody: { name: 'Sample' },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/products/:id/archive',
    access: 'products.write',
    load: () => import('@/app/api/v1/products/[id]/archive/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/products/:id/unarchive',
    access: 'products.write',
    load: () => import('@/app/api/v1/products/[id]/unarchive/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'GET',
    path: '/products/:id/variants',
    access: 'products.read',
    load: () => import('@/app/api/v1/products/[id]/variants/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/products/:id/variants',
    access: 'variants.write',
    load: () => import('@/app/api/v1/products/[id]/variants/route'),
    sampleBody: { sizes: ['S'], colors: [{ name: 'Black', hex: '#000000' }] },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  // --- variants ---
  {
    method: 'PATCH',
    path: '/variants/:id',
    access: 'variants.write',
    load: () => import('@/app/api/v1/variants/[id]/route'),
    sampleBody: { sellPrice: 1000 },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'DELETE',
    path: '/variants/:id',
    access: 'variants.write',
    load: () => import('@/app/api/v1/variants/[id]/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  // No query string in the matrix call: the route answers 400 (validation), which is "not blocked".
  { method: 'GET', path: '/variants/lookup', access: 'products.read', load: () => import('@/app/api/v1/variants/lookup/route') },
  { method: 'GET', path: '/variants/search', access: 'products.read', load: () => import('@/app/api/v1/variants/search/route') },
  // --- uploads ---
  // --- users ---
  { method: 'GET', path: '/users', access: 'users.manage', load: () => import('@/app/api/v1/users/route') },
  {
    method: 'POST',
    path: '/users',
    access: 'users.manage',
    load: () => import('@/app/api/v1/users/route'),
    sampleBody: { name: 'Sample', email: 'sample.user@example.com', role: 'SELLER', mode: 'TEMP' },
  },
  {
    method: 'PATCH',
    path: '/users/:id',
    access: 'users.manage',
    load: () => import('@/app/api/v1/users/[id]/route'),
    sampleBody: { name: 'Renamed' },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/users/:id/disable',
    access: 'users.manage',
    load: () => import('@/app/api/v1/users/[id]/disable/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/users/:id/enable',
    access: 'users.manage',
    load: () => import('@/app/api/v1/users/[id]/enable/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/users/:id/reset-password',
    access: 'users.manage',
    load: () => import('@/app/api/v1/users/[id]/reset-password/route'),
    sampleBody: { mode: 'TEMP' },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/users/:id/revoke-sessions',
    access: 'users.manage',
    load: () => import('@/app/api/v1/users/[id]/revoke-sessions/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/auth/accept-invite',
    access: 'public',
    load: () => import('@/app/api/v1/auth/accept-invite/route'),
    sampleBody: { token: 'x'.repeat(43), password: 'Zq9!vt-plume-orbit' },
  },
  // --- settings/profile/audit ---
  { method: 'GET', path: '/settings', access: 'auth', load: () => import('@/app/api/v1/settings/route') },
  {
    method: 'PATCH',
    path: '/settings',
    access: 'settings.write',
    load: () => import('@/app/api/v1/settings/route'),
    sampleBody: { storeName: 'X' },
  },
  { method: 'PATCH', path: '/me', access: 'auth', load: () => import('@/app/api/v1/me/route'), sampleBody: { name: 'X' } },
  {
    method: 'POST',
    path: '/me/password',
    access: 'auth',
    load: () => import('@/app/api/v1/me/password/route'),
    sampleBody: { current: 'Zq9!vt-plume-orbit', next: 'Yq8!vt-plume-orbit2' },
  },
  // --- notifications ---
  { method: 'GET', path: '/notifications', access: 'auth', load: () => import('@/app/api/v1/notifications/route') },
  {
    method: 'POST',
    path: '/notifications/:id/read',
    access: 'auth',
    load: () => import('@/app/api/v1/notifications/[id]/read/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000000' },
  },
  { method: 'POST', path: '/notifications/read-all', access: 'auth', load: () => import('@/app/api/v1/notifications/read-all/route') },
  // --- analytics ---
  { method: 'GET', path: '/analytics/export', access: 'export.csv', load: () => import('@/app/api/v1/analytics/export/route') },
  { method: 'GET', path: '/analytics/dashboard', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/dashboard/route') },
  { method: 'GET', path: '/analytics/sales-trend', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/sales-trend/route') },
  { method: 'GET', path: '/analytics/payment-mix', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/payment-mix/route') },
  { method: 'GET', path: '/analytics/brands', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/brands/route') },
  { method: 'GET', path: '/analytics/categories', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/categories/route') },
  { method: 'GET', path: '/analytics/top-products', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/top-products/route') },
  { method: 'GET', path: '/analytics/top-variants', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/top-variants/route') },
  { method: 'GET', path: '/analytics/size-color', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/size-color/route') },
  { method: 'GET', path: '/analytics/slow-movers', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/slow-movers/route') },
  { method: 'GET', path: '/analytics/stock-ageing', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/stock-ageing/route') },
  { method: 'GET', path: '/analytics/sellers', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/sellers/route') },
  { method: 'GET', path: '/analytics/returns', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/returns/route') },
  { method: 'GET', path: '/analytics/price-list', access: 'analytics.read', load: () => import('@/app/api/v1/analytics/price-list/route') },
  // --- sales ---
  {
    method: 'POST',
    path: '/sales',
    access: 'sales.create',
    load: () => import('@/app/api/v1/sales/route'),
    sampleBody: { items: [{ variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }], paymentMethod: 'CASH' },
  },
  { method: 'GET', path: '/sales', access: 'sales.read', load: () => import('@/app/api/v1/sales/route') },
  {
    method: 'GET',
    path: '/sales/:id',
    access: 'sales.read',
    load: () => import('@/app/api/v1/sales/[id]/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'GET',
    path: '/sales/:id/receipt',
    access: 'sales.read',
    load: () => import('@/app/api/v1/sales/[id]/receipt/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/sales/:id/void',
    access: 'sales.void',
    load: () => import('@/app/api/v1/sales/[id]/void/route'),
    sampleBody: { reason: 'Test' },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/sales/:id/returns',
    access: 'returns.create',
    load: () => import('@/app/api/v1/sales/[id]/returns/route'),
    sampleBody: { items: [{ saleItemId: '00000000-0000-4000-8000-000000000002', qty: 1, restock: true }], refundMethod: 'CASH', reason: 'Test' },
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  { method: 'GET', path: '/sales/parked', access: 'sales.create', load: () => import('@/app/api/v1/sales/parked/route') },
  {
    method: 'POST',
    path: '/sales/parked',
    access: 'sales.create',
    load: () => import('@/app/api/v1/sales/parked/route'),
    sampleBody: { label: 'x', cart: { lines: [], discount: { type: 'AMOUNT', value: 0 }, paymentMethod: 'CASH' } },
  },
  {
    method: 'DELETE',
    path: '/sales/parked/:id',
    access: 'sales.create',
    load: () => import('@/app/api/v1/sales/parked/[id]/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  // --- stock ---
  {
    method: 'POST',
    path: '/stock/adjustments',
    access: 'stock.adjust',
    load: () => import('@/app/api/v1/stock/adjustments/route'),
    sampleBody: { items: [{ variantId: '00000000-0000-4000-8000-000000000001', qtyDelta: 1, reason: 'FOUND' }] },
  },
  { method: 'GET', path: '/stock/movements', access: 'stock.read.ledger', load: () => import('@/app/api/v1/stock/movements/route') },
  { method: 'GET', path: '/stock/counts', access: 'stock.count.read', load: () => import('@/app/api/v1/stock/counts/route') },
  { method: 'POST', path: '/stock/counts', access: 'stock.count.manage', load: () => import('@/app/api/v1/stock/counts/route'), sampleBody: {} },
  {
    method: 'GET',
    path: '/stock/counts/:id',
    access: 'stock.count.read',
    load: () => import('@/app/api/v1/stock/counts/[id]/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'PATCH',
    path: '/stock/counts/:id',
    access: 'stock.count.read',
    load: () => import('@/app/api/v1/stock/counts/[id]/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
    sampleBody: { items: [{ variantId: '00000000-0000-4000-8000-000000000001', countedQty: 1 }] },
  },
  {
    method: 'POST',
    path: '/stock/counts/:id/apply',
    access: 'stock.count.manage',
    load: () => import('@/app/api/v1/stock/counts/[id]/apply/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
    sampleBody: {},
  },
  {
    method: 'POST',
    path: '/stock/counts/:id/cancel',
    access: 'stock.count.manage',
    load: () => import('@/app/api/v1/stock/counts/[id]/cancel/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  { method: 'GET', path: '/stock/low', access: 'stock.read', load: () => import('@/app/api/v1/stock/low/route') },
  { method: 'GET', path: '/stock/purchases', access: 'stock.receive', load: () => import('@/app/api/v1/stock/purchases/route') },
  {
    method: 'POST',
    path: '/stock/purchases',
    access: 'stock.receive',
    load: () => import('@/app/api/v1/stock/purchases/route'),
    sampleBody: { items: [{ variantId: '00000000-0000-4000-8000-000000000001', qty: 1, unitCost: 100 }] },
  },
  {
    method: 'GET',
    path: '/stock/purchases/:id',
    access: 'stock.receive',
    load: () => import('@/app/api/v1/stock/purchases/[id]/route'),
    sampleParams: { id: '00000000-0000-4000-8000-000000000001' },
  },
  {
    method: 'POST',
    path: '/uploads',
    access: 'products.write',
    load: () => import('@/app/api/v1/uploads/route'),
    sampleForm: () => {
      const f = new FormData();
      f.append('file', new File([new Uint8Array([1, 2, 3])], 'x.bin'));
      return f;
    },
  },
];
