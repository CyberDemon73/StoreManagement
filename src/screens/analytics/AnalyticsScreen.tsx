'use client';
/**
 * Screen: /analytics?tab= · Roles: ADMIN, MANAGER (analytics.read)
 * Calls: GET /analytics/sales-trend · /payment-mix · /top-products · /categories · /size-color ·
 * /slow-movers · /brands · /sellers · /returns · /analytics/export?report (CSV).
 * Tabs: Sales · Profit · Inventory · Brands · Sellers · Returns — one file each in ./tabs.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useBreakpoint } from '@/lib/use-api';
import { useDateRange } from '@/lib/use-date-range';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import { DateRangePicker, Tabs } from '@/components/ui/Controls';
import { useToast } from '@/components/ui/Toast';
import { SalesTab } from './tabs/SalesTab';
import { ProfitTab } from './tabs/ProfitTab';
import { InventoryTab } from './tabs/InventoryTab';
import { BrandsTab } from './tabs/BrandsTab';
import { SellersTab } from './tabs/SellersTab';
import { ReturnsTab } from './tabs/ReturnsTab';
import { downloadUrl } from './tabs/shared';

const TABS = ['sales', 'profit', 'inventory', 'brands', 'sellers', 'returns'] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { sales: 'Sales', profit: 'Profit', inventory: 'Inventory', brands: 'Brands', sellers: 'Sellers', returns: 'Returns' };

export function AnalyticsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const bp = useBreakpoint();
  const { toast } = useToast();
  const [range, setRange] = useDateRange('30d');
  const [exporting, setExporting] = useState(false);
  const raw = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'sales';
  const setTab = (t: Tab) => router.replace(`/analytics?tab=${t}`, { scroll: false });

  const exportCsv = async () => {
    setExporting(true);
    try {
      downloadUrl(await api.analytics.exportCsv(tab, range.from, range.to), `${tab}-${range.from}-${range.to}.csv`);
      toast({ kind: 'success', title: `${LABEL[tab]} report exported`, body: range.label });
    } catch (e) {
      toast({ kind: 'error', title: "Couldn't export", body: (e as Error).message });
    } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader title="Analytics" description={`${range.label} · EGP`} actions={<><DateRangePicker value={range} onChange={setRange} compact={bp !== 'desktop'} /><Button leading={<Download />} loading={exporting} onClick={() => void exportCsv()}>Export CSV</Button></>}>
        <Tabs scroll className="mt-3 px-4 md:px-6" value={tab} onChange={setTab} items={TABS.map((t) => ({ value: t, label: LABEL[t] }))} />
      </PageHeader>
      <Page>
        {tab === 'sales' && <SalesTab range={range} />}
        {tab === 'profit' && <ProfitTab range={range} />}
        {tab === 'inventory' && <InventoryTab range={range} />}
        {tab === 'brands' && <BrandsTab range={range} />}
        {tab === 'sellers' && <SellersTab range={range} />}
        {tab === 'returns' && <ReturnsTab range={range} />}
      </Page>
    </>
  );
}
