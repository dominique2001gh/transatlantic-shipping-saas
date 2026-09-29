import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: `Terms of Service for ${siteConfig.companyName}, including SMS text messaging program terms.`,
};

/**
 * SMS/Twilio A2P: public, no-login Terms & Conditions — see privacy/page.tsx's
 * own doc comment for the same sourcing rules (siteConfig is the single
 * source of truth; legal entity name matches Tenant.legalName as already
 * used in production email footers, not invented for this page).
 */
export default function TermsPage() {
  return (
    <Container className="py-16 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl font-bold text-slate-900">Terms &amp; Conditions</h1>
        <p className="mt-2 text-sm text-slate-500">Effective Date: September 28, 2026</p>

        <div className="mt-10 space-y-10 text-base leading-relaxed text-slate-600">
          <section>
            <p>
              These Terms &amp; Conditions (&quot;Terms&quot;) govern your use of {siteConfig.website} and the
              related shipment tracking, customer portal, and notification services (collectively, the
              &quot;Services&quot;), operated by {siteConfig.legalName} (&quot;{siteConfig.shortName},&quot;
              &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). By using the Services, you agree to these
              Terms. If you do not agree, do not use the Services.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">1. Accounts and Registration</h2>
            <p className="mt-3">
              To use certain features of the Services, you may need to create an account. You are responsible
              for the accuracy of the information you provide and for maintaining the confidentiality of your
              account credentials.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">2. SMS Terms &amp; Conditions</h2>
            <p className="mt-3">
              If you provide your mobile phone number and affirmatively opt in, {siteConfig.shortName} may send
              you SMS text messages related to your shipments, including tracking, arrival, pickup, delivery,
              and service updates. By opting in, you agree to the following:
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Message frequency varies.</li>
              <li>Message and data rates may apply.</li>
              <li>You may reply <strong>STOP</strong> at any time to opt out of further SMS messages.</li>
              <li>You may reply <strong>HELP</strong> for assistance.</li>
              <li>Consent to receive SMS messages is not a condition of any purchase.</li>
            </ul>
            <p className="mt-3">
              For more information about how we collect, use, and protect information related to the SMS
              program, see our{' '}
              <Link href="/privacy" className="font-medium text-primary-700 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">3. Shipping Services</h2>
            <p className="mt-3">
              We coordinate the movement of cargo by ocean, air, and RoRo freight, together with related
              warehousing, consolidation, and tracking services. Estimated transit times, arrival dates, and
              customs clearance timelines are estimates only and are not guaranteed, as they depend on factors
              outside our control, including carrier schedules, customs authorities, and weather.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">4. Payments</h2>
            <p className="mt-3">
              Payments made through the Services are processed by a third-party payment processor. By making a
              payment, you authorize the applicable charge. Invoices, fees, and applicable service charges are
              as communicated to you at the time of booking or invoicing.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">5. Limitation of Liability</h2>
            <p className="mt-3">
              To the fullest extent permitted by law, {siteConfig.shortName} is not liable for indirect,
              incidental, or consequential damages arising from your use of the Services, including delays in
              shipment or SMS/email delivery caused by carriers, customs authorities, or third-party service
              providers outside our control.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">6. Governing Law</h2>
            <p className="mt-3">
              These Terms are governed by the laws of the State of Texas, without regard to its conflict-of-law
              principles.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">7. Changes to These Terms</h2>
            <p className="mt-3">
              We may update these Terms from time to time. Material changes will be reflected by updating the
              effective date above. Continued use of the Services after changes take effect constitutes
              acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">8. Contact Us</h2>
            <p className="mt-3">
              {siteConfig.legalName}
              <br />
              {siteConfig.locations[0]?.streetAddress}, {siteConfig.locations[0]?.city},{' '}
              {siteConfig.locations[0]?.region} {siteConfig.locations[0]?.postalCode}
              <br />
              Email: {siteConfig.contact.email}
              <br />
              Phone: {siteConfig.contact.phone}
            </p>
          </section>
        </div>
      </div>
    </Container>
  );
}
