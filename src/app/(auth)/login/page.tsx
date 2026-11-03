import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginScreen } from '@/screens/auth/LoginScreen';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return <Suspense><LoginScreen /></Suspense>;
}
