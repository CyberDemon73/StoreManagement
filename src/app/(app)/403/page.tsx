import type { Metadata } from 'next';
import { ForbiddenScreen } from '@/screens/system/SystemScreens';
export const metadata: Metadata = { title: 'No access' };
export default function ForbiddenPage() { return <ForbiddenScreen />; }
