import type { Metadata } from 'next';
import { CountScreen } from '@/screens/stock/CountScreen';

export const metadata: Metadata = { title: 'Stock count' };

export default function CountPage() {
  return <CountScreen />;
}
