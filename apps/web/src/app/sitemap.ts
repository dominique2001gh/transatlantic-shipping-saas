import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isAnanseLogixHostname, isAnanseLogixWwwHostname } from '@/lib/ananselogix-hostname';
import { resolveSiteBaseUrl } from '@/lib/site-base-url';
import { isTransAtlanticHostname } from '@/lib/trans-atlantic-hostname';

/**
 * Website Launch: only the public marketing/content pages belong here —
 * never /login, /register (no unique indexable content, and search
 * engines shouldn't be encouraged toward an auth form), and never
 * /dashboard, /portal, /platform (private, authenticated SaaS areas —
 * see robots.ts, which explicitly disallows crawling those regardless).
 *
 * Base URL is resolved per-request host via resolveSiteBaseUrl (Step 3 —
 * see site-base-url.ts's own doc comment): talogisticssolutions.com (or
 * NEXT_PUBLIC_SITE_URL override) on Trans Atlantic hostnames, otherwise
 * AnanseLogix's own base URL — correct for both brands from one shared
 * deployment, since this file already calls headers() and renders
 * per-request rather than once at build time.
 */

const TRANS_ATLANTIC_PATHS: { path: string; priority: number }[] = [
  { path: '/', priority: 1 },
  { path: '/about', priority: 0.7 },
  { path: '/how-it-works', priority: 0.7 },
  { path: '/services', priority: 0.8 },
  { path: '/services/air-freight', priority: 0.6 },
  { path: '/services/lcl', priority: 0.6 },
  { path: '/services/ocean-freight', priority: 0.6 },
  { path: '/services/roro', priority: 0.6 },
  { path: '/services/warehousing', priority: 0.6 },
  { path: '/contact', priority: 0.7 },
  { path: '/quote', priority: 0.9 },
  { path: '/track', priority: 0.8 },
];

/**
 * AnanseLogix Phase 2 / Step 3: the platform's own marketing site.
 * Stored here *unprefixed* — Step 2's hostname routing means these pages
 * resolve at the site root on ananselogix.com itself (no /ananselogix in
 * the URL), so the sitemap must advertise the URLs a visitor/crawler
 * actually requests there. The `/ananselogix` prefix is added back below
 * only for the interim case (local dev, this deployment's raw Railway
 * URL) where these pages are still reached by that literal path.
 * Transactional pages (signup wizard, its success page) are excluded,
 * same reasoning as /login and /register above.
 *
 * Production-readiness follow-up: never advertised in the sitemap served
 * on a Trans Atlantic hostname — see isTransAtlanticHostname's own doc
 * comment.
 */
const ANANSELOGIX_PATHS: { path: string; priority: number }[] = [
  { path: '', priority: 0.9 },
  { path: '/features', priority: 0.7 },
  { path: '/solutions', priority: 0.7 },
  { path: '/how-it-works', priority: 0.7 },
  { path: '/pricing', priority: 0.8 },
  { path: '/demo', priority: 0.6 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host');
  const baseUrl = resolveSiteBaseUrl(host);
  const now = new Date();

  if (isAnanseLogixHostname(host) || isAnanseLogixWwwHostname(host)) {
    return ANANSELOGIX_PATHS.map(({ path, priority }) => ({
      url: `${baseUrl}${path || '/'}`,
      lastModified: now,
      priority,
    }));
  }

  const paths = isTransAtlanticHostname(host)
    ? TRANS_ATLANTIC_PATHS
    : [...TRANS_ATLANTIC_PATHS, ...ANANSELOGIX_PATHS.map((p) => ({ path: `/ananselogix${p.path}`, priority: p.priority }))];

  return paths.map(({ path, priority }) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    priority,
  }));
}
