import type { Metadata } from 'next';
import { ProductEditScreen } from '@/screens/products/ProductEditScreen';

export const metadata: Metadata = { title: 'Edit product' };

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductEditScreen id={id} />;
}
