import type { MetadataRoute } from 'next';

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

const PUBLIC_PATHS: { path: string; priority: number }[] = [
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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PUBLIC_PATHS.map(({ path, priority }) => ({
    url: `${BASE_URL}${path}`,
    lastModified: now,
    priority,
  }));
}
