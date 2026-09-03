/**
 * Single source of truth for platform-level branding — i.e. branding for
 * the master multi-tenant SaaS itself, as distinct from any one tenant's
 * branding (see site-config.ts for that; Trans Atlantic is Tenant #1 and
 * keeps its own branding there, untouched by this file).
 *
 * "Ananse Logix" is a TEMPORARY working name for the platform while the
 * permanent product name is still being decided — every place that needs
 * to display it should read from `platformConfig.name` here rather than
 * hardcoding the string, so renaming the platform later is a one-file
 * change. Same reasoning for `domain`: the permanent SaaS domain is still
 * TBD, so this deliberately does NOT default to ananselogix.com or any
 * other guessed value — leave it `null` until a real decision is made,
 * and do not have callers assume it's set.
 *
 * Scope: this file is for platform-wide concerns only (currently: the
 * /platform admin console used by Ananse Automation staff to manage all
 * tenants). It must never be read by tenant-facing surfaces — the public
 * marketing site, the customer portal, or a tenant's staff console —
 * those all read site-config.ts (or a future per-tenant equivalent)
 * instead.
 */

export interface PlatformContact {
  supportEmail: string | null;
  /**
   * Ananse Logix / Ananse Automation's own platform-level support phone
   * number — never Trans Atlantic's (or any other tenant's) number. Keep
   * this separate from every tenant's site-config.ts contact info; a
   * tenant's public website must always show its own number, never this
   * one.
   */
  supportPhone: string | null;
  supportPhoneHref: string | null;
  /**
   * Identity used as the "From" name on platform-generated system email
   * (as opposed to tenant-scoped notification email, which is sent under
   * the tenant's own identity — see apps/api/src/notifications and
   * apps/api/src/leads). Nothing in the API sends a platform-level email
   * today, so this is currently unused — it exists so that when that
   * need shows up, it has one place to read from instead of a new
   * hardcoded string.
   */
  systemEmailFromName: string;
}

export const platformConfig = {
  /** Temporary working name — see file header. Replace here only. */
  name: 'Ananse Logix',
  /** The company that owns/develops the platform (distinct from any tenant). */
  companyName: 'Ananse Automation',
  tagline: 'Multi-Tenant Logistics Operations Platform',
  /**
   * Permanent SaaS domain — TBD. Deliberately left null rather than
   * guessed (e.g. ananselogix.com); do not assume this in DNS, CORS, or
   * deployment config until a real decision is made.
   */
  domain: null as string | null,
  /** Platform logo asset path — TBD, not yet designed. */
  logoSrc: null as string | null,
  contact: {
    supportEmail: null,
    supportPhone: '+1 (214) 723-2121',
    supportPhoneHref: '+12147232121',
    systemEmailFromName: 'Ananse Logix',
  } as PlatformContact,
};
