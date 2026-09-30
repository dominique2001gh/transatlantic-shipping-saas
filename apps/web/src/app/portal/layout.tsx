import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { isAnanseLogixHostname } from '@/lib/ananselogix-hostname';
import { platformConfig } from '@/lib/platform-config';
import PortalLayoutClient from './PortalLayoutClient';

/**
 * Multi-tenant branding fix: same gap and same fix shape as
 * (public)/layout.tsx (see that file's own doc comment) — this route was
 * never scoped in that earlier fix because /portal is authenticated,
 * client-rendered content, architecturally different from the public
 * pages that fix covers. Without this, /portal (and /dashboard, see that
 * route's own layout.tsx) fell straight through to the root layout's
 * static Trans Atlantic title regardless of hostname or which tenant's
 * customer was actually signed in — confirmed in production for Gold
 * Coast: the in-app heading correctly showed "Gold Coast" while the
 * browser tab still read "Trans Atlantic Logistics Solutions...".
 *
 * This only ever provides the *default* — the generic AnanseLogix title
 * on ananselogix.com, Trans Atlantic's own unchanged everywhere else —
 * since the server genuinely cannot know which tenant an authenticated
 * request belongs to (the session lives in localStorage, not a cookie
 * this function could read). The real, tenant-specific title ("Gold
 * Coast — Customer Portal") is set client-side once useTenant() resolves
 * — see PortalLayoutClient.tsx's own doc comment.
 */
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host');
  if (!isAnanseLogixHostname(host)) {
    return {}; // Trans Atlantic (or any other hostname): no override, root layout's own default applies unchanged
  }

  return {
    title: { absolute: `${platformConfig.name} · Customer Portal` },
    description: platformConfig.tagline,
    openGraph: {
      type: 'website',
      siteName: platformConfig.name,
      title: `${platformConfig.name} · Customer Portal`,
      description: platformConfig.tagline,
    },
    twitter: {
      card: 'summary',
      title: `${platformConfig.name} · Customer Portal`,
    },
  };
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalLayoutClient>{children}</PortalLayoutClient>;
}
