import { describe, expect, it } from 'vitest';
import { hidesTabBar } from '@/components/app/AppShell';

describe('hidesTabBar', () => {
  it('hides the mobile tab bar on the product create and edit forms', () => {
    expect(hidesTabBar('/products/new')).toBe(true);
    expect(hidesTabBar('/products/abc-123/edit')).toBe(true);
    expect(hidesTabBar('/products/abc-123/edit/')).toBe(true);
  });

  it('keeps it everywhere else', () => {
    for (const p of ['/products', '/products/abc-123', '/home', '/sell', '/dashboard', '/products/new/x']) expect(hidesTabBar(p)).toBe(false);
  });
});
