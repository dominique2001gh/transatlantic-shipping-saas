import type { Metadata } from 'next';
import { PageHero } from '@/components/marketing/PageHero';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { featureItems } from '@/lib/ananselogix/site-data';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Customer management, shipment tracking, barcode scanning, container loading, invoicing, and more — the full feature list of the AnanseLogix logistics platform.',
  alternates: { canonical: '/ananselogix/features' },
};

export default function AnanseLogixFeaturesPage() {
  return (
    <>
      <PageHero
        kicker="Features"
        title="Everything a logistics operation needs, in one system"
        description="Customer management through analytics — the full list of what AnanseLogix runs today."
      />
      <Container className="py-16 lg:py-20">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featureItems.map((item) => (
            <Card key={item.title}>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
                <item.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
            </Card>
          ))}
        </div>
      </Container>
    </>
  );
}
