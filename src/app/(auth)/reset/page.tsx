import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ResetScreen } from '@/screens/auth/ResetScreen';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPage() {
  return <Suspense><ResetScreen /></Suspense>;
}
