'use client';
/**
 * Screen: /stock/low · Roles: ADMIN, MANAGER (stock.read; sellers see names and qty only)
 * Calls: GET /stock/low · GET /settings (default threshold) · GET /variants/:id/sold?days=30 (per row, capped)
 *        GET /stock/movements?variantId&pageSize=1 (out-since date for the first 10 out variants) · PATCH /variants/:id (threshold)
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { formatMoney, formatNumber } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import { KpiCard } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { ErrorState, SkeletonKpis, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ChipMenu } from './ChipMenu';
import { LowStockSection, type LowRow } from './LowStockSection';
import type { VariantWithProduct } from '@/types';

type Show = 'all' | 'out' | 'low';
type Sort = 'urgency' | 'qty' | 'name';
const DAY_MS = 86_400_000;
const SOLD_CAP = 40;
const OUT_CAP = 10;

export function LowStockScreen() {
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [show, setShow] = useState<Show>('all');
  const [brand, setBrand] = useState<string>();
  const [sort, setSort] = useState<Sort>('urgency');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const low = useApi(() => api.stock.low(), []);
  const settings = useApi(() => api.settings.get(), []);
  const out = useMemo(() => low.data?.out ?? [], [low.data]);
  const lowRows = useMemo(() => low.data?.low ?? [], [low.data]);

  const soldIds = useMemo(() => [...out, ...lowRows].slice(0, SOLD_CAP).map((v) => v.id), [out, lowRows]);
  const sold = useApi(async () => Object.fromEntries(await Promise.all(soldIds.map(async (id) => [id, await api.stock.soldLast(id, 30)] as const))) as Record<string, number>, [soldIds.join(',')], { enabled: soldIds.length > 0 });
  const outIds = useMemo(() => out.slice(0, OUT_CAP).map((v) => v.id), [out]);
  const outSince = useApi(async () => Object.fromEntries(await Promise.all(outIds.map(async (id) => { const m = await api.stock.movements({ variantId: id, pageSize: 1 }); return [id, m.data[0]?.createdAt] as const; }))) as Record<string, string | undefined>, [outIds.join(',')], { enabled: outIds.length > 0 });

  const daysOut = (id: string): number | undefined => { const at = outSince.data?.[id]; return at ? Math.max(1, Math.floor((Date.now() - new Date(at).getTime()) / DAY_MS)) : undefined; };
  const toRow = (v: VariantWithProduct): LowRow => ({ v, sold30: sold.data?.[v.id], daysOut: v.quantity <= 0 ? daysOut(v.id) : undefined });

  const brands = useMemo(() => Array.from(new Set([...out, ...lowRows].map((v) => v.product.brandName))).sort(), [out, lowRows]);
  const filterSort = (rows: VariantWithProduct[]) => {
    const list = rows.filter((v) => !brand || v.product.brandName === brand).map(toRow);
    if (sort === 'qty') list.sort((a, b) => a.v.quantity - b.v.quantity);
    if (sort === 'name') list.sort((a, b) => a.v.product.name.localeCompare(b.v.product.name));
    return list; // 'urgency' keeps the API order (sold in last 30 days, descending)
  };
  const outView = show === 'low' ? [] : filterSort(out);
  const lowView = show === 'out' ? [] : filterSort(lowRows);

  const lostSales = out.slice(0, OUT_CAP).reduce((a, v) => { const s = sold.data?.[v.id]; const d = daysOut(v.id); return s === undefined || d === undefined ? a : a + Math.round((s * v.sellPrice) / 30) * d; }, 0);
  const outProducts = new Set(out.map((v) => v.productId)).size;

  const onThreshold = async (v: VariantWithProduct, next: number) => {
    const prev = v.lowStockThreshold;
    const applyLocal = (t: number) => low.setData((d) => d && { out: d.out.map((x) => (x.id === v.id ? { ...x, lowStockThreshold: t } : x)), low: d.low.map((x) => (x.id === v.id ? { ...x, lowStockThreshold: t } : x)) });
    try {
      await api.variants.update(v.id, { lowStockThreshold: next });
      applyLocal(next);
      toast({ kind: 'success', title: `Threshold set to ${next}`, body: `${v.product.name} · ${v.size} · ${v.color.name}`, action: { label: 'Undo', onClick: () => { void api.variants.update(v.id, { lowStockThreshold: prev }).then(() => { applyLocal(prev); void low.refetch(); }); } } });
      void low.refetch();
    } catch (e) { toast({ kind: 'error', title: "Couldn't save the threshold", body: (e as Error).message }); }
  };

  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const canAct = auth.can('stock.receive');

  return (
    <>
      <PageHeader title="Low & out of stock" compactTitle="Low stock" crumbs={[{ label: 'Stock' }, { label: 'Low & out of stock' }]}
        actions={canAct ? <Button variant="primary" disabled={selected.size === 0} onClick={() => router.push(`/stock/receive?variantIds=${Array.from(selected).join(',')}`)}>Receive all selected{selected.size ? ` · ${selected.size}` : ''}</Button> : undefined} />
      <Page>
        {low.error && !low.data ? <ErrorState error={low.error} onRetry={() => void low.refetch()} /> : (
          <>
            <section aria-label="Key figures" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {low.initial ? <SkeletonKpis count={4} /> : (
                <>
                  <KpiCard label="Out of stock" value={<span className="text-danger-ink">{formatNumber(out.length)}</span>} sub={`variants · ${outProducts} product${outProducts === 1 ? '' : 's'}`} />
                  <KpiCard label="Low stock" value={<span className="text-warn-ink">{formatNumber(lowRows.length)}</span>} sub="at or below threshold" />
                  {auth.isManager && <KpiCard label="Lost sales est. (30d)" value={sold.loading || outSince.loading ? <span className="skeleton inline-block h-6 w-20" /> : formatMoney(lostSales, 'EGP', { withCurrency: true, compact: true })} sub="from days out × avg daily sales" />}
                  <KpiCard label="Default threshold" value={settings.data ? formatNumber(settings.data.lowStockDefault) : '—'} sub={canAct ? 'override per variant below' : 'set in Settings'} />
                </>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 'out', 'low'] as Show[]).map((s) => <Chip key={s} selected={show === s} onClick={() => setShow(s)}>{s === 'all' ? 'All' : s === 'out' ? 'Out only' : 'Low only'}</Chip>)}
              <ChipMenu label="Brand" value={brand} onChange={setBrand} options={brands.map((b) => ({ value: b, label: b }))} />
              <ChipMenu label="Sort" value={sort} onChange={(v) => setSort(v ?? 'urgency')} hideAll options={[{ value: 'urgency', label: 'Urgency' }, { value: 'qty', label: 'Quantity' }, { value: 'name', label: 'Name' }]} />
            </div>

            {low.initial ? <SkeletonRows rows={8} /> : (
              <>
                {show !== 'low' && <LowStockSection kind="out" rows={outView} selected={selected} onToggle={toggle} canAct={canAct} showActions={auth.isManager} onThreshold={onThreshold} soldLoading={sold.loading && !sold.data} brandFilter={brand} />}
                {show !== 'out' && <LowStockSection kind="low" rows={lowView} selected={selected} onToggle={toggle} canAct={canAct} showActions={auth.isManager} onThreshold={onThreshold} soldLoading={sold.loading && !sold.data} brandFilter={brand} />}
              </>
            )}
          </>
        )}
      </Page>
    </>
  );
}
