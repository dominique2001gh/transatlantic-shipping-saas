'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UserRole } from '@transatlantic/shared';
import { PageHero } from '@/components/marketing/PageHero';
import { LinkButton } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { getStoredToken, getStoredUser } from '@/lib/auth';

/**
 * Multi-tenant Drop-Off: the tenant-scoped counterpart to
 * apps/web/src/app/(public)/dropoff/page.tsx (deliberately left untouched —
 * that route stays Trans Atlantic's own frozen, already-accepted /dropoff,
 * reached from its own dedicated domain where "/dropoff" alone is already
 * unambiguous). This route exists for every tenant that shares
 * ANANSELOGIX_BASE_URL (ananselogix.com) instead — see
 * resolveTenantDropoffUrl's own doc comment for why those tenants need
 * "/dropoff/{tenantSlug}" instead of bare "/dropoff", and
 * AuthService.customerSignup's own doc comment for how `tenantSlug` is
 * consumed once Sign In/Create Account is followed from here.
 *
 * Deliberately a near-duplicate of the sibling page rather than a shared
 * extracted component: the sibling is frozen/already-accepted production
 * behavior for Trans Atlantic, and this route's only job is to carry
 * `tenantSlug` through — keeping them independent means a future change to
 * one can never accidentally alter the other's behavior.
 */
export default function TenantDropoffPage() {
  const router = useRouter();
  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;
  const [checkedSession, setCheckedSession] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (user && getStoredToken() && user.role === UserRole.CUSTOMER) {
      router.replace('/portal/pre-register');
      return;
    }
    setCheckedSession(true);
  }, [router]);

  if (!checkedSession) {
    return null;
  }

  // `tenant` is only meaningful to /register (see AuthService.customerSignup)
  // — /login already resolves an existing account across tenants by email
  // alone (see AuthService.login's own doc comment on Stage 2C), so Sign In
  // deliberately carries `next` only, not a `tenant` param it wouldn't use.
  const nextParam = `next=${encodeURIComponent('/portal/pre-register')}`;
  const signInQuery = `?${nextParam}`;
  const createAccountQuery = `?${nextParam}&tenant=${encodeURIComponent(tenantSlug)}`;

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
              <LinkButton href={`/login${signInQuery}`} size="lg">
                Sign In
              </LinkButton>
              <LinkButton href={`/register${createAccountQuery}`} variant="secondary" size="lg">
                Create Account
              </LinkButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
