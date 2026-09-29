import { headers } from 'next/headers';
import { AnanseLogixFooter } from '@/components/ananselogix/AnanseLogixFooter';
import { AnanseLogixHeader } from '@/components/ananselogix/AnanseLogixHeader';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { PublicAiAgentWidget } from '@/components/marketing/PublicAiAgentWidget';
import { isAnanseLogixHostname } from '@/lib/ananselogix-hostname';

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
