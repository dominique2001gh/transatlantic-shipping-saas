import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isTransAtlanticHostname } from '@/lib/trans-atlantic-hostname';

/**
 * Website Launch: only the public marketing/content pages belong here —
 * never /login, /register (no unique indexable content, and search
 * engines shouldn't be encouraged toward an auth form), and never
 * /dashboard, /portal, /platform (private, authenticated SaaS areas —
 * see robots.ts, which explicitly disallows crawling those regardless).
 *
 * BASE_URL defaults to the approved production domain
 * (talogisticssolutions.com) but is overridable via NEXT_PUBLIC_SITE_URL
 * so this generates correct absolute URLs in any non-production
 * environment (staging, preview deploys) without code changes.
 */
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://talogisticssolutions.com';

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
 * AnanseLogix Phase 2: the platform's own marketing site, mounted at
 * /ananselogix/* in this single deployment (see AnanseLogixLayout's own
 * doc comment on why — no separate domain/DNS exists yet). Transactional
 * pages (signup wizard, its success page) are excluded, same reasoning
 * as /login and /register above.
 *
 * Production-readiness follow-up: never advertised in the sitemap served
 * on a Trans Atlantic hostname — see isTransAtlanticHostname's own doc
 * comment. These entries only appear when this sitemap is fetched from
 * somewhere other than Trans Atlantic's own domains (local dev, this
 * deployment's raw Railway URL, or eventually ananselogix.com).
 */
const ANANSELOGIX_PATHS: { path: string; priority: number }[] = [
  { path: '/ananselogix', priority: 0.9 },
  { path: '/ananselogix/features', priority: 0.7 },
  { path: '/ananselogix/solutions', priority: 0.7 },
  { path: '/ananselogix/how-it-works', priority: 0.7 },
  { path: '/ananselogix/pricing', priority: 0.8 },
  { path: '/ananselogix/demo', priority: 0.6 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host');
  const paths = isTransAtlanticHostname(host) ? TRANS_ATLANTIC_PATHS : [...TRANS_ATLANTIC_PATHS, ...ANANSELOGIX_PATHS];

  const now = new Date();
  return paths.map(({ path, priority }) => ({
    url: `${BASE_URL}${path}`,
    lastModified: now,
    priority,
  }));
}
