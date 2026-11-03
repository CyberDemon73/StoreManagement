import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SalesListScreen } from '@/screens/sales/SalesListScreen';

export const metadata: Metadata = { title: 'Sales' };

export default function SalesPage() {
  return <Suspense fallback={null}><SalesListScreen /></Suspense>;
}
