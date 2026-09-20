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

/**
 * /dropoff entry point: see the identical reader on the login page's own
 * doc comment — same allow-listed `next` handling, kept in its own
 * Suspense-wrapped component for the same static-prerendering reason.
 * Every account created by this page is CUSTOMER-role already (see
 * CustomerSignupDto's own doc comment), so unlike login there's no
 * role check needed before honoring `next`.
 */
function NextParamReader({ onResolved }: { onResolved: (path: string | null) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    onResolved(resolveSafeNextPath(searchParams.get('next')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  return null;
}

/**
 * Customer Self-Service Pre-Registration, Stage 2: the smallest safe
 * first-time-customer signup path — see AuthService.customerSignup's own
 * doc comment for why this always creates a Trans Atlantic customer
 * account specifically, never an arbitrary tenant, and never anything
 * above a CUSTOMER-role account. Replaces the previous disabled stub —
 * same page/route, so the login page's existing "Create an account" link
 * needs no change.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);

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
        <NextParamReader onResolved={setNextPath} />
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
