import type { Metadata } from 'next';
import { TrackingForm } from '@/components/forms/TrackingForm';
import { PageHero } from '@/components/marketing/PageHero';
import { Container } from '@/components/ui/Container';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Track a Shipment',
  description: 'Track the status of your shipment with Trans Atlantic Logistics Solutions.',
};

export default function TrackPage() {
  return (
    <>
      <PageHero
        kicker="Tracking"
        title="Track your shipment"
        description="Enter your tracking number and last name below to check the latest status."
      />
      <section className="py-20 lg:py-24">
        <Container className="max-w-3xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-card sm:p-10">
            <TrackingForm size="lg" />
            <div className="mt-8 border-t border-slate-100 pt-6">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Tips for tracking your shipment
              </h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-slate-600">
                <li>
                  Tracking numbers look like{' '}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">TAL-2026-000001</code>.
                </li>
                <li>You can find your tracking number on your shipment confirmation.</li>
                <li>Enter the last name on the shipment exactly as we have it on file, to protect your privacy.</li>
                <li>
                  Can&apos;t locate your tracking number? Contact us at{' '}
                  <a
                    href={`mailto:${siteConfig.contact.email}`}
                    className="font-medium text-primary-700 hover:underline"
                  >
                    {siteConfig.contact.email}
                  </a>
                  .
                </li>
              </ul>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
