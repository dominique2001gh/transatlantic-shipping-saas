import type { PublicSiteConfigResponse } from '@transatlantic/shared';
import { apiFetch } from './api';

/**
 * Multi-tenant public branding: the already-live, unauthenticated
 * GET /public/site-config/:slug (see SiteConfigService.findPublicBySlug's
 * own doc comment) — the one place a tenant's own name/logo/colors can be
 * read before that tenant's customer has ever logged in. Used by
 * /dropoff/{tenantSlug} to show that specific tenant's own identity
 * instead of falling through to Trans Atlantic's or a generic platform
 * default. 404s (no site configured, or the tenant's plan doesn't include
 * PUBLIC_WEBSITE) the same as any other tenant, by design — callers must
 * treat that as "no tenant branding available" and fall back gracefully,
 * never as an error to surface to the customer.
 */
export function fetchPublicSiteConfig(tenantSlug: string): Promise<PublicSiteConfigResponse> {
  return apiFetch<PublicSiteConfigResponse>(`/public/site-config/${encodeURIComponent(tenantSlug)}`);
}
