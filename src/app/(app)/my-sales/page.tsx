import { Suspense } from 'react';
import type { Metadata } from 'next';
import { MySalesScreen } from '@/screens/seller/MySalesScreen';

export const metadata: Metadata = { title: 'My sales' };

export default function MySalesPage() {
  return <Suspense><MySalesScreen /></Suspense>;
}
