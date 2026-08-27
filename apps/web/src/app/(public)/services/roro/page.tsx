import type { Metadata } from 'next';
import { ServiceDetailPage } from '@/components/marketing/ServiceDetailPage';
import { getServiceBySlug } from '@/lib/services-data';

const service = getServiceBySlug('roro')!;

export const metadata: Metadata = {
  title: service.name,
  description: service.heroDescription,
};

export default function RoroPage() {
  return <ServiceDetailPage service={service} />;
}
