import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SetPasswordScreen } from '@/screens/auth/SetPasswordScreen';

export const metadata: Metadata = { title: 'Create your account' };

export default function SetPasswordPage() {
  return <Suspense><SetPasswordScreen /></Suspense>;
}
