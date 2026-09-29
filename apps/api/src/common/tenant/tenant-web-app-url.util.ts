/**
 * Multi-tenant branding/routing fix (2026-09): the single place that
 * decides which web-app hostname a tenant-facing link (today: the staff
 * invitation's Accept Invitation URL) should point at.
 *
 * Before this fix, every such link was built from the one global
 * WEB_APP_URL env var, which is (and always has been) Trans Atlantic's
 * own production hostname (https://app.talogisticssolutions.com) — that
 * was correct back when Trans Atlantic was the only tenant, but leaks
 * Trans Atlantic's own domain (and, once the browser loads it, Trans
 * Atlantic's branding — see AuthShell/accept-invite's own doc comments)
 * onto every *other* tenant's links too, exactly the bug this closes.
 *
 * Precedence, checked in order:
 *   1. `tenant.customDomain` — once a tenant has its own verified custom
 *      domain configured (the schema field Tenant.customDomain already
 *      reserves for this; not yet populated for any tenant today), its
 *      own links always use it. This is the extension point a future
 *      tenant's own branded activation experience hooks into — no further
 *      code change needed here when that day comes.
 *   2. The legacy-grandfather case: Trans Atlantic pre-dates the
 *      multi-tenant SaaS layer (same "bootstrapped directly before this
 *      layer existed" status EntitlementsGuard/SubscriptionStatusGuard
 *      already document) and has a real production domain
 *      (talogisticssolutions.com) that was never modeled as a
 *      Tenant.customDomain row — LEGACY_CUSTOM_DOMAIN_TENANT_SLUG names
 *      that one tenant by slug (config only, never a database write —
 *      Trans Atlantic's own production Tenant row is deliberately left
 *      untouched by this fix), and WEB_APP_URL keeps meaning exactly what
 *      it always has for that one tenant.
 *   3. Every other tenant (Tatanic included) — ANANSELOGIX_BASE_URL, the
 *      platform's own hostname. This is the fallback that used to
 *      incorrectly be WEB_APP_URL for everyone.
 *
 * Deliberately never reads AuthenticatedUser/request context — this is a
 * pure function of the one tenant row already loaded by the caller, so it
 * can never resolve or leak a *different* tenant's link by accident.
 */

export interface TenantForWebAppUrl {
  slug: string;
  customDomain: string | null;
}

export interface ConfigLike {
  get<T = string>(key: string, defaultValue?: T): T | undefined;
}

export function resolveTenantWebAppUrl(tenant: TenantForWebAppUrl, config: ConfigLike): string {
  if (tenant.customDomain) {
    return `https://${tenant.customDomain}`;
  }

  const legacySlug = config.get<string>('LEGACY_CUSTOM_DOMAIN_TENANT_SLUG');
  if (legacySlug && tenant.slug === legacySlug) {
    return config.get<string>('WEB_APP_URL', 'http://localhost:3000')!;
  }

  return config.get<string>('ANANSELOGIX_BASE_URL', 'http://localhost:3000')!;
}

/**
 * Removes a leading "app." from a hostname — e.g.
 * "https://app.talogisticssolutions.com" -> "https://talogisticssolutions.com".
 * Mirrors this codebase's own existing convention (see middleware.ts's
 * STAFF_HOSTNAME doc comment: "app.talogisticssolutions.com" is Trans
 * Atlantic's staff-only hostname; the bare domain is reserved for the
 * public site + customer portal/login"). Falls back to the input unchanged
 * if it isn't a parseable URL or has no "app." prefix — never throws.
 */
function stripAppSubdomain(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'app' || parsed.hostname.startsWith('app.')) {
      parsed.hostname = parsed.hostname.slice('app.'.length);
    }
    return parsed.origin;
  } catch {
    return url;
  }
}

/**
 * Customer Self-Service Pre-Registration ("Send Drop-Off Link"): resolves
 * where a *customer-facing* link for this tenant should point — distinct
 * from resolveTenantWebAppUrl above, which is specifically for staff-
 * invitation-style links and, for the one legacy-slugged tenant (Trans
 * Atlantic today), deliberately resolves to WEB_APP_URL
 * (app.talogisticssolutions.com — the staff hostname). A customer-facing
 * link must never point at the staff subdomain.
 *
 * Same precedence and same extension point as resolveTenantWebAppUrl (a
 * future tenant's own customDomain always wins, with zero further code
 * change here) — the only difference is what the legacy branch resolves
 * to: the bare public domain (WEB_APP_URL with any "app." prefix
 * stripped), not WEB_APP_URL itself. In local dev, WEB_APP_URL has no
 * "app." prefix (defaults to http://localhost:3000), so this is a no-op
 * there — identical behavior to resolveTenantWebAppUrl for every
 * environment that isn't Trans Atlantic's real production domain.
 */
export function resolveTenantPublicSiteUrl(tenant: TenantForWebAppUrl, config: ConfigLike): string {
  if (tenant.customDomain) {
    return `https://${tenant.customDomain}`;
  }

  const legacySlug = config.get<string>('LEGACY_CUSTOM_DOMAIN_TENANT_SLUG');
  if (legacySlug && tenant.slug === legacySlug) {
    const webAppUrl = config.get<string>('WEB_APP_URL', 'http://localhost:3000')!;
    return stripAppSubdomain(webAppUrl);
  }

  return config.get<string>('ANANSELOGIX_BASE_URL', 'http://localhost:3000')!;
}

/**
 * True when this tenant's public site resolves to the shared, multi-tenant
 * ANANSELOGIX_BASE_URL fallback branch of resolveTenantPublicSiteUrl above
 * (neither a verified customDomain nor the one legacy-grandfathered slug) —
 * i.e. when its public hostname is shared with every other such tenant and
 * therefore cannot, by itself, disambiguate which tenant a request is for.
 * Exported so any caller that needs to know whether a tenant-identifying
 * path segment is required (see resolveTenantDropoffUrl) — or will need to,
 * for the same reason, as more tenant-facing routes go multi-tenant — can
 * ask this one function instead of re-deriving the same precedence.
 */
export function isSharedAnanseLogixDomain(tenant: TenantForWebAppUrl, config: ConfigLike): boolean {
  if (tenant.customDomain) return false;
  const legacySlug = config.get<string>('LEGACY_CUSTOM_DOMAIN_TENANT_SLUG');
  return !(legacySlug && tenant.slug === legacySlug);
}

/**
 * Customer Self-Service Pre-Registration ("Send Drop-Off Link"): the actual
 * /dropoff URL for this tenant, building on resolveTenantPublicSiteUrl.
 *
 * A tenant with its own domain (customDomain, or the one legacy-grandfathered
 * slug) has a public hostname dedicated to exactly one tenant — "/dropoff"
 * on that domain is already unambiguous, so the URL is unchanged from
 * before this function existed (zero behavior change for Trans Atlantic,
 * and for any future customDomain tenant).
 *
 * Every other tenant shares ANANSELOGIX_BASE_URL with every other
 * non-custom-domain tenant — "https://ananselogix.com/dropoff" alone cannot
 * say which tenant it's for, so the tenant's own slug is appended as a path
 * segment: "/dropoff/{slug}". The corresponding frontend route,
 * apps/web/src/app/(public)/dropoff/[tenantSlug]/page.tsx, reads that same
 * segment and threads it through Create Account/Sign In so
 * AuthService.customerSignup resolves the correct tenant — see that
 * function's own doc comment for the rest of this chain.
 */
export function resolveTenantDropoffUrl(tenant: TenantForWebAppUrl, config: ConfigLike): string {
  const baseUrl = resolveTenantPublicSiteUrl(tenant, config).replace(/\/$/, '');
  if (isSharedAnanseLogixDomain(tenant, config)) {
    return `${baseUrl}/dropoff/${tenant.slug}`;
  }
  return `${baseUrl}/dropoff`;
}
