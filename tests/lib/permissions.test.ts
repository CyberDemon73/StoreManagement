import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, PERMISSIONS, ROLES, can, permissionsFor } from '@/lib/permissions';

describe('permission map', () => {
  it('defines exactly the 25 keys from the access matrix', () => {
    expect(ALL_PERMISSIONS).toHaveLength(25);
    expect(ROLES).toEqual(['ADMIN', 'MANAGER', 'SELLER']);
  });

  it('ADMIN has every permission', () => {
    expect(permissionsFor('ADMIN').sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('MANAGER has everything except data.export.all', () => {
    const expected = ALL_PERMISSIONS.filter((p) => p !== 'data.export.all').sort();
    expect(permissionsFor('MANAGER').sort()).toEqual(expected);
    expect(PERMISSIONS.MANAGER.has('data.export.all')).toBe(false);
  });

  it('SELLER has only the seller-facing permissions', () => {
    expect(permissionsFor('SELLER').sort()).toEqual(
      ['products.read', 'catalog.read', 'stock.read', 'stock.count.read', 'sales.create', 'sales.read', 'returns.create'].sort(),
    );
  });

  it('can() answers from the map', () => {
    expect(can({ role: 'SELLER' }, 'analytics.read')).toBe(false);
    expect(can({ role: 'SELLER' }, 'sales.create')).toBe(true);
    expect(can({ role: 'MANAGER' }, 'audit.read')).toBe(true);
  });
});
