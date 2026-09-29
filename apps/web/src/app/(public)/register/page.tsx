'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import type { LoginResponseDto } from '@transatlantic/shared';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { storeSession } from '@/lib/auth';
import { resolvePostLoginRoute, resolveSafeNextPath } from '@/lib/post-login';
import { siteConfig } from '@/lib/site-config';

/**
 * /dropoff entry point: see the identical reader on the login page's own
 * doc comment — same allow-listed `next` handling, kept in its own
 * Suspense-wrapped component for the same static-prerendering reason.
 * Every account created by this page is CUSTOMER-role already (see
 * CustomerSignupDto's own doc comment), so unlike login there's no
 * role check needed before honoring `next`.
 *
 * Multi-tenant Drop-Off: also reads `tenant`, present only when this page
 * was reached from a tenant-scoped /dropoff/{tenantSlug} link (see that
 * page's own doc comment) — passed straight through to
 * CustomerSignupDto.tenantSlug on submit. No allow-list needed here the way
 * `next` has one: AuthService.customerSignup independently re-validates the
 * slug against an active Tenant row itself (see that method's own doc
 * comment) before using it, so an unrecognized/absent value never does more
 * than fall back to the existing default tenant.
 */
function NextParamReader({ onResolved }: { onResolved: (path: string | null, tenantSlug: string | null) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    onResolved(resolveSafeNextPath(searchParams.get('next')), searchParams.get('tenant'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  return null;
}

/**
 * Customer Self-Service Pre-Registration: the smallest safe first-time-
 * customer signup path — see AuthService.customerSignup's own doc comment
 * for exactly which tenant this attaches the new account to (the `tenant`
 * query param read above when present, else the same Trans Atlantic default
 * as before) and for why it's never anything above a CUSTOMER-role account.
 * Reached directly (no `tenant` param) at Trans Atlantic's own
 * talogisticssolutions.com/register — unchanged behavior — or via a
 * tenant-scoped /dropoff/{tenantSlug} → Create Account link for every other
 * tenant.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // SMS/Twilio A2P Phase 1: must default to unchecked — affirmative
  // consent only, never assumed. See CustomerSignupDto.smsConsent's own
  // doc comment for how this is recorded server-side.
  const [smsConsent, setSmsConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch<LoginResponseDto>('/auth/customer-signup', {
        method: 'POST',
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          password,
          confirmPassword,
          smsConsent,
          tenantSlug: tenantSlug || undefined,
        }),
      });
      storeSession(response.accessToken, response.user);
      router.push(nextPath ?? (await resolvePostLoginRoute(response.user)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create your account right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Create an account</h1>
      <p className="mt-2 text-sm text-slate-600">
        Create a customer account to prepare drop-offs and track your shipments online.
      </p>

      <Suspense fallback={null}>
        <NextParamReader
          onResolved={(path, tenant) => {
            setNextPath(path);
            setTenantSlug(tenant);
          }}
        />
      </Suspense>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <TextInput
            label="First name"
            id="firstName"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
          <TextInput
            label="Last name"
            id="lastName"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
        <TextInput
          label="Email"
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextInput
          label="Phone (optional)"
          id="phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <TextInput
          label="Password"
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextInput
          label="Confirm password"
          id="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />

        {/*
         * SMS/Twilio A2P Phase 1: unchecked by default (see the smsConsent
         * state above) — declining SMS here never blocks account creation.
         * Tenant name reads from this deployment's own siteConfig (the
         * same single source of truth AuthShell already uses for every
         * other piece of branding on this page), never a hardcoded
         * literal, so the copy stays correct if this page is ever served
         * for a different tenant's own deployment.
         */}
        <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3.5 text-sm">
          <input
            type="checkbox"
            id="smsConsent"
            className="mt-0.5"
            checked={smsConsent}
            onChange={(event) => setSmsConsent(event.target.checked)}
          />
          <span className="text-slate-600">
            I agree to receive SMS messages from {siteConfig.shortName} about my shipments, including
            tracking, arrival, pickup, delivery, and service updates. Message frequency varies. Message
            and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition
            of purchase. See our{' '}
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

        <Button type="submit" size="lg" disabled={loading} className="mt-1 justify-center">
          {loading ? 'Creating account…' : 'Create Account'}
        </Button>
      </form>

      <p className="mt-6 text-sm text-slate-500">
        Already have an account?{' '}
        <Link href={nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login'} className="font-medium text-primary-700">
          Log in
        </Link>
        .
      </p>
    </AuthShell>
  );
}
