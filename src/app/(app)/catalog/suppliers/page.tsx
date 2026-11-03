import type { Metadata } from 'next';
import { CatalogScreen } from '@/screens/catalog/CatalogScreen';

export const metadata: Metadata = { title: 'Suppliers' };

export default function CatalogSuppliersPage() {
  return <CatalogScreen tab="suppliers" />;
}
