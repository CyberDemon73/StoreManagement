import type { Metadata } from 'next';
import { CatalogScreen } from '@/screens/catalog/CatalogScreen';

export const metadata: Metadata = { title: 'Brands' };

export default function CatalogBrandsPage() {
  return <CatalogScreen tab="brands" />;
}
