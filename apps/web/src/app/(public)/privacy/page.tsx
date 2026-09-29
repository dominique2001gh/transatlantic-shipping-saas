import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `Privacy Policy for ${siteConfig.companyName}, including how SMS/text messaging and mobile phone number information is collected, used, and protected.`,
};

/**
 * SMS/Twilio A2P: public, no-login Privacy Policy — required for Twilio's
 * A2P Campaign review and for the SMS consent disclosure on /register to
 * link to. Legal entity name ("Trans Atlantic Logistics Solutions LLC")
 * and contact/address details come from this deployment's own siteConfig
 * (the same single source of truth every other public page already
 * reads from — see site-config.ts's own doc comment) — the LLC suffix
 * specifically matches Tenant.legalName as already rendered in this
 * tenant's real production shipment emails (see
 * shipment-customer-emails.ts), not a name invented for this page.
 */
export default function PrivacyPolicyPage() {
  return (
    <Container className="py-16 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Effective Date: September 28, 2026</p>

        <div className="mt-10 space-y-10 text-base leading-relaxed text-slate-600">
          <section>
            <p>
              {siteConfig.legalName} (&quot;{siteConfig.shortName},&quot; &quot;we,&quot; &quot;us,&quot; or
              &quot;our&quot;) operates {siteConfig.website} and the related shipment tracking, customer
              portal, and notification services (collectively, the &quot;Services&quot;). This Privacy Policy
              explains how we collect, use, and protect your personal information when you use the Services,
              including information related to text message (SMS) communications.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">1. Information We Collect</h2>
            <p className="mt-3">We collect information you provide directly to us, including:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Contact information, such as your name, email address, and mobile phone number.</li>
              <li>Shipment and account information, such as shipping addresses, tracking numbers, and shipment contents.</li>
              <li>Payment information, processed by our payment provider (we do not store full card numbers).</li>
              <li>Communications you send to us, including support requests and messages.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">2. How We Use Your Information</h2>
            <p className="mt-3">We use the information we collect to:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Provide, operate, and maintain the Services, including creating and tracking shipments.</li>
              <li>Send you shipment status notifications and service updates by email, SMS, and/or WhatsApp, according to your preferences.</li>
              <li>Respond to your questions, requests, and customer support inquiries.</li>
              <li>Process payments and maintain billing records.</li>
              <li>Comply with applicable legal and regulatory obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">3. SMS / Text Messaging Program</h2>
            <p className="mt-3">
              If you provide your mobile phone number and affirmatively opt in on our registration form, you
              consent to receive SMS text messages from {siteConfig.shortName} related to your shipments,
              including tracking, arrival, pickup, delivery, and service updates.
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Message frequency varies.</li>
              <li>Message and data rates may apply.</li>
              <li>You may opt out of SMS communications at any time by replying <strong>STOP</strong> to any message we send.</li>
              <li>For help, reply <strong>HELP</strong> to any message, or contact us using the information below.</li>
              <li>Consent to receive SMS messages is not a condition of any purchase or service.</li>
            </ul>
            <p className="mt-3">
              We do not sell or share your SMS opt-in data or personal information with third parties for
              marketing purposes. No mobile information will be shared with third parties or affiliates for
              marketing or promotional purposes. Your mobile number and SMS consent status are used only to
              deliver the shipment and service communications described above and to honor opt-out requests.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">4. How We Share Information</h2>
            <p className="mt-3">
              We do not sell your personal information. We share information only with service providers who
              perform services on our behalf and are bound to use it only for that purpose, including:
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Our SMS/text messaging delivery provider, solely to transmit the messages described above.</li>
              <li>Our email delivery provider, solely to transmit transactional and shipment notification emails.</li>
              <li>Our payment processor, solely to process payments you authorize.</li>
              <li>Infrastructure and hosting providers who operate the systems the Services run on.</li>
            </ul>
            <p className="mt-3">
              We may also disclose information where required to comply with applicable law, regulation, legal
              process, or governmental request.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">5. Data Security</h2>
            <p className="mt-3">
              We use reasonable administrative, technical, and physical safeguards designed to protect your
              personal information. No method of transmission or storage is completely secure, and we cannot
              guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">6. Data Retention</h2>
            <p className="mt-3">
              We retain personal information for as long as needed to provide the Services and for legitimate
              business or legal purposes, such as maintaining shipment and financial records.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">7. Your Choices</h2>
            <p className="mt-3">
              You may update your notification preferences, including SMS, at any time from your customer
              portal account, or by contacting us. You may opt out of SMS at any time by replying STOP. You may
              opt out of marketing email communications using the unsubscribe link included in those emails;
              transactional shipment notifications may continue as needed to service your shipment.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">8. Children&apos;s Privacy</h2>
            <p className="mt-3">
              The Services are not directed to children, and we do not knowingly collect personal information
              from children under 13.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">9. Changes to This Policy</h2>
            <p className="mt-3">
              We may update this Privacy Policy from time to time. Material changes will be reflected by
              updating the effective date above.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-slate-900">10. Contact Us</h2>
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
