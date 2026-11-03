'use client';
/**
 * Screens: /catalog/brands · /catalog/categories · /catalog/suppliers · Roles: ADMIN, MANAGER (catalog.write)
 * Calls: GET/POST/PATCH /brands, /categories, /suppliers (see the list files).
 * Layout: three columns on xl with the active list first; one list with Tabs below that.
 */
import { useRouter } from 'next/navigation';
import { useBreakpoint } from '@/lib/use-api';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Tabs } from '@/components/ui/Controls';
import { BrandsList } from './BrandsList';
import { CategoriesList } from './CategoriesList';
import { SuppliersList } from './SuppliersList';

export type CatalogTab = 'brands' | 'categories' | 'suppliers';
const ORDER: CatalogTab[] = ['brands', 'categories', 'suppliers'];
const LABEL: Record<CatalogTab, string> = { brands: 'Brands', categories: 'Categories', suppliers: 'Suppliers' };

export function CatalogScreen({ tab }: { tab: CatalogTab }) {
  const router = useRouter();
  const bp = useBreakpoint();
  const ordered = [tab, ...ORDER.filter((t) => t !== tab)];
  const render = (t: CatalogTab) => (t === 'brands' ? <BrandsList key={t} /> : t === 'categories' ? <CategoriesList key={t} /> : <SuppliersList key={t} />);

  return (
    <>
      <PageHeader title="Catalog" compactTitle={LABEL[tab]} description="Brands, categories and suppliers">
        {bp !== 'desktop' && <Tabs scroll className="mt-3 px-4 md:px-6" value={tab} onChange={(t) => router.push(`/catalog/${t}`)} items={ORDER.map((t) => ({ value: t, label: LABEL[t] }))} />}
      </PageHeader>
      <Page>
        {bp === 'desktop' ? <div className="grid items-start gap-4 xl:grid-cols-3">{ordered.map(render)}</div> : render(tab)}
      </Page>
    </>
  );
}
