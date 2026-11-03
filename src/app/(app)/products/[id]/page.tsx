import type { Metadata } from 'next';
import { ProductDetailScreen } from '@/screens/products/ProductDetailScreen';

export const metadata: Metadata = { title: 'Product' };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetailScreen id={id} />;
}
