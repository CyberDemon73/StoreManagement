import { Suspense } from 'react';
import type { Metadata } from 'next';
import { MovementsScreen } from '@/screens/stock/MovementsScreen';

export const metadata: Metadata = { title: 'Stock movements' };

export default function MovementsPage() {
  return <Suspense fallback={null}><MovementsScreen /></Suspense>;
}
