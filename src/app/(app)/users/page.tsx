import type { Metadata } from 'next';
import { UsersScreen } from '@/screens/users/UsersScreen';

export const metadata: Metadata = { title: 'Users' };

export default function UsersPage() {
  return <UsersScreen />;
}
