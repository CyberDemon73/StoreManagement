'use client';
/**
 * Screen: /dashboard · Roles: ADMIN, MANAGER (analytics.read)
 * Calls: GET /analytics/dashboard?from&to (KPIs, trend, brand split, top products, low stock,
 * recent sales in one response).
 * Layout: KPI grid 4 cols on desktop, 2 on tablet, 2-row horizontal snap carousel on mobile.
 */
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useDateRange } from '@/lib/use-date-range';
import { formatMoney, formatNumber, formatPct, formatTime, PAYMENT_LABEL, stockStatus } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { ChartCard, DonutChart, TrendChart, trendSummary, CHART_COLORS } from '@/components/app/Charts';
import { Card, CardHeader, KpiCard, Progress } from '@/components/ui/Card';
import { DateRangePicker } from '@/components/ui/Controls';
import { LinkButton } from '@/components/ui/Button';
import { Badge, ColorSwatch, SaleStatusBadge, StockBadge } from '@/components/ui/Badge';
import { ErrorState, EmptyState, SkeletonKpis } from '@/components/ui/States';
import { useBreakpoint } from '@/lib/use-api';
import type { DashboardData } from '@/types';

export function DashboardScreen() {
  const [range, setRange] = useDateRange('30d');
  const bp = useBreakpoint();
  const dash = useApi(() => api.analytics.dashboard(range.from, range.to), [range.from, range.to]);
  const d = dash.data;

  return (
    <>
      <PageHeader title="Dashboard" description={`${range.label} · Tagamo3 store · EGP`} actions={<DateRangePicker value={range} onChange={setRange} compact={bp !== 'desktop'} />} />
      <Page>
        {dash.error && !d ? <ErrorState error={dash.error} onRetry={() => void dash.refetch()} /> : (
          <>
            <Kpis d={d} loading={dash.initial} />
            <section className="grid gap-4 xl:grid-cols-3">
              <ChartCard className="xl:col-span-2" title="Sales & profit trend" action={<Legend />} fallback={d ? trendSummary(d.trend) : undefined}>
                {d ? <TrendChart data={d.trend} /> : <div className="skeleton h-[180px] rounded-lg" />}
              </ChartCard>
              <ChartCard title="Brand split" fallback={d ? d.brandSplit.map((b) => `${b.name} ${formatPct(b.sharePct, 0)}`).join(' · ') : undefined}>
                {d ? (
                  <div className="flex items-center gap-5">
                    <DonutChart data={d.brandSplit.map((b) => ({ name: b.name, value: b.revenue }))} center={{ value: String(d.brandSplit.length), label: 'brands' }} />
                    <ul className="flex flex-1 flex-col gap-2.5">
                      {d.brandSplit.map((b, i) => <li key={b.id} className="flex items-center gap-2 text-sm"><span aria-hidden className="size-3 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} /><span className="flex-1 truncate">{b.name}</span><span className="tabular font-semibold">{formatMoney(b.revenue, 'EGP', { compact: true })}</span><span className="tabular w-10 text-right text-ink-2">{formatPct(b.sharePct, 0)}</span></li>)}
                    </ul>
                  </div>
                ) : <div className="skeleton h-[140px] rounded-lg" />}
              </ChartCard>
            </section>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <TopProducts d={d} />
              <LowStock d={d} />
              <RecentSales d={d} />
            </section>
          </>
        )}
      </Page>
    </>
  );
}

function Legend() {
  return <div className="flex items-center gap-3 text-xs text-ink-2"><span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-3 bg-accent" />Sales</span><span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-3 border-t-2 border-dashed border-ink-3" />Profit</span></div>;
}

function Kpis({ d, loading }: { d: DashboardData | undefined; loading: boolean }) {
  const k = d?.kpis;
  const cards = k ? [
    <KpiCard key="cash" label="Total cash" value={formatMoney(k.totalCash, 'EGP', { compact: true })} delta={k.deltas.totalCash} deltaLabel="vs previous" sub={<span className="tabular flex flex-wrap gap-x-2.5">{(Object.keys(k.cashByMethod) as (keyof typeof k.cashByMethod)[]).map((m) => <span key={m}>{PAYMENT_LABEL[m]} {formatMoney(k.cashByMethod[m], 'EGP', { compact: true })}</span>)}</span>} />,
    <KpiCard key="profit" label="Gross profit" value={formatMoney(k.grossProfit, 'EGP', { compact: true })} delta={k.deltas.grossProfit} deltaLabel={`· margin ${formatPct(k.marginPct)}`} sparkline={d!.trend.map((t) => t.profit)} />,
    <KpiCard key="cogs" label="COGS" value={formatMoney(k.cogs, 'EGP', { compact: true })} sub="Cost of goods sold" />,
    <KpiCard key="units" label="Items in stock" value={formatNumber(k.unitsInStock)} unit="units" sub={`${k.skusInStock} SKUs · ${k.lowStockCount} low · ${k.outOfStockCount} out`} />,
    <KpiCard key="svc" label="Stock value at cost" value={formatMoney(k.stockValueCost, 'EGP', { compact: true })} sub="EGP · weighted average cost" />,
    <KpiCard key="svr" label="Stock value at retail" value={formatMoney(k.stockValueRetail, 'EGP', { compact: true })} sub={`EGP · potential margin ${formatPct(k.stockValueRetail ? ((k.stockValueRetail - k.stockValueCost) / k.stockValueRetail) * 100 : 0)}`} />,
    <KpiCard key="sales" label="Sales" value={formatNumber(k.salesCount)} delta={k.deltas.salesCount} />,
    <KpiCard key="basket" label="Avg basket" value={formatMoney(k.avgBasket, 'EGP', { compact: true })} delta={k.deltas.avgBasket} />,
  ] : null;
  return (
    <>
      {/* mobile: 2-row snap carousel */}
      <section aria-label="Key figures" className="-mx-4 md:hidden">
        <div className="scrollbar-none grid snap-x snap-mandatory auto-cols-[164px] grid-flow-col grid-rows-2 gap-2.5 overflow-x-auto px-4 pb-1">
          {loading || !cards ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-card" />) : cards.map((c, i) => <div key={i} className={i % 2 === 0 ? 'snap-start' : ''}>{c}</div>)}
        </div>
      </section>
      <section aria-label="Key figures" className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-4 xl:gap-4">
        {loading || !cards ? <SkeletonKpis count={8} /> : cards}
      </section>
    </>
  );
}

function TopProducts({ d }: { d?: DashboardData }) {
  const max = Math.max(1, ...(d?.topProducts.map((t) => t.units) ?? [1]));
  return (
    <Card>
      <CardHeader title="Top 5 products" description="by units sold" action={<Link href="/analytics" className="text-sm text-accent">Analytics</Link>} />
      <ul className="mt-3 flex flex-col gap-2.5">
        {!d ? Array.from({ length: 5 }).map((_, i) => <li key={i} className="skeleton h-6" />) : d.topProducts.length === 0 ? <EmptyState compact title="No sales in this range" /> : d.topProducts.map((t) => (
          <li key={t.productId} className="flex flex-col gap-1"><div className="flex items-center justify-between text-sm"><Link href={`/products/${t.productId}`} className="truncate hover:text-accent">{t.name}</Link><span className="tabular font-semibold">{t.units} u</span></div><Progress value={t.units} max={max} className="h-2" /></li>
        ))}
      </ul>
    </Card>
  );
}

function LowStock({ d }: { d?: DashboardData }) {
  const total = d ? d.kpis.lowStockCount + d.kpis.outOfStockCount : 0;
  return (
    <Card padded={false} className="flex flex-col">
      <CardHeader className="px-4 pt-4 md:px-5 md:pt-5" title="Low stock" action={<Link href="/stock/low" className="text-sm text-accent">View all {total || ''}</Link>} />
      <ul className="mt-2 flex flex-col px-2 pb-2">
        {!d ? Array.from({ length: 4 }).map((_, i) => <li key={i} className="skeleton mx-2 my-1.5 h-9" />) : d.lowStock.length === 0 ? <EmptyState compact title="Nothing is low" body="Every variant is above its threshold." /> : d.lowStock.slice(0, 5).map((v) => (
          <li key={v.id} className="flex min-h-11 items-center gap-2.5 border-b border-line px-2 last:border-0">
            <ColorSwatch hex={v.color.hex} name={v.color.name} />
            <Link href={`/products/${v.productId}`} className="min-w-0 flex-1"><span className="block truncate text-sm">{v.product.name} · {v.size}</span><span className="block text-xs text-ink-2">{v.color.name} · threshold {v.lowStockThreshold}</span></Link>
            <StockBadge status={stockStatus(v.quantity, v.lowStockThreshold)} qty={v.quantity} />
            <LinkButton size="sm" href={`/stock/receive?variantId=${v.id}`}>Receive</LinkButton>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecentSales({ d }: { d?: DashboardData }) {
  return (
    <Card padded={false}>
      <CardHeader className="px-4 pt-4 md:px-5 md:pt-5" title="Recent sales" action={<Link href="/sales" className="text-sm text-accent">All sales</Link>} />
      <ul className="mt-2 flex flex-col px-2 pb-2">
        {!d ? Array.from({ length: 5 }).map((_, i) => <li key={i} className="skeleton mx-2 my-1.5 h-9" />) : d.recentSales.map((s) => (
          <li key={s.id} className="flex min-h-11 items-center gap-3 border-b border-line px-2 last:border-0">
            <Link href={`/sales?open=${s.id}`} className="min-w-0 flex-1"><span className="tabular block text-sm font-semibold">{s.number}{s.status !== 'COMPLETED' && <span className="ml-2 inline-block align-middle"><SaleStatusBadge status={s.status} /></span>}</span><span className="block text-xs text-ink-2">{s.sellerName.split(' ')[0]} · {s.items.length} item{s.items.length === 1 ? '' : 's'} · {PAYMENT_LABEL[s.paymentMethod]}</span></Link>
            <span className="tabular text-sm font-semibold">{formatMoney(s.total)}</span>
            <span className="tabular text-xs text-ink-2">{formatTime(s.createdAt)}</span>
          </li>
        ))}
      </ul>
      {d && d.kpis.salesCount === 0 && <p className="px-4 pb-4 text-xs text-ink-2"><Badge>No sales in range</Badge></p>}
    </Card>
  );
}
