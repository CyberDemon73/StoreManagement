import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ReceiveScreen } from '@/screens/stock/ReceiveScreen';

export const metadata: Metadata = { title: 'Receive stock' };

export default function ReceivePage() {
  return <Suspense fallback={null}><ReceiveScreen /></Suspense>;
}
