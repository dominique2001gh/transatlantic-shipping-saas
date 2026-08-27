import type { Metadata } from 'next';
import { ServiceDetailPage } from '@/components/marketing/ServiceDetailPage';
import { getServiceBySlug } from '@/lib/services-data';

const service = getServiceBySlug('lcl')!;

export const metadata: Metadata = {
  title: service.name,
  description: service.heroDescription,
};

export default function LclPage() {
  return <ServiceDetailPage service={service} />;
}
