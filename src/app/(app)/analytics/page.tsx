import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AnalyticsScreen } from '@/screens/analytics/AnalyticsScreen';

export const metadata: Metadata = { title: 'Analytics' };

export default function AnalyticsPage() {
  return <Suspense><AnalyticsScreen /></Suspense>;
}
