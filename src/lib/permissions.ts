export const ROLES = ['ADMIN', 'MANAGER', 'SELLER'] as const;
export type Role = (typeof ROLES)[number];

/** Permission keys, verbatim from docs/ACCESS-MATRIX.md. */
export const ALL_PERMISSIONS = [
  'products.read',
  'products.write',
  'variants.write',
  'catalog.read',
  'catalog.write',
  'stock.read',
  'stock.read.ledger',
  'stock.receive',
  'stock.adjust',
  'stock.count.read',
  'stock.count.manage',
  'sales.create',
  'sales.read',
  'sales.price.override',
  'sales.discount.unlimited',
  'sales.void',
  'returns.create',
  'analytics.read',
  'users.manage',
  'settings.read.full',
  'settings.write',
  'audit.read',
  'export.csv',
  'data.export.all',
  'ui.view_as_seller',
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

// "own"-scoped rows (sales.read, returns.create) grant the permission; ownership is
// enforced inside services with the session user id, never here.
const SELLER_PERMISSIONS: readonly Permission[] = [
  'products.read',
  'catalog.read',
  'stock.read',
  'stock.count.read',
  'sales.create',
  'sales.read',
  'returns.create',
];

// ADMIN and MANAGER are identical today except data.export.all; kept as separate
// sets so they can diverge without a migration.
export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>(ALL_PERMISSIONS),
  MANAGER: new Set<Permission>(ALL_PERMISSIONS.filter((p) => p !== 'data.export.all')),
  SELLER: new Set<Permission>(SELLER_PERMISSIONS),
};

export function can(user: { role: Role }, permission: Permission): boolean {
  return PERMISSIONS[user.role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...PERMISSIONS[role]];
}
