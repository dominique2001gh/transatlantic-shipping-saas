import Link from 'next/link';
import type { ServiceContent } from '@/lib/services-data';
import { IconArrowRight } from '@/components/icons';

export function ServiceCard({ service }: { service: ServiceContent }) {
  const Icon = service.icon;
  return (
    <Link
      href={`/services/${service.slug}`}
      className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition-all hover:-translate-y-1 hover:border-primary-200 hover:shadow-lg"
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-700 transition-colors group-hover:bg-primary-700 group-hover:text-white">
        <Icon className="h-6 w-6" />
      </span>
      <h3 className="mt-5 font-display text-lg font-semibold text-slate-900">{service.name}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{service.shortDescription}</p>
      <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700">
        Learn more
        <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
