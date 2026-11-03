import type { Metadata } from 'next';
import { LowStockScreen } from '@/screens/stock/LowStockScreen';

export const metadata: Metadata = { title: 'Low stock' };

export default function LowStockPage() {
  return <LowStockScreen />;
}
