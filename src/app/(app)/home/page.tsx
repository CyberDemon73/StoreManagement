import type { Metadata } from 'next';
import { SellerHomeScreen } from '@/screens/seller/SellerHomeScreen';

export const metadata: Metadata = { title: 'Home' };

export default function HomePage() {
  return <SellerHomeScreen />;
}
