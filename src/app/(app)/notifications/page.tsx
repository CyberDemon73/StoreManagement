import type { Metadata } from 'next';
import { NotificationsScreen } from '@/screens/system/NotificationsScreen';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return <NotificationsScreen />;
}
