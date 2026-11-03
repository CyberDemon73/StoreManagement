import type { Metadata } from 'next';
import { OfflineScreen } from '@/screens/system/SystemScreens';
export const metadata: Metadata = { title: 'Offline' };
export default function OfflinePage() { return <OfflineScreen />; }
