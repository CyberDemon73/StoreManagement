import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PosScreen } from '@/screens/sell/PosScreen';

export const metadata: Metadata = { title: 'New sale' };

export default function SellPage() {
  return <Suspense><PosScreen /></Suspense>;
}
