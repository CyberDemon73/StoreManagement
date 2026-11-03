import type { Metadata } from 'next';
import { ForgotScreen } from '@/screens/auth/ForgotScreen';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPage() {
  return <ForgotScreen />;
}
