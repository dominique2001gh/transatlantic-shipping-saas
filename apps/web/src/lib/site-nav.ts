export interface PrimaryNavLink {
  label: string;
  href: string;
}

/**
 * Public-site primary navigation. "Services" is intentionally not listed
 * here — the header renders it as a dropdown sourced directly from
 * `services` in lib/services-data.ts, so adding a service never requires
 * touching the nav separately.
 */
export const primaryNavLinks: PrimaryNavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Track Shipment', href: '/track' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];
