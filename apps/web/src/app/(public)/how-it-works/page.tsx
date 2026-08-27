import type { Metadata } from 'next';
import { CTASection } from '@/components/marketing/CTASection';
import { PageHero } from '@/components/marketing/PageHero';
import { ProcessTimeline } from '@/components/marketing/ProcessTimeline';
import { Container } from '@/components/ui/Container';
import { fullProcessSteps } from '@/lib/process-data';

export const metadata: Metadata = {
  title: 'How It Works',
  description: 'The shipping journey from request to delivery, step by step.',
};

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        kicker="How It Works"
        title="The shipping journey, step by step"
        description="Every shipment moves through the same coordinated process — from the moment you request it to the moment it's delivered."
      />
      <section className="py-20 lg:py-24">
        <Container>
          <ProcessTimeline steps={fullProcessSteps} />
        </Container>
      </section>
      <CTASection
        eyebrow="Get started"
        title="Ready to start your shipment?"
        description="Request a quote and our team will guide you through each step."
        primaryHref="/quote"
        primaryLabel="Request a Quote"
        secondaryHref="/track"
        secondaryLabel="Track a Shipment"
      />
    </>
  );
}
