'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import type { LoginResponseDto } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { storeSession } from '@/lib/auth';
import { resolvePostLoginRoute, resolveSafeNextPath } from '@/lib/post-login';

/**
 * Stage 3J: reads ?reason=expired, set only by apiFetch's own 401 handler
 * (see lib/auth.ts's logout doc comment) — never by a user-initiated "Log
 * out" click, which sends no reason. Kept in its own component, wrapped
 * in <Suspense> below, because useSearchParams() requires that boundary
 * for a statically-prerendered page in the App Router; everything else on
 * this page has no such requirement.
 */
function SessionExpiredBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get('reason') !== 'expired') return null;
  return (
    <p role="status" className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Your session expired. Please log in again.
    </p>
  );
}

/**
 * /dropoff entry point: reads `?next=/portal/pre-register` (or nothing) so
 * a customer who arrived here from "Prepare a Drop-Off" lands back there
 * after signing in, instead of the normal portal overview — see
 * resolveSafeNextPath's own doc comment for why this is an allow-list, not
 * an arbitrary redirect. Its own component + <Suspense> wrapper for the
 * same reason as SessionExpiredBanner above: useSearchParams() needs that
 * boundary on a statically-prerendered page.
 */
function NextParamReader({ onResolved }: { onResolved: (path: string | null) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    onResolved(resolveSafeNextPath(searchParams.get('next')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await apiFetch<LoginResponseDto>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      storeSession(response.accessToken, response.user);
      // A `next` override only ever applies to the customer it was built
      // for — staff/platform-admin accounts always land on their normal
      // role-based home, even if a stray `?next=` is present.
      const destination =
        nextPath && response.user.role === UserRole.CUSTOMER ? nextPath : await resolvePostLoginRoute(response.user);
      router.push(destination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to log in right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Welcome back</h1>
      <p className="mt-2 text-sm text-slate-600">
        Staff, customers, and platform administrators all sign in here.
      </p>

      <Suspense fallback={null}>
        <SessionExpiredBanner />
      </Suspense>
      <Suspense fallback={null}>
        <NextParamReader onResolved={setNextPath} />
      </Suspense>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
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
          label="Password"
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Link href="/forgot-password" className="-mt-3 self-end text-sm font-semibold text-primary-700 hover:text-primary-800">
          Forgot password?
        </Link>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="mt-1 justify-center">
          {loading ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        New here?{' '}
        <Link
          href={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : '/register'}
          className="font-semibold text-primary-700 hover:text-primary-800"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
