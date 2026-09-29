import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { platformConfig } from '@/lib/platform-config';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'Terms & Conditions for Ananse Logix, including the SMS notification program.',
  alternates: { canonical: '/terms' },
};

/**
 * Twilio A2P Campaign compliance: Ananse Logix's own PLATFORM-level Terms,
 * distinct from Trans Atlantic's tenant-level one at
 * talogisticssolutions.com/terms (untouched by this file). See
 * privacy/page.tsx's own doc comment for the identity/wording rules this
 * page follows identically.
 */
export default function AnanseLogixTermsPage() {
  return (
    <Container className="py-16 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl font-bold text-slate-900">Terms &amp; Conditions</h1>
        <p className="mt-2 text-sm font-medium text-slate-700">Ananse Logix — Operated by Debrah Atuahene</p>
        <p className="mt-1 text-sm text-slate-500">Effective Date: September 29, 2026</p>

        <div className="mt-10 space-y-10 text-base leading-relaxed text-slate-600">
          <section>
            <p>
              These Terms &amp; Conditions (&quot;Terms&quot;) govern your use of this website and the SMS
              notification program described below, operated by Ananse Logix (Ananse Logix — Operated by Debrah
              Atuahene). Ananse Logix provides logistics technology used by participating shipping companies. By
              using this website or opting in to SMS, you agree to these Terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">1. SMS Notification Program</h2>
            <p className="mt-3">
              If you provide your mobile phone number and affirmatively opt in, Ananse Logix may send you
              transactional SMS text messages related to shipment and logistics services, including package
              receipt, shipment departure, shipment arrival, delays, readiness for pickup, pickup, and delivery
              updates. By opting in, you agree to the following:
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Message frequency varies.</li>
              <li>Message and data rates may apply.</li>
              <li>You may reply <strong>STOP</strong> at any time to opt out of further SMS messages.</li>
              <li>You may reply <strong>HELP</strong> for assistance.</li>
              <li>Consent to receive SMS messages is not a condition of any purchase.</li>
            </ul>
            <p className="mt-3">
              For more information about how mobile information is collected, used, and protected, see our{' '}
              <Link href="/privacy" className="font-medium text-primary-700 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">2. Platform, Not a Shipping Company</h2>
            <p className="mt-3">
              Ananse Logix is logistics technology used by independent, participating shipping companies to run
              their own operations. Ananse Logix is not itself a shipping company, and this page does not make
              any shipping company that uses Ananse Logix&apos;s software legally owned by or affiliated with Debrah
              Atuahene beyond its use of this software.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">3. Changes to These Terms</h2>
            <p className="mt-3">
              We may update these Terms from time to time. Material changes will be reflected by updating the
              effective date above.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">4. Contact Us</h2>
            <p className="mt-3">
              Ananse Logix — Operated by Debrah Atuahene
              <br />
              Phone: {platformConfig.contact.supportPhone}
            </p>
          </section>
        </div>
      </div>
    </Container>
  );
}
