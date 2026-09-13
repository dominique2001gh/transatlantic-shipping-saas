import { isTransAtlanticHostname } from './trans-atlantic-hostname';

export type BrandIconVariant = 'trans-atlantic' | 'ananselogix';

/**
 * Which brand's favicon/app-icon a request should receive, given only its
 * Host header. This is the fallback used app-wide (see app/icon.tsx and
 * app/apple-icon.tsx) for every route this deployment serves that isn't
 * already scoped to its own icon by Next's file-based icon convention —
 * in practice that's every shared multi-tenant surface (/dashboard,
 * /portal, /platform, /onboarding) plus Trans Atlantic's own public site,
 * since AnanseLogix's marketing pages (/ananselogix/*) already have their
 * own dedicated icon.png/apple-icon.png at that route segment (see that
 * commit's own message, "dedicated purple favicon/app icon for
 * ananselogix.com") and Next's nearest-file-wins convention means they
 * never reach this function at all.
 *
 * Deliberately brand-level only, never tenant-level: a Trans Atlantic
 * hostname always gets Trans Atlantic's icon (unchanged, preserved
 * forever, see _brand-assets/trans-atlantic-icon.png's own history — it's
 * a straight rename of the original app-root icon.png/apple-icon.png,
 * same bytes), and *every other* hostname — ananselogix.com, the raw
 * Railway domain, local dev, any future AnanseLogix tenant's own custom
 * domain — gets AnanseLogix's own icon as the default.
 *
 * This is what actually fixes the Titanic branding leak: a newly
 * provisioned tenant reaching ananselogix.com/dashboard was previously
 * served the Trans Atlantic icon.png, because /dashboard is one shared
 * dashboard implementation for every tenant and isn't rewritten under
 * /ananselogix by middleware.ts (see that file's own doc comment — there
 * is no per-tenant page tree to rewrite into). It now resolves to
 * AnanseLogix's icon instead, correctly reflecting "no custom favicon
 * configured for this tenant," without ever hardcoding Titanic or any
 * other tenant's name here.
 *
 * A tenant's own *custom* favicon (once a Tenant.faviconUrl-shaped field
 * exists — see Tenant model's phased-field convention, e.g. logoUrl/
 * tagline) is a separate, later-applied layer, decided client-side once
 * that tenant's identity is actually known post-login (see useTenant.ts
 * and dashboard/layout.tsx's own effect) — never decided here, since this
 * function only ever sees a host, never a tenant.
 */
export function resolveBrandIconVariant(host: string | null | undefined): BrandIconVariant {
  return isTransAtlanticHostname(host) ? 'trans-atlantic' : 'ananselogix';
}
