import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { AnanseLogixFooter } from '@/components/ananselogix/AnanseLogixFooter';
import { AnanseLogixHeader } from '@/components/ananselogix/AnanseLogixHeader';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { PublicAiAgentWidget } from '@/components/marketing/PublicAiAgentWidget';
import { isAnanseLogixHostname } from '@/lib/ananselogix-hostname';
import { platformConfig } from '@/lib/platform-config';

/**
 * Multi-tenant branding fix, part 2: the browser-tab title and Open
 * Graph/Twitter preview-card metadata had the exact same gap as the
 * header/footer chrome this layout already fixes below — every page here
 * inherited the root layout's own Trans Atlantic default (see
 * app/layout.tsx's own doc comment) regardless of hostname, since none of
 * these pages declare their own metadata. Scoped to this layout
 * (deliberately not the root layout) so only the (public) route group —
 * already forced dynamic by this same layout's own headers() call below —
 * pays the cost; every other route (dashboard/platform/portal/ananselogix)
 * is unaffected.
 *
 * Same isAnanseLogixHostname check as the header/footer swap below — this
 * is the generic AnanseLogix platform default, not any specific tenant's;
 * a shared layout has no way to know which tenant a given (public) page is
 * for (most of them carry no tenant identifier at all). The one route
 * that does, dropoff/[tenantSlug], overrides this with that tenant's own
 * real name via its own page-level generateMetadata (see that page's own
 * doc comment) — Next.js metadata resolution always lets a more specific
 * page's own metadata win over this layout's default.
 *
 * `title.absolute` (not `default`): Next.js composes a `default` title
 * through every *enclosing* layout's own `template` — including the root
 * layout's `%s · Trans Atlantic`, which would otherwise still append
 * "· Trans Atlantic" onto this AnanseLogix title, the exact leak this
 * whole fix exists to close. `absolute` is the documented way to stop
 * that chain at this level. `template` here still applies normally to
 * whatever a *deeper* page's own plain-string title provides.
 */
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host');
  if (!isAnanseLogixHostname(host)) {
    return {}; // Trans Atlantic (or any other hostname): no override, root layout's own default applies unchanged
  }

  return {
    title: {
      absolute: `${platformConfig.name} · ${platformConfig.tagline}`,
      template: `%s · ${platformConfig.name}`,
    },
    description: platformConfig.tagline,
    openGraph: {
      type: 'website',
      siteName: platformConfig.name,
      title: `${platformConfig.name} · ${platformConfig.tagline}`,
      description: platformConfig.tagline,
    },
  };
}

/**
 * Multi-tenant public-route branding fix: this layout wraps every page in
 * the (public) group — /login, /register, /dropoff, /dropoff/{tenantSlug},
 * /track, /forgot-password, etc. — none of which are in middleware.ts's
 * rewrite matcher (see that file's own doc comment for exactly which
 * paths ARE rewritten to /ananselogix/*). Before this fix, every one of
 * these pages unconditionally rendered PublicHeader/PublicFooter, which
 * read Trans Atlantic's own hardcoded siteConfig — correct on Trans
 * Atlantic's own hostnames, but a real branding leak for Gold Coast,
 * Titanic, or any future tenant reached via ananselogix.com, which has no
 * "own domain" of its own yet.
 *
 * Fix: read the request's own Host header (same isAnanseLogixHostname
 * check middleware.ts and sitemap.ts already use — see that function's
 * own doc comment) and swap in AnanseLogixHeader/AnanseLogixFooter (the
 * same generic platform-brand chrome /ananselogix/* already uses) on
 * ananselogix.com specifically. Every other hostname — Trans Atlantic's
 * own domains, localhost, the raw Railway temp domain — is completely
 * unaffected; isAnanseLogixHostname only ever matches the one bare
 * ananselogix.com apex (www redirects to it before reaching here, per
 * middleware.ts). This is deliberately NOT per-tenant branding (that
 * would need Tenant.customDomain, a bigger not-yet-built feature per
 * tenant-web-app-url.util.ts's own doc comment) — it only ever answers
 * "is this Trans Atlantic's own hostname or not," so it needs zero
 * per-tenant hardcoding and nothing to update as future tenants sign up.
 * The one place actual tenant identity (name/logo) is shown is
 * /dropoff/{tenantSlug}'s own page content, via the public site-config
 * endpoint — see that page's own doc comment.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const host = (await headers()).get('host');
  const isAnanseLogix = isAnanseLogixHostname(host);

  return (
    <div className="flex min-h-screen flex-col" data-brand={isAnanseLogix ? 'ananselogix' : undefined}>
      {isAnanseLogix ? <AnanseLogixHeader /> : <PublicHeader />}
      <main className="flex-1">{children}</main>
      {isAnanseLogix ? <AnanseLogixFooter /> : <PublicFooter />}
      {/* PublicAiAgentWidget always calls the AI agent API with siteConfig.tenantSlug
          (Trans Atlantic's own hardcoded slug) — a real cross-tenant leak, not just a
          branding one, if shown on ananselogix.com. Hidden there rather than shown
          misattributed; making it genuinely tenant-aware is a separate, larger change. */}
      {!isAnanseLogix && <PublicAiAgentWidget />}
    </div>
  );
}
