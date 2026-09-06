import type { Metadata } from 'next';
import { AnanseLogixFooter } from '@/components/ananselogix/AnanseLogixFooter';
import { AnanseLogixHeader } from '@/components/ananselogix/AnanseLogixHeader';
import { platformConfig } from '@/lib/platform-config';

/**
 * Same NEXT_PUBLIC_SITE_URL convention sitemap.ts/robots.ts already use —
 * needed so relative `alternates.canonical`/`openGraph.url` values below
 * (and on every child page) resolve to real absolute URLs rather than
 * Next's own localhost fallback.
 */
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://talogisticssolutions.com';

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
