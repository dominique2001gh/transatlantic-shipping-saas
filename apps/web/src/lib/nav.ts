export interface NavItem {
  label: string;
  href: string;
}

/**
 * Staff dashboard navigation shell. Every module below is a placeholder
 * route for now — this only establishes the structure to build into.
 */
export const dashboardNavItems: NavItem[] = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Customers', href: '/dashboard/customers' },
  { label: 'Shipments', href: '/dashboard/shipments' },
  { label: 'Warehouse', href: '/dashboard/warehouse' },
  { label: 'Containers', href: '/dashboard/containers' },
  { label: 'Manifests', href: '/dashboard/manifests' },
  { label: 'Invoices', href: '/dashboard/invoices' },
  { label: 'Payments', href: '/dashboard/payments' },
  { label: 'Tracking', href: '/dashboard/tracking' },
  { label: 'Reports', href: '/dashboard/reports' },
  { label: 'Messages', href: '/dashboard/messages' },
  { label: 'Settings', href: '/dashboard/settings' },
];

export const portalNavItems: NavItem[] = [
  { label: 'Overview', href: '/portal' },
  { label: 'My Shipments', href: '/portal/shipments' },
  { label: 'Track a Shipment', href: '/portal/track' },
  { label: 'Invoices', href: '/portal/invoices' },
  { label: 'Documents', href: '/portal/documents' },
  { label: 'Profile', href: '/portal/profile' },
];

export const platformNavItems: NavItem[] = [
  { label: 'Overview', href: '/platform' },
  { label: 'Tenants', href: '/platform/tenants' },
  { label: 'Platform Users', href: '/platform/users' },
  { label: 'Billing', href: '/platform/billing' },
  { label: 'Settings', href: '/platform/settings' },
];
