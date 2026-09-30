import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { resolveBrandIconVariant } from '@/lib/brand-icon';
import { platformConfig } from '@/lib/platform-config';
import { fetchPublicSiteConfig } from '@/lib/public-site-config';
import { siteConfig } from '@/lib/site-config';
import { RegisterPageClient } from './RegisterPageClient';

/**
 * Multi-tenant branding fix: thin Server Component wrapper around
 * RegisterPageClient.tsx (see that file's own doc comment for the actual
 * interactive page and its history). This file's only job is resolving
 * branding server-side — a page-level `generateMetadata` and the initial
 * brand name shown in the SMS-consent copy both need the request's own
 * Host header and, when present, the `tenant` query param's real
 * site-config, neither of which a Client Component can do before first
 * render without a flash of the wrong name.
 *
 * Precedence:
 *   1. `?tenant=` resolves to a real, active tenant's own site-config →
 *      that tenant's own name (Gold Coast, Titanic, any future tenant) —
 *      this page's own generateMetadata override, below.
 *   2. No `tenant` param (or it fails to resolve) → this page declares no
 *      override, so metadata falls through to (public)/layout.tsx's own
 *      generateMetadata: the generic AnanseLogix platform name on
 *      ananselogix.com, or Trans Atlantic's own default everywhere else
 *      (that layout's own doc comment covers the full precedence) —
 *      never duplicated here.
 * `defaultBrandName` (the SMS-consent copy's visible brand name, not
 * metadata) follows the same two cases directly, since there's no
 * layout-level equivalent to inherit for visible page content.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}): Promise<Metadata> {
  const { tenant } = await searchParams;
  if (!tenant) return {};

  try {
    const config = await fetchPublicSiteConfig(tenant);
    // `title: { absolute: ... }`, not a plain string — see
    // dropoff/[tenantSlug]/page.tsx's own generateMetadata comment for
    // why: a plain string is template-composable and would otherwise pick
    // up the enclosing (public) layout's own "%s · AnanseLogix" template.
    return {
      title: { absolute: `Create an account — ${config.companyName}` },
      openGraph: {
        type: 'website',
        siteName: config.companyName,
        title: `Create an account — ${config.companyName}`,
      },
    };
  } catch {
    // Unrecognized/inactive slug or the lookup failed — no override,
    // same as the no-tenant case above.
    return {};
  }
}

export default async function RegisterPage() {
  const host = (await headers()).get('host');
  // Same brand-level resolver AuthShell's own `brand` prop and the app-wide
  // favicon fallback already use (see resolveBrandIconVariant's own doc
  // comment — "this is what actually fixes the Titanic branding leak" for
  // favicons; this page needed the identical fix for AuthShell's logo/
  // footer, which this same function now also drives) — never re-derived,
  // never a second hostname rule to keep in sync.
  const brand = resolveBrandIconVariant(host);
  const defaultBrandName = brand === 'trans-atlantic' ? siteConfig.shortName : platformConfig.name;
  return <RegisterPageClient brand={brand} defaultBrandName={defaultBrandName} />;
}
