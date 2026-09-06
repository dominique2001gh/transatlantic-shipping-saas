import type { Metadata } from 'next';
import { CTASection } from '@/components/marketing/CTASection';
import { PageHero } from '@/components/marketing/PageHero';
import { Container } from '@/components/ui/Container';
import { workflowSteps } from '@/lib/ananselogix/site-data';

export const metadata: Metadata = {
  title: 'How It Works',
  description: 'From receiving to final delivery — the operational workflow every shipment moves through on AnanseLogix, with owner-level visibility at every step.',
  alternates: { canonical: '/ananselogix/how-it-works' },
};

export default function AnanseLogixHowItWorksPage() {
  return (
    <>
      <PageHero
        kicker="How It Works"
        title="Receive. Process. Ship. Deliver."
        description="Every step below appends to a permanent tracking history — for the customer, and for you."
      />
      <Container className="py-16 lg:py-20">
        <ol className="relative border-l border-slate-200 pl-8">
          {workflowSteps.map((step, index) => (
            <li key={step.label} className="mb-10 last:mb-0">
              <span className="absolute -left-4 flex h-8 w-8 items-center justify-center rounded-full bg-primary-700 text-sm font-semibold text-white">
                {index + 1}
              </span>
              <h3 className="font-display text-lg font-semibold text-slate-900">{step.label}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.description}</p>
            </li>
          ))}
        </ol>

        <div className="mt-16 rounded-2xl border border-slate-200 bg-slate-50 p-8">
          <h3 className="font-display text-lg font-semibold text-slate-900">Owner-level visibility throughout</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Every scan, status change, and payment above is visible to the business owner in real time — from the
            owner dashboard, without needing to be physically present at any warehouse or office. Staff record what
            happened; the system makes sure the owner can always see it.
          </p>
        </div>
      </Container>
      <CTASection
        eyebrow="Ready to try it?"
        title="See it running on your own workflow"
        description="Start your company on AnanseLogix, or talk to us first."
        primaryHref="/ananselogix/signup"
        primaryLabel="Start Your Company"
        secondaryHref="/ananselogix/demo"
        secondaryLabel="Request a Demo"
      />
    </>
  );
}
