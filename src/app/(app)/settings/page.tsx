import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return <Suspense><SettingsScreen /></Suspense>;
}
