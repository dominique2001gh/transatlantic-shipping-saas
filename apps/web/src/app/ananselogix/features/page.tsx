import type { Metadata } from 'next';
import { PageHero } from '@/components/marketing/PageHero';
import { AnalyticsPreview, CustomerPortalPreview } from '@/components/marketing/ProductPreviews';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { featureItems } from '@/lib/ananselogix/site-data';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Customer management, shipment tracking, barcode scanning, container loading, invoicing, and more — the full feature list of the AnanseLogix logistics platform.',
  // Step 3: unprefixed — see ananselogix/page.tsx's own doc comment.
  alternates: { canonical: '/features' },
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

        <div className="mt-20 grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Customer Portal"
              title="Customers see their own shipments"
              description="Status, documents, and invoices — without a call to your office."
            />
            <div className="mt-8">
              <CustomerPortalPreview />
            </div>
          </div>
          <div>
            <SectionHeading
              eyebrow="Analytics"
              title="Revenue and volume, without a spreadsheet"
              description="Available on the Professional plan — see Pricing for what's included in each plan."
            />
            <div className="mt-8">
              <AnalyticsPreview />
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}
