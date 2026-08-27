import type { Metadata } from 'next';
import { ServiceDetailPage } from '@/components/marketing/ServiceDetailPage';
import { getServiceBySlug } from '@/lib/services-data';

const service = getServiceBySlug('air-freight')!;

export const metadata: Metadata = {
  title: service.name,
  description: service.heroDescription,
};

export default function AirFreightPage() {
  return <ServiceDetailPage service={service} />;
}
