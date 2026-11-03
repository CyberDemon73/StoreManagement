import type { Metadata } from 'next';
import { SetupScreen } from '@/screens/auth/SetupScreen';

export const metadata: Metadata = { title: 'Set up Avenue Brand' };

export default function SetupPage() {
  return <SetupScreen />;
}
