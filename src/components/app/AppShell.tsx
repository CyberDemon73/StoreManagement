'use client';
/**
 * AppShell — responsive chrome around every authenticated page.
 *   <768     bottom tab bar + top bar (title + avatar)
 *   768–1279 collapsible icon rail (expands on hover/tap)
 *   ≥1280    full sidebar with sections and labels
 * Also hosts the global search (⌘K), notifications bell, View-as-seller toggle, offline
 * banner, PWA install prompt and update toast.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Eye, LogOut, Moon, Search, Sun, UserRound, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { isActivePath, navFor, tabsFor, type NavItem } from '@/lib/nav';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Avatar, RoleBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Badge';
import { MenuItem, Popover } from '@/components/ui/Overlay';
import { Segmented } from '@/components/ui/Field';
import { GlobalSearch } from './GlobalSearch';
import { LogoMark, Wordmark } from './Brand';
import { NotificationsPopover } from './Notifications';
import { OfflineBanner, InstallPwaPrompt, UpdateAvailableToast, ViewingAsBanner } from './SystemBanners';

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const user = auth.user!;
  const role = auth.role;
  const nav = navFor(role);
  const low = useApi(() => api.stock.low(), [role], { enabled: auth.can('stock.read') });
  const lowCount = (low.data?.low.length ?? 0) + (low.data?.out.length ?? 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar ≥ xl */}
      <aside className="app-sidebar sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-surface px-3 py-4 xl:flex" aria-label="Main">
        <Link href={role === 'SELLER' ? '/home' : '/dashboard'} className="mb-4 flex items-center gap-3 rounded-lg px-2 py-1">
          <LogoMark />
          <span><Wordmark size="sm" className="block" /><span className="block text-[11px] text-ink-2">Zamalek store</span></span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {nav.map((section, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              {section.title && <p className="eyebrow px-3 pb-1.5 pt-3.5 text-ink-3">{section.title}</p>}
              {section.items.filter((it) => !it.permission || auth.can(it.permission)).map((it) => <SideLink key={it.href} item={it} active={isActivePath(pathname, it.href)} count={it.badge === 'lowStock' ? lowCount : undefined} />)}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 px-2 pt-3"><Avatar name={user.name} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{user.name}</p><p className="truncate text-[11px] text-ink-2">{user.email}</p></div><RoleBadge role={role} /></div>
      </aside>

      {/* Icon rail md–xl */}
      <aside className={cn('app-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col items-stretch border-r border-line bg-surface py-4 transition-[width] duration-200 md:flex xl:hidden', railOpen ? 'w-56 px-2' : 'w-[72px] items-center px-3')} aria-label="Main" onMouseEnter={() => setRailOpen(true)} onMouseLeave={() => setRailOpen(false)}>
        <Link href={role === 'SELLER' ? '/home' : '/dashboard'} className={cn('mb-3 flex items-center gap-3 rounded-lg', railOpen ? 'px-2' : 'justify-center')}><LogoMark />{railOpen && <Wordmark size="sm" />}</Link>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {nav.flatMap((s) => s.items).filter((it) => !it.permission || auth.can(it.permission)).map((it) => (
            <Link key={it.href} href={it.href} aria-label={it.label} aria-current={isActivePath(pathname, it.href) ? 'page' : undefined} title={it.label}
              className={cn('relative flex min-h-11 items-center gap-3 rounded-[10px] text-sm font-medium', railOpen ? 'px-3' : 'justify-center', isActivePath(pathname, it.href) ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
              <it.icon className="size-5 shrink-0" aria-hidden />{railOpen && <span className="truncate">{it.label}</span>}
              {it.badge === 'lowStock' && lowCount > 0 && <span className={cn('rounded-full bg-warn-soft px-1.5 text-[10px] font-semibold text-warn-ink', railOpen ? 'ml-auto' : 'absolute right-1 top-1')}>{lowCount}</span>}
            </Link>
          ))}
        </nav>
        <button type="button" aria-label={railOpen ? 'Collapse navigation' : 'Expand navigation'} onClick={() => setRailOpen((o) => !o)} className="mt-auto flex size-11 items-center justify-center self-center rounded-[10px] text-ink-2 hover:bg-surface-2"><ChevronRight className={cn('size-5 transition-transform', railOpen && 'rotate-180')} /></button>
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        {auth.viewAsSeller && <ViewingAsBanner onExit={() => auth.setViewAsSeller(false)} />}
        <TopBar onSearch={() => setSearchOpen(true)} />
        <main id="main" className="flex-1 pb-24 md:pb-0">{children}</main>
        <BottomTabBar items={tabsFor(role)} pathname={pathname} />
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <InstallPwaPrompt />
      <UpdateAvailableToast />
    </div>
  );
}

export { LogoMark as Logo } from './Brand';

function SideLink({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors', active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
      <item.icon className="size-5 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{item.label}</span>
      {count !== undefined && count > 0 && <span className={cn('rounded-full px-1.5 py-px text-[11px] font-semibold', active ? 'bg-surface text-accent' : 'bg-surface-2 text-ink-2')}>{count}</span>}
    </Link>
  );
}

/* ---------- Top bar ---------- */
export function TopBar({ onSearch }: { onSearch: () => void }) {
  const auth = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const [menu, setMenu] = useState(false);
  const user = auth.user!;
  const canViewAs = auth.user!.role !== 'SELLER' && auth.user!.roles.some((r) => r !== 'SELLER') && (auth.viewAsSeller || auth.can('ui.view_as_seller'));

  return (
    <header className="app-topbar no-print sticky top-0 z-40 flex min-h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur safe-top md:px-5">
      <div className="flex items-center gap-2 md:hidden"><LogoMark size="sm" title="Avenue Stock" /></div>
      <div id="page-title-slot" className="min-w-0 flex-1" />
      <button type="button" onClick={onSearch} className="hidden min-h-9 w-64 items-center gap-2 rounded-input border border-line bg-surface px-3 text-sm text-ink-3 hover:bg-surface-2 lg:flex xl:w-80" aria-label="Search (Command K)"><Search className="size-4" aria-hidden /><span className="flex-1 text-left">Search products, SKUs, sales…</span><Kbd>⌘K</Kbd></button>
      <Button variant="ghost" iconOnly aria-label="Search" onClick={onSearch} className="lg:hidden"><Search /></Button>
      {canViewAs && (
        <Button variant={auth.viewAsSeller ? 'soft' : 'ghost'} size="sm" leading={<Eye />} onClick={() => auth.setViewAsSeller(!auth.viewAsSeller)} aria-pressed={auth.viewAsSeller} className="max-md:hidden">{auth.viewAsSeller ? 'Exit seller view' : 'View as seller'}</Button>
      )}
      <NotificationsPopover />
      <Popover open={menu} onClose={() => setMenu(false)} anchor={<button type="button" aria-label="Account menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)} className="rounded-full"><Avatar name={user.name} /></button>}>
        <div className="flex items-center gap-2.5 px-3 py-2"><Avatar name={user.name} /><div className="min-w-0"><p className="truncate text-sm font-medium">{user.name}</p><p className="truncate text-xs text-ink-2">{user.email}</p></div></div>
        <div className="my-1 h-px bg-line" />
        {user.roles.length > 1 && (
          <>
            <p className="eyebrow px-3 pb-1 pt-1.5 text-ink-3">Acting as</p>
            {user.roles.map((r) => <MenuItem key={r} selected={!auth.viewAsSeller && auth.role === r} onClick={() => { auth.switchRole(r); setMenu(false); router.push(r === 'SELLER' ? '/home' : '/dashboard'); }}><span className="flex-1">{r === 'ADMIN' ? 'Admin' : r === 'MANAGER' ? 'Manager' : 'Seller'}</span>{!auth.viewAsSeller && auth.role === r ? <span className="text-xs text-accent">current</span> : <span className="rounded-full bg-info-soft px-1.5 text-[10px] font-semibold text-info-ink">Switch</span>}</MenuItem>)}
            <div className="my-1 h-px bg-line" />
          </>
        )}
        {canViewAs && <MenuItem onClick={() => { auth.setViewAsSeller(!auth.viewAsSeller); setMenu(false); }}><Eye />{auth.viewAsSeller ? 'Exit seller view' : 'View as seller'}</MenuItem>}
        <MenuItem onClick={() => { router.push('/profile'); setMenu(false); }}><UserRound />Profile &amp; password</MenuItem>
        <div className="flex items-center justify-between px-3 py-1.5 text-sm"><span className="flex items-center gap-2.5 text-ink">{theme.resolved === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}Theme</span><Segmented size="sm" value={theme.theme} onChange={theme.setTheme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Auto' }]} aria-label="Theme" /></div>
        <div className="my-1 h-px bg-line" />
        <MenuItem danger onClick={() => void auth.logout()}><LogOut />Sign out</MenuItem>
      </Popover>
    </header>
  );
}

/* ---------- Bottom tab bar (mobile) ---------- */
function BottomTabBar({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const auth = useAuth();
  return (
    <>
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface safe-bottom md:hidden">
        {items.map((it) => {
          const active = it.href === '/more' ? moreOpen : isActivePath(pathname, it.href);
          const isSell = it.href === '/sell';
          const inner = (
            <>
              {isSell ? <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float"><it.icon className="size-6" aria-hidden /></span> : <it.icon className="size-6" aria-hidden />}
              <span>{it.label}</span>
            </>
          );
          const cls = cn('flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-accent' : 'text-ink-2');
          if (it.href === '/more') return <button key={it.href} type="button" className={cls} onClick={() => setMoreOpen(true)} aria-expanded={moreOpen}>{inner}</button>;
          return <Link key={it.href} href={it.href} aria-current={active ? 'page' : undefined} className={cls}>{inner}</Link>;
        })}
      </nav>
      {moreOpen && (
        <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-label="More">
          <div className="absolute inset-0 bg-ink/35" onClick={() => setMoreOpen(false)} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-8 shadow-float">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-base font-semibold">More</h2><Button variant="ghost" iconOnly aria-label="Close" onClick={() => setMoreOpen(false)}><X /></Button></div>
            {navFor(auth.role).map((s, i) => (
              <div key={i} className="mb-2">{s.title && <p className="eyebrow px-2 pb-1 pt-2 text-ink-3">{s.title}</p>}
                <div className="grid grid-cols-3 gap-2">{s.items.filter((it) => !it.permission || auth.can(it.permission)).map((it) => <Link key={it.href} href={it.href} onClick={() => setMoreOpen(false)} className={cn('flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-card border border-line text-xs font-medium', isActivePath(pathname, it.href) ? 'border-accent bg-accent-soft text-accent' : 'bg-surface text-ink')}><it.icon className="size-5" aria-hidden />{it.label}</Link>)}</div>
              </div>
            ))}
            <Link href="/profile" onClick={() => setMoreOpen(false)} className="mt-2 flex min-h-12 items-center gap-3 rounded-card border border-line px-3 text-sm"><Avatar name={auth.user!.name} size="sm" /><span className="flex-1">Profile &amp; settings</span><ChevronRight className="size-4 text-ink-3" /></Link>
          </div>
        </div>
      )}
    </>
  );
}
