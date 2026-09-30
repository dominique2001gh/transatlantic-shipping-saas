'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UserRole } from '@transatlantic/shared';
import { PageHero } from '@/components/marketing/PageHero';
import { LinkButton } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { getStoredToken, getStoredUser } from '@/lib/auth';
import { fetchPublicSiteConfig } from '@/lib/public-site-config';

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
 * Split from the sibling route's page.tsx into this client component plus
 * a thin server page.tsx (see that file's own doc comment): a page-level
 * `generateMetadata` — needed for the browser-tab title/Open Graph/Twitter
 * tags to show this specific tenant's own name — only works in a Server
 * Component, and this page's interactive session-check/hero/buttons need
 * client-side hooks. The visible kicker below does its own client-side
 * fetch of the same public site-config endpoint the server page already
 * fetched for metadata — a small duplicate GET, deliberately not
 * threaded through as a prop, to keep this component independently
 * testable/usable and to keep the server page a pure, minimal wrapper.
 *
 * Branding: the surrounding (public) layout already swaps in generic
 * AnanseLogix chrome (never Trans Atlantic's) on ananselogix.com — see
 * that layout's own doc comment. This component additionally fetches the
 * specific tenant's own name via the already-live, unauthenticated
 * GET /public/site-config/:slug (fetchPublicSiteConfig) and shows it in
 * the kicker once loaded, so Gold Coast sees "Gold Coast" and Titanic
 * sees its own name — no hardcoding, works for any future tenant with a
 * PUBLIC_WEBSITE entitlement. A 404 (no config yet) is silently ignored;
 * the kicker just stays generic, never an error shown to the customer.
 */
export function TenantDropoffPageClient() {
  const router = useRouter();
  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;
  const [checkedSession, setCheckedSession] = useState(false);
  /** Null until the fetch resolves — the kicker/title stay at their generic default the whole time this is null, never a flash of the wrong name. See fetchPublicSiteConfig's own doc comment: a 404 (no PUBLIC_WEBSITE entitlement, or no config saved yet) is expected and normal, not an error — this page must never fail or show anything alarming because of it. */
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    const user = getStoredUser();
    if (user && getStoredToken() && user.role === UserRole.CUSTOMER) {
      router.replace('/portal/pre-register');
      return;
    }
    setCheckedSession(true);
  }, [router]);

  useEffect(() => {
    fetchPublicSiteConfig(tenantSlug)
      .then((config) => setTenantName(config.companyName))
      .catch(() => {
        /* no public branding for this tenant yet — keep the generic kicker/title below */
      });
  }, [tenantSlug]);

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
        kicker={tenantName ? `${tenantName} — Customer Drop-Off` : 'Customer Drop-Off'}
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
