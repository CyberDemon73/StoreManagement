import type { Metadata } from 'next';
import { SessionExpiredScreen } from '@/screens/system/SystemScreens';
export const metadata: Metadata = { title: 'Session expired' };
export default function SessionExpiredPage() { return <SessionExpiredScreen />; }
