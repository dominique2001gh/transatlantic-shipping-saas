import type { Metadata } from 'next';
import { QuoteForm } from '@/components/forms/QuoteForm';
import { PageHero } from '@/components/marketing/PageHero';
import { Container } from '@/components/ui/Container';

export const metadata: Metadata = {
  title: 'Request a Quote',
  description: 'Request a freight quote from Trans Atlantic Logistics Solutions.',
};

export default function QuotePage() {
  return (
    <>
      <PageHero
        kicker="Request a Quote"
        title="Tell us about your shipment"
        description="Share a few details about what you're shipping and where it's going, and our team will follow up with a quote."
      />
      <section className="py-20 lg:py-24">
        <Container className="max-w-3xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-card sm:p-10">
            <QuoteForm />
          </div>
        </Container>
      </section>
    </>
  );
}
