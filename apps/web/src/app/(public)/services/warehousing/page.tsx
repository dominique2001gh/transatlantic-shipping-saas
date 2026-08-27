import type { Metadata } from 'next';
import { ServiceDetailPage } from '@/components/marketing/ServiceDetailPage';
import { getServiceBySlug } from '@/lib/services-data';

const service = getServiceBySlug('warehousing')!;

export const metadata: Metadata = {
  title: service.name,
  description: service.heroDescription,
};

export default function WarehousingPage() {
  return <ServiceDetailPage service={service} />;
}
