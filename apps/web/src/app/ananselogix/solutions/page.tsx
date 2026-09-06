import type { Metadata } from 'next';
import { CTASection } from '@/components/marketing/CTASection';
import { PageHero } from '@/components/marketing/PageHero';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { solutionItems } from '@/lib/ananselogix/site-data';

export const metadata: Metadata = {
  title: 'Solutions',
  description: 'AnanseLogix solutions for freight forwarders, ocean and air carriers, RoRo shippers, consolidators, warehousing operators, and diaspora logistics companies.',
  alternates: { canonical: '/ananselogix/solutions' },
};

export default function AnanseLogixSolutionsPage() {
  return (
    <>
      <PageHero
        kicker="Solutions"
        title="Built for every kind of shipping business"
        description="Freight forwarders, ocean and air carriers, RoRo shippers, consolidators, warehousing operators, and diaspora-focused logistics companies."
      />
      <Container className="py-16 lg:py-20">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {solutionItems.map((item) => (
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
      <CTASection
        eyebrow="Not Sure Which Fits?"
        title="Tell us about your operation"
        description="We'll walk through your workflow and show you exactly how AnanseLogix maps onto it."
        primaryHref="/ananselogix/demo"
        primaryLabel="Request a Demo"
      />
    </>
  );
}
