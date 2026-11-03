import type { LucideIcon } from 'lucide-react';
import { BarChart3, ClipboardCheck, Home, Layers, LayoutDashboard, Package, Receipt, ScrollText, Settings, ShoppingBag, SlidersHorizontal, Tag, TriangleAlert, Truck, User, Users } from 'lucide-react';
import type { Permission, Role } from '@/types';

export interface NavItem { href: string; label: string; icon: LucideIcon; permission?: Permission; badge?: 'lowStock' }
export interface NavSection { title?: string; items: NavItem[] }

/** Route → permission, from docs/ACCESS-MATRIX.md "Page → permission". */
export const ROUTE_PERMISSION: { prefix: string; permission: Permission }[] = [
  { prefix: '/dashboard', permission: 'analytics.read' },
  { prefix: '/analytics', permission: 'analytics.read' },
  { prefix: '/home', permission: 'sales.create' },
  { prefix: '/products/new', permission: 'products.write' },
  { prefix: '/products', permission: 'products.read' },
  { prefix: '/sell', permission: 'sales.create' },
  { prefix: '/sales', permission: 'sales.read' },
  { prefix: '/my-sales', permission: 'sales.read' },
  { prefix: '/stock/receive', permission: 'stock.receive' },
  { prefix: '/stock/adjust', permission: 'stock.adjust' },
  { prefix: '/stock/movements', permission: 'stock.read.ledger' },
  { prefix: '/stock/low', permission: 'stock.read' },
  { prefix: '/stock/count', permission: 'stock.count.read' },
  { prefix: '/catalog', permission: 'catalog.write' },
  { prefix: '/users', permission: 'users.manage' },
  { prefix: '/settings', permission: 'settings.write' },
  { prefix: '/audit', permission: 'audit.read' },
  { prefix: '/labels', permission: 'products.write' },
];

export function permissionForPath(pathname: string): Permission | undefined {
  // /products/:id/edit needs write
  if (/^\/products\/[^/]+\/edit/.test(pathname)) return 'products.write';
  return ROUTE_PERMISSION.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))?.permission;
}

export const MANAGER_NAV: NavSection[] = [
  { items: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'analytics.read' },
    { href: '/products', label: 'Products', icon: Package, permission: 'products.read' },
    { href: '/sell', label: 'Sell', icon: ShoppingBag, permission: 'sales.create' },
    { href: '/sales', label: 'Sales', icon: Receipt, permission: 'sales.read' },
  ] },
  { title: 'Stock', items: [
    { href: '/stock/receive', label: 'Receive', icon: Truck, permission: 'stock.receive' },
    { href: '/stock/adjust', label: 'Adjust', icon: SlidersHorizontal, permission: 'stock.adjust' },
    { href: '/stock/movements', label: 'Movements', icon: Layers, permission: 'stock.read.ledger' },
    { href: '/stock/low', label: 'Low stock', icon: TriangleAlert, permission: 'stock.read', badge: 'lowStock' },
    { href: '/stock/count', label: 'Stock count', icon: ClipboardCheck, permission: 'stock.count.read' },
  ] },
  { title: 'Insights', items: [{ href: '/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics.read' }] },
  { title: 'Manage', items: [
    { href: '/catalog/brands', label: 'Catalog', icon: Tag, permission: 'catalog.write' },
    { href: '/users', label: 'Users', icon: Users, permission: 'users.manage' },
    { href: '/settings', label: 'Settings', icon: Settings, permission: 'settings.write' },
    { href: '/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.read' },
  ] },
];

export const SELLER_NAV: NavSection[] = [
  { items: [
    { href: '/home', label: 'Home', icon: Home },
    { href: '/products', label: 'Products', icon: Package },
    { href: '/sell', label: 'Sell', icon: ShoppingBag },
    { href: '/my-sales', label: 'My sales', icon: Receipt },
    { href: '/profile', label: 'Profile', icon: User },
  ] },
];

/** Bottom tab bar (mobile): 5 tabs max, Sell in the middle. */
export function tabsFor(role: Role): NavItem[] {
  if (role === 'SELLER') return SELLER_NAV[0]!.items;
  return [
    { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
    { href: '/products', label: 'Products', icon: Package },
    { href: '/sell', label: 'Sell', icon: ShoppingBag },
    { href: '/sales', label: 'Sales', icon: Receipt },
    { href: '/more', label: 'More', icon: SlidersHorizontal },
  ];
}

export function navFor(role: Role): NavSection[] {
  return role === 'SELLER' ? SELLER_NAV : MANAGER_NAV;
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/catalog/brands') return pathname.startsWith('/catalog');
  return pathname === href || pathname.startsWith(href + '/');
}
