import { isAnanseLogixHostname, isAnanseLogixWwwHostname } from './ananselogix-hostname';
import { platformConfig } from './platform-config';

/**
 * AnanseLogix production site URL / canonical metadata (Step 3): the
 * single source of truth for AnanseLogix's own absolute site URL —
 * reuses platformConfig.domain (the one place AnanseLogix's domain is
 * already recorded — see that file's own doc comment) rather than a
 * second hardcoded 'ananselogix.com' literal, and is overridable via
 * NEXT_PUBLIC_ANANSELOGIX_SITE_URL for any environment where the real
 * domain isn't live yet (staging, preview deploys, local dev).
 *
 * Deliberately a *separate* env var from Trans Atlantic's own
 * NEXT_PUBLIC_SITE_URL (see sitemap.ts/robots.ts/ananselogix/layout.tsx's
 * prior shared use of that single variable) — this app's two brands must
 * never be able to affect each other's canonical URL by only setting one
 * shared value. Setting NEXT_PUBLIC_ANANSELOGIX_SITE_URL can never change
 * Trans Atlantic's own sitemap/robots/metadata, and vice versa.
 */
export const ANANSELOGIX_BASE_URL = process.env.NEXT_PUBLIC_ANANSELOGIX_SITE_URL ?? `https://${platformConfig.domain ?? 'ananselogix.com'}`;

const TRANS_ATLANTIC_BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://talogisticssolutions.com';

/**
 * Resolves the correct absolute base URL for sitemap.xml/robots.txt links,
 * per request host. Safe to do dynamically here — unlike statically
 * generated page metadata (see ananselogix/layout.tsx's own doc comment
 * for why that file needs ANANSELOGIX_BASE_URL directly, fixed at build
 * time, instead) — because both sitemap.ts and robots.ts already call
 * next/headers' headers(), which forces per-request rendering rather than
 * a single value baked in once at build time.
 */
export function resolveSiteBaseUrl(host: string | null | undefined): string {
  if (isAnanseLogixHostname(host) || isAnanseLogixWwwHostname(host)) {
    return ANANSELOGIX_BASE_URL;
  }
  return TRANS_ATLANTIC_BASE_URL;
}
