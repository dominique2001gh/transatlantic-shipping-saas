import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isTransAtlanticHostname } from '@/lib/trans-atlantic-hostname';

/**
 * Website Launch: disallows every private, authenticated area of this
 * same Next.js deployment — /dashboard (staff), /portal (customer), and
 * /platform (platform admin) must never be crawled or indexed, even
 * though they sit behind login anyway (defense in depth, and keeps them
 * out of search results entirely rather than showing an indexed login
 * wall). Everything else (the public marketing site) is allowed.
 *
 * AnanseLogix Phase 2: /onboarding (authenticated setup wizard) and the
 * signup wizard's own transactional pages are excluded the same way —
 * /ananselogix itself (the marketing site) stays crawlable in general.
 *
 * Production-readiness follow-up: on a Trans Atlantic hostname, the
 * *entire* /ananselogix tree is additionally disallowed — see
 * isTransAtlanticHostname's own doc comment. Those pages 404 there
 * anyway (middleware.ts), but this also stops search engines from ever
 * being told those URLs are part of Trans Atlantic's site in the first
 * place, independent of the 404s.
 */
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://talogisticssolutions.com';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host');
  const disallow = ['/dashboard', '/portal', '/platform', '/onboarding', '/ananselogix/signup'];
  if (isTransAtlanticHostname(host)) {
    disallow.push('/ananselogix');
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow,
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
