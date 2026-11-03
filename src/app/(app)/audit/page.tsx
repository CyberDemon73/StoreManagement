import type { Metadata } from 'next';
import { AuditScreen } from '@/screens/audit/AuditScreen';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditPage() {
  return <AuditScreen />;
}
