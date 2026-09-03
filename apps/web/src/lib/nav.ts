import type { UserRole } from '@transatlantic/shared';
import { ANALYTICS_ROLES, DOCUMENT_MANAGE_ROLES, INVOICE_MANAGE_ROLES, LEAD_MANAGE_ROLES, NOTIFICATION_MANAGE_ROLES } from '@transatlantic/shared';

export interface NavItem {
  label: string;
  href: string;
  /** If set, hidden from any user whose role isn't in this list. UX only — the API's own @Roles() guard is the real enforcement (see useRequireAuth's own doc comment); this just keeps unauthorized staff from seeing a management action they can't use. Undefined = visible to every dashboard role. */
  roles?: UserRole[];
}

/**
 * Staff dashboard navigation shell. Most modules below are still
 * placeholder routes — this only establishes the structure to build into.
 */
export const dashboardNavItems: NavItem[] = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Customers', href: '/dashboard/customers' },
  { label: 'Shipments', href: '/dashboard/shipments' },
  { label: 'Warehouse', href: '/dashboard/warehouse' },
  { label: 'Containers', href: '/dashboard/containers' },
  { label: 'Manifests', href: '/dashboard/manifests' },
  { label: 'Invoices', href: '/dashboard/invoices', roles: INVOICE_MANAGE_ROLES },
  { label: 'Payments', href: '/dashboard/payments', roles: INVOICE_MANAGE_ROLES },
  { label: 'Documents', href: '/dashboard/documents', roles: DOCUMENT_MANAGE_ROLES },
  { label: 'Tracking', href: '/dashboard/tracking' },
  { label: 'Website Leads', href: '/dashboard/leads', roles: LEAD_MANAGE_ROLES },
  { label: 'Reports', href: '/dashboard/reports', roles: ANALYTICS_ROLES },
  { label: 'Messages', href: '/dashboard/messages', roles: NOTIFICATION_MANAGE_ROLES },
  { label: 'Settings', href: '/dashboard/settings' },
];

export const portalNavItems: NavItem[] = [
  { label: 'Overview', href: '/portal' },
  { label: 'My Shipments', href: '/portal/shipments' },
  { label: 'Invoices', href: '/portal/invoices' },
  { label: 'Documents', href: '/portal/documents' },
  { label: 'Notifications', href: '/portal/notifications' },
  { label: 'Profile', href: '/portal/profile' },
];

export const platformNavItems: NavItem[] = [
  { label: 'Overview', href: '/platform' },
  { label: 'Tenants', href: '/platform/tenants' },
  { label: 'Platform Users', href: '/platform/users' },
  { label: 'Billing', href: '/platform/billing' },
  { label: 'Settings', href: '/platform/settings' },
];
