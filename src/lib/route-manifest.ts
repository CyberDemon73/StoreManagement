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
