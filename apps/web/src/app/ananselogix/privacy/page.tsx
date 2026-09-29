import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { platformConfig } from '@/lib/platform-config';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for Ananse Logix, including SMS/mobile information use and non-sharing commitments.',
  alternates: { canonical: '/privacy' },
};

/**
 * Twilio A2P Campaign compliance: Ananse Logix's own PLATFORM-level
 * Privacy Policy, distinct from Trans Atlantic's tenant-level one at
 * talogisticssolutions.com/privacy (untouched by this file). Reachable at
 * ananselogix.com/privacy via middleware.ts's rewrite (see its own doc
 * comment for the extension point this page uses).
 *
 * Identity is deliberately the literal "Ananse Logix — Operated by
 * Debrah Atuahene" throughout, matching Twilio's approved A2P Brand
 * (Sole Proprietor: Debrah Atuahene) exactly — never "AnanseLogix" (the
 * existing platformConfig.name spelling) and never an LLC/corp claim,
 * per this compliance task's explicit identity requirement.
 */
export default function AnanseLogixPrivacyPage() {
  return (
    <Container className="py-16 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm font-medium text-slate-700">Ananse Logix — Operated by Debrah Atuahene</p>
        <p className="mt-1 text-sm text-slate-500">Effective Date: September 29, 2026</p>

        <div className="mt-10 space-y-10 text-base leading-relaxed text-slate-600">
          <section>
            <p>
              Ananse Logix (&quot;Ananse Logix,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is a
              logistics technology platform operated by Debrah Atuahene, providing shipment and logistics
              notification services. This Privacy Policy explains how we collect, use, and protect personal
              information, including information related to SMS/text message communications, when you interact
              with Ananse Logix directly (for example, through this website or the SMS consent form).
            </p>
            <p className="mt-3">
              Ananse Logix provides logistics technology used by participating shipping companies to run their
              own operations and communicate with their own customers. This policy covers information Ananse
              Logix itself collects at the platform level. It does not change or override the privacy practices
              of any individual shipping company that uses Ananse Logix&apos;s software for its own business.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">1. Information We Collect</h2>
            <p className="mt-3">
              When you submit a form on this website (such as the SMS consent form), we collect the information
              you provide, which may include your name and mobile phone number.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">2. How We Use Your Information</h2>
            <p className="mt-3">
              Information you provide is processed as necessary to provide the logistics and shipment
              notification services you request, to respond to your inquiries, and to comply with applicable
              legal obligations. Where you have affirmatively opted in, we use your mobile number to send SMS
              text messages related to shipment and logistics notifications.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">3. SMS / Mobile Information</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Message frequency varies.</li>
              <li>Message and data rates may apply.</li>
              <li>You may opt out of SMS communications at any time by replying <strong>STOP</strong> to any message.</li>
              <li>For assistance, reply <strong>HELP</strong> to any message.</li>
            </ul>
            <p className="mt-3 font-medium text-slate-700">
              SMS opt-in data, mobile numbers, and consent information will not be sold, rented, or shared with
              third parties or affiliates for marketing or promotional purposes.
            </p>
            <p className="mt-3">
              Mobile information is used only to deliver the logistics and shipment notifications described above
              and to honor opt-out requests, and may be processed as necessary to provide the services you
              requested and to comply with legal obligations.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">4. Data Security</h2>
            <p className="mt-3">
              We use reasonable administrative, technical, and physical safeguards designed to protect
              information we collect. No method of transmission or storage is completely secure, and we cannot
              guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">5. Your Choices</h2>
            <p className="mt-3">
              You may opt out of SMS at any time by replying STOP. You may contact us using the information
              below with any question about your information.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">6. Changes to This Policy</h2>
            <p className="mt-3">
              We may update this Privacy Policy from time to time. Material changes will be reflected by
              updating the effective date above.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">7. Contact Us</h2>
            <p className="mt-3">
              Ananse Logix — Operated by Debrah Atuahene
              <br />
              Phone: {platformConfig.contact.supportPhone}
            </p>
          </section>

          <section>
            <p className="text-sm text-slate-500">
              See also our{' '}
              <Link href="/terms" className="font-medium text-primary-700 hover:underline">
                Terms &amp; Conditions
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </Container>
  );
}
