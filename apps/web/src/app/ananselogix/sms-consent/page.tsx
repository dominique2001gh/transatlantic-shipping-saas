'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { ApiError } from '@/lib/api';
import { submitPlatformSmsConsent } from '@/lib/platform-sms-consent';

/**
 * Twilio A2P Campaign compliance: the public SMS opt-in form Twilio's
 * review expects to find at ananselogix.com/sms-consent, for the approved
 * Brand (Sole Proprietor: Debrah Atuahene). See middleware.ts's own doc
 * comment for how this path resolves to this page on that hostname, and
 * PlatformSmsConsentSubmission's schema doc comment for what submitting
 * this form actually records.
 *
 * `smsConsent` starts false — unchecked by default, exactly like every
 * other SMS consent checkbox already established in this codebase (see
 * apps/web/src/app/(public)/register/page.tsx) — and submitting without
 * checking it still succeeds; the backend simply records no consent, per
 * PlatformSmsConsentService.create's own doc comment.
 */
export default function AnanseLogixSmsConsentPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitPlatformSmsConsent({ name, phone, smsConsent });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container className="py-16 lg:py-20">
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-3xl font-bold text-slate-900">SMS Consent</h1>
        <p className="mt-2 text-sm font-medium text-slate-700">Ananse Logix — Operated by Debrah Atuahene</p>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          Ananse Logix provides shipment and logistics notification services used by participating shipping
          companies. Use this form to opt in to receive SMS text updates about your shipments.
        </p>

        <Card className="mt-8">
          {submitted ? (
            <p className="text-sm text-slate-700">
              Thank you — your submission has been received.
              {smsConsent ? ' You have opted in to SMS notifications.' : ' You have not opted in to SMS notifications.'}
            </p>
          ) : (
            <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
              <TextInput
                label="Name"
                id="name"
                required
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <TextInput
                label="Mobile phone number"
                id="phone"
                type="tel"
                required
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3.5 text-sm">
                <input
                  type="checkbox"
                  id="smsConsent"
                  className="mt-0.5"
                  checked={smsConsent}
                  onChange={(event) => setSmsConsent(event.target.checked)}
                />
                <span className="text-slate-600">
                  By checking this box, you agree to receive transactional SMS messages related to shipment and
                  logistics services powered by Ananse Logix. Messages may include package receipt, shipment
                  departure, shipment arrival, delays, readiness for pickup, pickup, and delivery updates. Message
                  frequency varies. Message and data rates may apply. Consent is not a condition of purchase.
                  Reply STOP to opt out or HELP for assistance. See our{' '}
                  <Link href="/privacy" className="font-medium text-primary-700 hover:underline">
                    Privacy Policy
                  </Link>{' '}
                  and{' '}
                  <Link href="/terms" className="font-medium text-primary-700 hover:underline">
                    Terms &amp; Conditions
                  </Link>
                  .
                </span>
              </label>

              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" disabled={submitting} className="mt-1 justify-center">
                {submitting ? 'Submitting…' : 'Submit'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </Container>
  );
}
