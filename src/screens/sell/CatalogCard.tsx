'use client';
/**
 * One product in the POS catalogue: thumb, name, brand · SKU, price, size chips, colour
 * swatches and an "Add {size} · {color}" button. Variants load lazily (GET /products/:id)
 * the first time the card is touched, hovered or focused.
 */
import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';
import { Thumb, ColorSwatch } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SizeChip } from '@/components/ui/Controls';
import { Skeleton } from '@/components/ui/States';
import type { ProductDetail, ProductListItem, Variant } from '@/types';
import type { CartProductRef } from './useCart';

export interface CatalogCardProps {
  product: ProductListItem;
  detail?: ProductDetail;
  loading?: boolean;
  onLoad: (id: string) => void;
  onAdd: (variant: Variant, product: CartProductRef) => void;
  /** Qty of a variant already in the cart, so "n avail." reflects what is still free. */
  inCart: (variantId: string) => number;
}

export function CatalogCard({ product, detail, loading, onLoad, onAdd, inCart }: CatalogCardProps) {
  const [size, setSize] = useState<string>();
  const [color, setColor] = useState<string>();
  const load = () => { if (!detail && !loading) onLoad(product.id); };

  const variants = detail?.variants ?? [];
  const free = (v: Variant) => Math.max(0, v.quantity - inCart(v.id));
  const find = (s: string, c: string) => variants.find((v) => v.size === s && v.color.name === c && v.isActive);

  const sizeAvail = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of detail?.sizes ?? []) {
      out[s] = variants.filter((v) => v.size === s && v.isActive && (!color || v.color.name === color)).reduce((a, v) => a + free(v), 0);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, color, inCart]);

  const colorAvail = (name: string) => variants.filter((v) => v.color.name === name && v.isActive && (!size || v.size === size)).reduce((a, v) => a + free(v), 0);

  const picked = size && color ? find(size, color) : undefined;
  const ready = !!picked && free(picked) > 0;
  const label = size && color ? `Add ${size} · ${color}` : 'Add';
  const availText = picked ? `${free(picked)} avail.` : size || color ? (size ? 'Pick a color' : 'Pick a size') : 'Pick size & color';

  const add = () => {
    if (!picked || !ready) return;
    onAdd(picked, { id: product.id, name: product.name, tint: product.tint });
  };

  return (
    <article aria-label={product.name} onPointerEnter={load} onFocus={load} onTouchStart={load} onClick={load}
      className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3 md:p-3.5">
      <div className="flex items-start gap-3">
        <Thumb src={product.coverImage} tint={product.tint} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{product.name}</p>
          <p className="truncate text-xs text-ink-2">{product.brand.name} · {product.baseSku}</p>
        </div>
        <p className="tabular shrink-0 font-semibold">{product.minPrice === product.maxPrice ? formatMoney(product.defaultPrice) : `${formatMoney(product.minPrice, 'EGP', { compact: true })}–${formatMoney(product.maxPrice, 'EGP', { compact: true })}`}</p>
      </div>

      {!detail ? (
        <>
          <div className="flex gap-1.5" aria-busy={loading || undefined}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-14 rounded-full" />)}</div>
          <div className="flex gap-2.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="size-11 rounded-full" />)}</div>
        </>
      ) : (
        <>
          <div role="group" aria-label="Size" className="scrollbar-none flex gap-1.5 overflow-x-auto md:flex-wrap">
            {detail.sizes.map((s) => (
              <SizeChip key={s} size={s} touch selected={size === s} available={sizeAvail[s] ?? 0} onClick={() => setSize(size === s ? undefined : s)} />
            ))}
          </div>
          <div role="group" aria-label="Color" className="flex items-center gap-2.5">
            {detail.colors.map((c) => (
              <ColorSwatch key={c.name} hex={c.hex} name={c.name} size="touch" selected={color === c.name} disabled={colorAvail(c.name) <= 0} onClick={() => setColor(color === c.name ? undefined : c.name)} />
            ))}
            <span className="tabular ml-auto text-xs text-ink-2" aria-live="polite">{availText}</span>
          </div>
        </>
      )}

      <Button variant="primary" size="lg" block disabled={!ready} onClick={add} aria-label={ready ? `${label} to cart` : undefined}>{label}</Button>
    </article>
  );
}

export function CatalogCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3 md:p-3.5" aria-hidden>
      <div className="flex items-start gap-3"><Skeleton className="size-16 rounded-[10px]" /><div className="flex-1"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-1.5 h-3 w-1/3" /></div><Skeleton className="h-4 w-14" /></div>
      <div className="flex gap-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-14 rounded-full" />)}</div>
      <div className="flex gap-2.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="size-11 rounded-full" />)}</div>
      <Skeleton className="h-12 rounded-input" />
    </div>
  );
}
