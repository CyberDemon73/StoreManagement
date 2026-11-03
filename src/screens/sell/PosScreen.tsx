'use client';
/**
 * Screen: /sell · Roles: ADMIN, MANAGER, SELLER (sales.create)
 * Calls: GET /products?q&categoryId · GET /products/:id (variants, lazy per card) · GET /categories
 *        GET /variants/lookup (scan) · GET /settings · POST /sales · GET|POST|DELETE /sales/parked
 * Layout: catalogue left + cart aside (420 desktop / 360 tablet); on mobile the cart is a sticky
 * bar that opens a Sheet. `?productId=` pins that product at the top. Cart persists in localStorage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bookmark, PauseCircle, Search } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/app/PageHeader';
import { BarcodeScannerButton } from '@/components/app/BarcodeScanner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/Controls';
import { Sheet } from '@/components/ui/Overlay';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { ParkedSale, ProductDetail, ProductListItem, Sale, Variant, VariantWithProduct } from '@/types';
import { useCart, type CartProductRef } from './useCart';
import { CatalogCard, CatalogCardSkeleton } from './CatalogCard';
import { CartPanel, chargeBlocker } from './CartPanel';
import { SaleSuccess } from './SaleSuccess';
import { MAX_PARKED, ParkedPanel } from './ParkedPanel';

export function PosScreen() {
  const auth = useAuth();
  const { toast } = useToast();
  const params = useSearchParams();
  const pinnedId = params.get('productId') ?? undefined;
  const { cart, actions, count } = useCart();

  /* ---- catalogue ---- */
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [categoryId, setCategoryId] = useState<string>();
  const categories = useApi(() => api.catalog.categories(), []);
  const products = useApi(() => api.products.list({ q: dq || undefined, categoryId, pageSize: 12 }), [dq, categoryId]);
  const pinned = useApi(() => api.products.get(pinnedId!), [pinnedId], { enabled: !!pinnedId });
  const settings = useApi(() => api.settings.get(), []);
  const parked = useApi(() => api.sales.parked(), []);

  const [details, setDetails] = useState<Record<string, ProductDetail>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  useEffect(() => { if (pinned.data) setDetails((d) => ({ ...d, [pinned.data!.id]: pinned.data! })); }, [pinned.data]);
  const loadDetail = useCallback(async (id: string) => {
    setLoadingIds((s) => new Set(s).add(id));
    try { const d = await api.products.get(id); setDetails((prev) => ({ ...prev, [id]: d })); }
    catch (e) { toast({ kind: 'error', title: "Couldn't load sizes", body: (e as Error).message }); }
    finally { setLoadingIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }, [toast]);

  const rows: ProductListItem[] = useMemo(() => {
    const list = products.data?.data ?? [];
    if (!pinned.data || dq || categoryId) return list;
    return [pinned.data, ...list.filter((p) => p.id !== pinned.data!.id)];
  }, [products.data, pinned.data, dq, categoryId]);

  /* ---- '/' focuses search ---- */
  const searchWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      searchWrap.current?.querySelector('input')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---- cart totals + stock errors ---- */
  const preview = useMemo(() => api.sales.preview(cart), [cart]);
  const [stockErrors, setStockErrors] = useState<Record<string, string>>({});
  const inCart = useCallback((variantId: string) => cart.lines.find((l) => l.variantId === variantId)?.qty ?? 0, [cart.lines]);

  const addVariant = (variant: Variant, product: CartProductRef) => {
    actions.add(variant, product);
    setStockErrors((e) => { if (!e[variant.id]) return e; const n = { ...e }; delete n[variant.id]; return n; });
  };
  const onScan = (v: VariantWithProduct) => {
    if (v.quantity <= 0) { toast({ kind: 'error', title: `${v.product.name} ${v.size} · ${v.color.name} is out of stock` }); return; }
    addVariant(v, { id: v.product.id, name: v.product.name, tint: v.product.tint });
    toast({ kind: 'success', title: `Added ${v.product.name}`, body: `${v.size} · ${v.color.name} · ${formatMoney(v.sellPrice)}` });
  };

  /* ---- charge ---- */
  const [charging, setCharging] = useState(false);
  const [sale, setSale] = useState<Sale>();
  const [cartOpen, setCartOpen] = useState(false);
  // One Idempotency-Key per checkout attempt; reused on retry so a double tap or a flaky
  // connection never charges twice. Cleared once the sale is created.
  const idemKey = useRef<string>();
  const charge = async () => {
    if (chargeBlocker(cart, settings.data)) return;
    setCharging(true);
    idemKey.current ??= crypto.randomUUID();
    try {
      const s = await api.sales.create(cart, idemKey.current);
      idemKey.current = undefined;
      actions.clear();
      setStockErrors({});
      setCartOpen(false);
      setSale(s);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') {
        setStockErrors(e.fields ?? {});
        toast({ kind: 'error', title: 'Some items are no longer in stock', body: 'Adjust the marked lines and charge again.' });
      } else {
        toast({ kind: 'error', title: "Couldn't complete the sale", body: (e as Error).message });
      }
    } finally { setCharging(false); }
  };

  /* ---- park / resume ---- */
  const [parkedOpen, setParkedOpen] = useState(false);
  const [parking, setParking] = useState(false);
  const [resuming, setResuming] = useState<string>();
  const parkedCount = parked.data?.length ?? 0;
  const parkFull = parkedCount >= MAX_PARKED;
  const park = async () => {
    if (!cart.lines.length || parkFull) return;
    setParking(true);
    const label = cart.customerName?.trim() || `Parked ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    try {
      await api.sales.park(cart, label);
      actions.clear();
      setCartOpen(false);
      await parked.refetch();
      toast({ kind: 'success', title: `Parked as “${label}”`, body: 'Resume it from the Parked list.' });
    } catch (e) { toast({ kind: 'error', title: "Couldn't park the sale", body: (e as Error).message }); }
    finally { setParking(false); }
  };
  const resume = async (p: ParkedSale) => {
    setResuming(p.id);
    try {
      const r = await api.sales.unpark(p.id);
      actions.load(r.cart);
      setStockErrors({});
      setParkedOpen(false);
      await parked.refetch();
      toast({ kind: 'success', title: `Resumed “${r.label}”` });
    } catch (e) { toast({ kind: 'error', title: "Couldn't resume", body: (e as Error).message }); }
    finally { setResuming(undefined); }
  };

  const isSeller = !auth.isManager;
  const panelProps = { cart, actions, preview, isSeller, settings: settings.data, stockErrors, onCharge: () => void charge(), charging };

  if (sale) {
    return (
      <>
        <PageHeader title="Sale complete" className="hidden!" />
        <div className="flex flex-col md:h-[calc(100dvh-56px)]"><SaleSuccess sale={sale} settings={settings.data} onNew={() => setSale(undefined)} /></div>
      </>
    );
  }

  const parkButton = (
    <Button leading={<PauseCircle />} loading={parking} disabled={!cart.lines.length || parkFull} onClick={() => void park()} title={parkFull ? `All ${MAX_PARKED} slots are used. Resume one first.` : undefined}>
      Park <span className="tabular rounded-full bg-surface-2 px-1.5 text-xs text-ink-2">{parkedCount}/{MAX_PARKED}</span>
    </Button>
  );
  const parkedButton = <Button variant="ghost" leading={<Bookmark />} onClick={() => setParkedOpen(true)} aria-label={`Parked sales, ${parkedCount}`}>Parked{parkedCount ? ` · ${parkedCount}` : ''}</Button>;

  return (
    <>
      <PageHeader title="New sale" className="hidden!" />
      <div className="flex flex-col md:h-[calc(100dvh-56px)] md:flex-row md:overflow-hidden">
        {/* Catalogue */}
        <section aria-label="Catalogue" className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
          <header className="flex flex-col gap-2.5 border-b border-line bg-surface px-4 py-2.5 md:flex-row md:items-center md:px-5">
            <h1 className="hidden text-lg font-semibold xl:block">New sale</h1>
            <div className="flex flex-1 items-center gap-2">
              <div ref={searchWrap} className="flex-1 md:max-w-[560px]">
                <SearchInput size="lg" value={q} onChange={setQ} placeholder="Search name, SKU or scan barcode" aria-label="Search catalogue" showKbd={false} />
              </div>
              <BarcodeScannerButton onScan={onScan} size="lg" />
            </div>
            <div className="hidden items-center gap-1.5 md:flex">{parkedButton}{parkButton}</div>
          </header>

          <div role="group" aria-label="Category" className="scrollbar-none flex gap-1.5 overflow-x-auto px-4 pt-3 md:px-5">
            <Chip size="touch" selected={!categoryId} onClick={() => setCategoryId(undefined)}>All</Chip>
            {categories.data?.filter((c) => c.isActive).map((c) => <Chip key={c.id} size="touch" selected={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? undefined : c.id)}>{c.name}</Chip>)}
          </div>

          <div className="grid gap-3 px-4 pb-32 pt-3 md:flex-1 md:grid-cols-2 md:overflow-y-auto md:px-5 md:pb-5 md:content-start 2xl:grid-cols-3">
            {products.initial || (products.loading && !products.data) ? Array.from({ length: 4 }).map((_, i) => <CatalogCardSkeleton key={i} />)
              : products.error && !products.data ? <ErrorState className="md:col-span-2 2xl:col-span-3" error={products.error} onRetry={() => void products.refetch()} />
              : rows.length === 0 ? (
                <EmptyState className="md:col-span-2 2xl:col-span-3" icon={<Search aria-hidden />} title="No products match" body={dq ? `Nothing named or coded “${dq}”${categoryId ? ' in this category' : ''}. Try the scanner.` : 'This category has no active products.'} action={<Button onClick={() => { setQ(''); setCategoryId(undefined); }}>Clear filters</Button>} />
              ) : rows.map((p) => (
                <CatalogCard key={p.id} product={p} detail={details[p.id]} loading={loadingIds.has(p.id)} onLoad={(id) => void loadDetail(id)} onAdd={addVariant} inCart={inCart} />
              ))}
          </div>
        </section>

        {/* Cart aside (tablet/desktop) */}
        <aside aria-label="Cart" className="hidden w-[360px] shrink-0 flex-col border-l border-line bg-surface md:flex xl:w-[420px]">
          <CartPanel {...panelProps} />
        </aside>
      </div>

      {/* Mobile: sticky cart bar + sheet */}
      <div className={cn('fixed inset-x-4 z-30 md:hidden', 'bottom-[calc(76px+env(safe-area-inset-bottom))]')}>
        <button type="button" onClick={() => setCartOpen(true)} aria-label={`Open cart, ${count} items, EGP ${formatMoney(preview.total)}`}
          className="flex min-h-[60px] w-full items-center gap-3 rounded-[14px] bg-accent px-4 text-base font-semibold text-accent-ink shadow-float">
          <span className="tabular rounded-full bg-accent-ink/20 px-2 py-0.5 text-sm" aria-live="polite">{count}</span>
          View cart
          <span className="tabular ml-auto">EGP {formatMoney(preview.total)}</span>
        </button>
      </div>
      <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title={`Cart · ${count} item${count === 1 ? '' : 's'}`} className="h-[92dvh]"
        headerAction={<div className="flex items-center gap-1">{parkButton}<Button variant="ghost" size="sm" disabled={!cart.lines.length} onClick={actions.clear}>Clear</Button></div>}>
        <div className="-mx-4 flex h-full flex-col"><CartPanel {...panelProps} showHeader={false} /></div>
        <div className="mt-3 flex justify-center">{parkedButton}</div>
      </Sheet>

      <ParkedPanel open={parkedOpen} onClose={() => setParkedOpen(false)} parked={parked} onResume={(p) => void resume(p)} resuming={resuming} />
    </>
  );
}
