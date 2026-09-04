/**
 * Single source of truth for platform-level branding — i.e. branding for
 * the master multi-tenant SaaS itself, as distinct from any one tenant's
 * branding (see site-config.ts for that; Trans Atlantic is Tenant #1 and
 * keeps its own branding there, untouched by this file).
 *
 * "AnanseLogix" is the official name of the platform (confirmed —
 * Final Brand + Deployment Plan) and ananselogix.com is the purchased
 * master SaaS domain. Every place that needs to display the name should
 * still read from `platformConfig.name` rather than hardcoding the
 * string, so any future rename stays a one-file change.
 *
 * Scope: this file is for platform-wide concerns only (currently: the
 * /platform admin console used by Ananse Automation staff to manage all
 * tenants). It must never be read by tenant-facing surfaces — the public
 * marketing site, the customer portal, or a tenant's staff console —
 * those all read site-config.ts (or a future per-tenant equivalent)
 * instead. Trans Atlantic's public site, portal, and staff console stay
 * fully Trans Atlantic branded; AnanseLogix never appears there.
 */

export interface PlatformContact {
  supportEmail: string | null;
  /**
   * AnanseLogix / Ananse Automation's own platform-level support phone
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
  /** Official platform name — see file header. Replace here only. */
  name: 'AnanseLogix',
  /** The company that owns/develops the platform (distinct from any tenant). */
  companyName: 'Ananse Automation',
  tagline: 'Multi-Tenant Logistics Operations Platform',
  /**
   * Purchased master SaaS domain. Not yet wired into DNS, CORS, or
   * deployment config anywhere — this is branding-config only. Do not
   * assume any infrastructure reads this value until that's actually
   * built.
   */
  domain: 'ananselogix.com' as string | null,
  /** Platform logo asset path — TBD, not yet designed. */
  logoSrc: null as string | null,
  contact: {
    supportEmail: null,
    supportPhone: '+1 (214) 723-2121',
    supportPhoneHref: '+12147232121',
    systemEmailFromName: 'AnanseLogix',
  } as PlatformContact,
};
