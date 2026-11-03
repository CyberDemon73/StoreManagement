import type { Metadata } from 'next';
import { AdjustScreen } from '@/screens/stock/AdjustScreen';

export const metadata: Metadata = { title: 'Adjust stock' };

export default function AdjustPage() {
  return <AdjustScreen />;
}
