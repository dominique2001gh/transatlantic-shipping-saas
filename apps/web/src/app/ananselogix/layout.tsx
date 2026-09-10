import type { Metadata } from 'next';
import { AnanseLogixFooter } from '@/components/ananselogix/AnanseLogixFooter';
import { AnanseLogixHeader } from '@/components/ananselogix/AnanseLogixHeader';
import { platformConfig } from '@/lib/platform-config';
import { ANANSELOGIX_BASE_URL } from '@/lib/site-base-url';

/**
 * AnanseLogix production site URL / canonical metadata (Step 3): needed
 * so relative `alternates.canonical`/`openGraph.url` values below (and on
 * every child page) resolve to real absolute URLs rather than Next's own
 * localhost fallback. Previously read Trans Atlantic's own
 * NEXT_PUBLIC_SITE_URL (defaulting to talogisticssolutions.com) — wrong
 * for this brand's own pages even before Step 3, and risked cross-brand
 * contamination if that shared variable were ever changed for either
 * site. Now reads ANANSELOGIX_BASE_URL (see site-base-url.ts's own doc
 * comment), a dedicated variable/default that can never be affected by
 * anything set for Trans Atlantic, and vice versa. Fixed at build time
 * (static metadata, unlike sitemap.ts/robots.ts's per-request host
 * awareness) — correct for this deployment as long as AnanseLogix and
 * Trans Atlantic share one build; the moment AnanseLogix gets its own
 * Railway service (see this app's Step 2/3/4 plan), that service simply
 * sets its own NEXT_PUBLIC_ANANSELOGIX_SITE_URL, with zero code change.
 */
const BASE_URL = ANANSELOGIX_BASE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: { default: `${platformConfig.name} — Run Your Shipping Business From Anywhere`, template: `%s — ${platformConfig.name}` },
  description: platformConfig.tagline,
  openGraph: {
    siteName: platformConfig.name,
    type: 'website',
  },
  twitter: {
    card: 'summary',
  },
};

/**
 * AnanseLogix's own public marketing site — a distinct brand surface from
 * Trans Atlantic's public site at `/` (see AnanseLogixHeader's own doc
 * comment). Mounted at `/ananselogix/*` for Phase 1 local testing; a
 * dedicated domain/subdomain cutover is deliberately deferred (Section 15
 * of the build brief — no production DNS changes without separate
 * approval).
 *
 * data-brand="ananselogix" activates this brand surface's own indigo/amber
 * corporate palette (see globals.css) instead of Trans Atlantic's default
 * steel-blue/teal — the two brands must render with visibly distinct
 * colors, and every child page/component already reads the same shared
 * primary/accent tokens, so this one attribute is the entire fix.
 */
export default function AnanseLogixLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-brand="ananselogix" className="flex min-h-screen flex-col bg-white">
      <AnanseLogixHeader />
      <main className="flex-1">{children}</main>
      <AnanseLogixFooter />
    </div>
  );
}
