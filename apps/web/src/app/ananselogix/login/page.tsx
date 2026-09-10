'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { LoginResponseDto } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { AnanseLogixAuthShell } from '@/components/ananselogix/AnanseLogixAuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button, LinkButton } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { storeSession } from '@/lib/auth';
import { resolveCustomerEntryPoint } from '@/lib/customer-entry-point';
import { resolvePostLoginRoute } from '@/lib/post-login';

/**
 * The central, tenant-neutral AnanseLogix login (Part 1) — the entry
 * point the master SaaS website's "Log In" button uses, as distinct from
 * any tenant's own branded login/portal entry point (Trans Atlantic's
 * stays at /login, untouched by this).
 *
 * This is a branding/entry-point split only, not a second authentication
 * system: it posts to the exact same POST /auth/login every login page
 * uses, which already looks a submitted email up across every tenant
 * (email is unique per-tenant, not globally — see AuthService.login's own
 * doc comment) and returns whichever account's password matched, with its
 * real role and tenantId from a verified JWT. This page never asks for or
 * accepts a tenant selection — trusting a browser-supplied tenant ID is
 * exactly what tenant-isolation guards elsewhere in this app are built to
 * reject, and there is no reason to introduce that shape here when the
 * backend already resolves it securely from the credentials themselves.
 *
 * This page is for logistics-company operators and platform admins, not
 * shipping customers — end customers belong on their own shipping
 * company's branded website/customer portal (Trans Atlantic's is /login
 * -> /portal), and should never need to know AnanseLogix exists. So a
 * CUSTOMER-role account is deliberately handled differently from every
 * other role here: it is still authenticated (same /auth/login call, same
 * uniform "Invalid email or password" on failure — this page never
 * reveals whether an email exists before a password has been verified),
 * but the resulting session is never stored and the browser is never
 * routed to /portal from this page. Instead resolveCustomerEntryPoint
 * looks up (server-side, from the verified JWT's tenantId — never a
 * value this page could tamper with) whether that customer's own tenant
 * has a real branded login to send them to; if so we hand them off there,
 * and if not we show a generic message rather than a broken link. Either
 * way, no tenant ID or other internal identifier is ever displayed.
 *
 * Every other role keeps using resolvePostLoginRoute — the same rule
 * (onboarding-incomplete owners/admins -> /onboarding, everyone else ->
 * their role's home route, including PLATFORM_ADMIN -> /platform) as
 * /login, so which login page a staff member or platform admin started
 * from never changes where they end up.
 */
export default function AnanseLogixLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [customerNotice, setCustomerNotice] = useState<{ redirectUrl: string | null } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCustomerNotice(null);
    setLoading(true);
    try {
      const response = await apiFetch<LoginResponseDto>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (response.user.role === UserRole.CUSTOMER) {
        const entryPoint = await resolveCustomerEntryPoint(response.accessToken);
        if (entryPoint?.available && entryPoint.url) {
          setCustomerNotice({ redirectUrl: entryPoint.url });
          if (entryPoint.url.startsWith('http')) {
            window.location.href = entryPoint.url;
          } else {
            router.push(entryPoint.url);
          }
        } else {
          setCustomerNotice({ redirectUrl: null });
        }
        return;
      }

      storeSession(response.accessToken, response.user);
      router.push(await resolvePostLoginRoute(response.user));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to log in right now.');
    } finally {
      setLoading(false);
    }
  }

  if (customerNotice) {
    return (
      <AnanseLogixAuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">Customer accounts sign in elsewhere</h1>
        {customerNotice.redirectUrl ? (
          <p className="mt-2 text-sm text-slate-600">Taking you to your shipping company&apos;s Customer Portal…</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Customer accounts are accessed through your shipping company&apos;s website. Please use the Customer
              Portal link provided by your shipping company.
            </p>
            <LinkButton href="/ananselogix" variant="secondary" className="mt-6 justify-center">
              Back to AnanseLogix
            </LinkButton>
          </>
        )}
      </AnanseLogixAuthShell>
    );
  }

  return (
    <AnanseLogixAuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Welcome back</h1>
      <p className="mt-2 text-sm text-slate-600">Sign in to your Ananse Logix account.</p>

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
    </AnanseLogixAuthShell>
  );
}
