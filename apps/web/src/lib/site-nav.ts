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
 * "Shipping Rates" maps to /quote rather than a dedicated route, since this
 * is a frontend-only pass and no standalone rate calculator exists yet —
 * requesting a quote is the real working equivalent.
 *
 * A "Locations" item was removed for launch: it only ever pointed at
 * /contact (which already renders siteConfig.locations — see
 * ContactPage), duplicating "Contact Us" in the nav. A dedicated
 * Locations page can be added later if it's worth a distinct route.
 */
export const primaryNavLinks: PrimaryNavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'About Us', href: '/about' },
  { label: 'Shipping Rates', href: '/quote' },
  { label: 'Track Your Shipment', href: '/track' },
  { label: 'Contact Us', href: '/contact' },
];
