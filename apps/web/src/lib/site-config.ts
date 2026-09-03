/**
 * Single source of truth for public-site branding and contact content.
 *
 * This file exists so the public marketing site can eventually be
 * white-labeled per tenant: swap this object (or load its shape from the
 * Tenant/TenantSettings API once that endpoint exists) and every
 * component that reads from it — header, footer, hero, contact page —
 * updates without any component rewrites. Nothing in components/marketing
 * or components/layout should hard-code "Trans Atlantic" strings; they
 * should read from here instead.
 *
 * Contact details below are Trans Atlantic's real, confirmed production
 * contact info (as of the Website Completion & Production Launch phase).
 */

export interface SiteContact {
  email: string;
  phone: string;
  phoneHref: string;
}

export interface SiteLocation {
  label: string;
  city: string;
  region: string;
  country: string;
}

export const siteConfig = {
  /**
   * Stage 2A's public tracking API (GET /tracking/public) is tenant-scoped
   * and deliberately has no domain-based tenant resolution yet — every
   * caller must supply an explicit tenantSlug, and this deployment's own
   * value belongs here, not hard-coded inline in lib/tracking.ts, for the
   * same reason the rest of this file exists: swap this object (or load
   * it dynamically) once a real per-tenant public-site story exists, and
   * every caller updates without edits elsewhere.
   */
  tenantSlug: 'transatlantic',
  companyName: 'Trans Atlantic Logistics Solutions',
  shortName: 'Trans Atlantic',
  initials: 'TA',
  tagline: 'International Shipping. Simplified.',
  description:
    'Ocean, air, and RoRo freight forwarding with warehousing, consolidation, and shipment tracking for cargo moving between the United States and destinations worldwide.',
  contact: {
    email: 'info@talogisticssolutions.com',
    phone: '+1 (214) 493-7745',
    phoneHref: '+12144937745',
  } as SiteContact,
  // Operational location on file, not necessarily a public-facing HQ
  // address — shown as a location, not billed as company headquarters.
  locations: [
    { label: 'Origin Warehouse', city: 'Dallas-Fort Worth', region: 'TX', country: 'United States' },
  ] as SiteLocation[],
};
