import type { Metadata } from 'next';
import { ProductEditScreen } from '@/screens/products/ProductEditScreen';

export const metadata: Metadata = { title: 'New product' };

export default function NewProductPage() {
  return <ProductEditScreen />;
}
