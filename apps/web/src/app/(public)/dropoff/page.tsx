'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UserRole } from '@transatlantic/shared';
import { PageHero } from '@/components/marketing/PageHero';
import { LinkButton } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { getStoredToken, getStoredUser } from '@/lib/auth';

/** Where /login and /register send a customer back to after signing in from here — see resolveSafeNextPath's own doc comment for the allow-list that makes this safe. */
const NEXT_QUERY = `?next=${encodeURIComponent('/portal/pre-register')}`;

/**
 * Public, no-login-required entry point for Customer Self-Service
 * Pre-Registration ("Prepared Drop-Off"). Does no work of its own beyond
 * routing: an already-authenticated customer is sent straight to the
 * existing /portal/pre-register page; everyone else sees a short explainer
 * with Sign In / Create Account, both carrying `next=/portal/pre-register`
 * so those existing, unmodified flows land the customer there instead of
 * the normal portal overview.
 *
 * Architecture note: real per-tenant domain/host resolution does not exist
 * anywhere in this codebase yet (see AuthService.customerSignup's own doc
 * comment — Tenant.customDomain is reserved/unused). This page is Trans
 * Atlantic's own public site content, same as every other page under
 * (public) (/login, /register, /track, ...) — not a new tenant hardcode,
 * just the same "the one real tenant today" pattern already used
 * throughout this feature. A future tenant's own branded /dropoff requires
 * that separate, not-yet-built generic tenant-domain infrastructure, not a
 * change to this page.
 */
export default function DropoffPage() {
  const router = useRouter();
  const [checkedSession, setCheckedSession] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (user && getStoredToken() && user.role === UserRole.CUSTOMER) {
      router.replace('/portal/pre-register');
      return;
    }
    setCheckedSession(true);
  }, [router]);

  // Avoids a flash of the Sign In/Create Account choice for the common
  // case (a customer who is already logged in) while the redirect above
  // resolves — same brief-blank-then-content pattern as useRequireAuth.
  if (!checkedSession) {
    return null;
  }

  return (
    <>
      <PageHero
        kicker="Customer Drop-Off"
        title="Prepare Your Drop-Off"
        description="Save time at the warehouse by entering your shipment information before you arrive. When you're finished, we'll give you a QR code to show our staff when you drop off your packages."
      />
      <section className="py-20 lg:py-24">
        <Container className="max-w-xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card sm:p-10">
            <p className="text-sm text-slate-600">
              Sign in to your existing account, or create a new one — either way takes less than a minute.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <LinkButton href={`/login${NEXT_QUERY}`} size="lg">
                Sign In
              </LinkButton>
              <LinkButton href={`/register${NEXT_QUERY}`} variant="secondary" size="lg">
                Create Account
              </LinkButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
