import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LabelsScreen } from '@/screens/products/LabelsScreen';

export const metadata: Metadata = { title: 'Print labels' };

export default function LabelsPage() {
  return (
    <Suspense fallback={null}>
      <LabelsScreen />
    </Suspense>
  );
}
