import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProductsListScreen } from '@/screens/products/ProductsListScreen';

export const metadata: Metadata = { title: 'Products' };

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsListScreen />
    </Suspense>
  );
}
