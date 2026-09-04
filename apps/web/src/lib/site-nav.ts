export interface PrimaryNavLink {
  label: string;
  href: string;
}

/**
 * Public-site primary navigation, matching the approved homepage design
 * (Website Completion — homepage redesign pass). "Our Services" is
 * intentionally not listed here — PrimaryNav renders it as a dropdown
 * sourced directly from `services` in lib/services-data.ts, so adding a
 * service never requires touching the nav separately.
 *
 * Two labels map to existing pages rather than dedicated ones, since this
 * is a frontend-only pass and no new routes were created for it:
 * - "Shipping Rates" -> /quote (no standalone rate calculator exists yet;
 *   requesting a quote is the real working equivalent).
 * - "Locations" -> /contact (the page that already renders
 *   siteConfig.locations — see ContactPage).
 */
export const primaryNavLinks: PrimaryNavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'About Us', href: '/about' },
  { label: 'Shipping Rates', href: '/quote' },
  { label: 'Track Your Shipment', href: '/track' },
  { label: 'Locations', href: '/contact' },
  { label: 'Contact Us', href: '/contact' },
];
