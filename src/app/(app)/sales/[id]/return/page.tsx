import type { Metadata } from 'next';
import { ReturnScreen } from '@/screens/sales/ReturnScreen';

export const metadata: Metadata = { title: 'Return items' };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnScreen saleId={id} />;
}
