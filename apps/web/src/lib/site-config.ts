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
 * Contact details below are copied from the seeded Tenant record
 * (apps/api/prisma/seed.ts) — the only source of contact information
 * currently checked into this project. The phone number falls in the
 * North American 555 test-number block, which is a strong signal it is
 * development/placeholder data rather than a live support line. Confirm
 * real production contact details (phone, support email, any public
 * address) before this site goes live.
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
  companyName: 'Trans Atlantic Logistics Solutions',
  shortName: 'Trans Atlantic',
  initials: 'TA',
  tagline: 'International Shipping. Simplified.',
  description:
    'Ocean, air, and RoRo freight forwarding with warehousing, consolidation, and shipment tracking for cargo moving between the United States and destinations worldwide.',
  contact: {
    email: 'info@talogisticssolutions.com',
    phone: '+1 (555) 010-0100',
    phoneHref: '+15550100100',
  } as SiteContact,
  // Operational location on file, not necessarily a public-facing HQ
  // address — shown as a location, not billed as company headquarters.
  locations: [
    { label: 'Origin Warehouse', city: 'Dallas-Fort Worth', region: 'TX', country: 'United States' },
  ] as SiteLocation[],
};
