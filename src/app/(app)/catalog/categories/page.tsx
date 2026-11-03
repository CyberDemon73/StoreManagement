import type { Metadata } from 'next';
import { CatalogScreen } from '@/screens/catalog/CatalogScreen';

export const metadata: Metadata = { title: 'Categories' };

export default function CatalogCategoriesPage() {
  return <CatalogScreen tab="categories" />;
}
