import type { Metadata } from 'next';
import { ComponentsGallery } from '@/screens/system/ComponentsGallery';

export const metadata: Metadata = { title: 'Component library' };

export default function ComponentsPage() {
  return <ComponentsGallery />;
}
