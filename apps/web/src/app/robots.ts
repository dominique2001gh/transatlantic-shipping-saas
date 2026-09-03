import type { MetadataRoute } from 'next';

/**
 * Website Launch: disallows every private, authenticated area of this
 * same Next.js deployment — /dashboard (staff), /portal (customer), and
 * /platform (platform admin) must never be crawled or indexed, even
 * though they sit behind login anyway (defense in depth, and keeps them
 * out of search results entirely rather than showing an indexed login
 * wall). Everything else (the public marketing site) is allowed.
 */
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://talogisticssolutions.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/portal', '/platform'],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
