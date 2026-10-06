import type { PermissionKey, UserRole } from '@transatlantic/shared';
import { ANALYTICS_ROLES, DOCUMENT_MANAGE_ROLES, INVOICE_MANAGE_ROLES, LEAD_MANAGE_ROLES, NOTIFICATION_MANAGE_ROLES, ONBOARDING_ROLES, OPERATIONS_ROLES, STAFF_ROLES } from '@transatlantic/shared';

export interface NavItem {
  label: string;
  href: string;
  /** If set, hidden from any user whose role isn't in this list. UX only — the API's own @Roles() guard is the real enforcement (see useRequireAuth's own doc comment); this just keeps unauthorized staff from seeing a management action they can't use. Undefined = visible to every dashboard role. */
  roles?: UserRole[];
  /**
   * RBAC permissions (2026-10): if set, hidden from any non-owner user
   * whose `permissions` array doesn't include this key (OWNER always
   * sees it — see hasPermission's own doc comment) — the fine-grained
   * layer on top of `roles` above, for a module a role tier can reach but
   * an individual staff member's actual permission grant doesn't cover
   * (e.g. a MANAGER customized down to pure operations, with no
   * invoices.view). Still UX only; PermissionsGuard is the real
   * enforcement. Undefined = not further restricted beyond `roles`.
   */
  permission?: PermissionKey;
  /**
   * RBAC permissions (2026-10): like `permission`, but visible if the
   * user holds ANY one of these (OWNER always sees it). For a module
   * reachable through more than one distinct permission (e.g. Staff,
   * which covers viewing/inviting/managing roles/managing permissions —
   * no single key implies "can use this page at all"). Never combined
   * with `permission` on the same item.
   */
  anyPermission?: PermissionKey[];
}

/**
 * Staff dashboard navigation shell. Most modules below are still
 * placeholder routes — this only establishes the structure to build into.
 */
export const dashboardNavItems: NavItem[] = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Customers', href: '/dashboard/customers', permission: 'customers.view' },
  { label: 'Shipments', href: '/dashboard/shipments', permission: 'shipments.view' },
  { label: 'Quick Receive', href: '/dashboard/quick-receive', roles: OPERATIONS_ROLES, permission: 'quickreceive.use' },
  { label: 'Warehouse', href: '/dashboard/warehouse', permission: 'warehouse.view' },
  { label: 'Containers', href: '/dashboard/containers', permission: 'containers.view' },
  { label: 'Manifests', href: '/dashboard/manifests', permission: 'manifests.view' },
  { label: 'Invoices', href: '/dashboard/invoices', roles: INVOICE_MANAGE_ROLES, permission: 'invoices.view' },
  { label: 'Payments', href: '/dashboard/payments', roles: INVOICE_MANAGE_ROLES, permission: 'payments.view' },
  { label: 'Documents', href: '/dashboard/documents', roles: DOCUMENT_MANAGE_ROLES, permission: 'documents.view' },
  { label: 'Tracking', href: '/dashboard/tracking' },
  { label: 'Website Leads', href: '/dashboard/leads', roles: LEAD_MANAGE_ROLES, permission: 'leads.manage' },
  { label: 'Reports', href: '/dashboard/reports', roles: ANALYTICS_ROLES, permission: 'reports.view' },
  { label: 'Messages', href: '/dashboard/messages', roles: NOTIFICATION_MANAGE_ROLES, permission: 'messages.manage' },
  { label: 'AI Assistant', href: '/dashboard/ai-agent' },
  {
    label: 'Staff',
    href: '/dashboard/staff',
    roles: STAFF_ROLES,
    anyPermission: ['staff.view', 'staff.invite', 'staff.manage', 'staff.permissions'],
  },
  { label: 'Settings', href: '/dashboard/settings', roles: ONBOARDING_ROLES },
  // Platform-wide staff MFA (2026-10): every dashboard role's own
  // password/MFA management — deliberately NOT roles-restricted
  // (undefined = every DASHBOARD_ROLES member sees it), and deliberately
  // separate from the OWNER-only company Settings above. See
  // dashboard/account/page.tsx's own doc comment.
  { label: 'My Account', href: '/dashboard/account' },
];

export const portalNavItems: NavItem[] = [
  { label: 'Overview', href: '/portal' },
  { label: 'Prepare a Drop-Off', href: '/portal/pre-register' },
  { label: 'Prepared Drop-Offs', href: '/portal/pre-registrations' },
  { label: 'My Shipments', href: '/portal/shipments' },
  { label: 'Invoices', href: '/portal/invoices' },
  { label: 'Documents', href: '/portal/documents' },
  { label: 'Notifications', href: '/portal/notifications' },
  { label: 'Profile', href: '/portal/profile' },
];

export const platformNavItems: NavItem[] = [
  { label: 'Overview', href: '/platform' },
  { label: 'Tenants', href: '/platform/tenants' },
  { label: 'Leads', href: '/platform/leads' },
  { label: 'Plans & Pricing', href: '/platform/plans' },
  { label: 'SaaS Analytics', href: '/platform/analytics' },
  { label: 'Platform Users', href: '/platform/users' },
  { label: 'Billing', href: '/platform/billing' },
  { label: 'Settings', href: '/platform/settings' },
];
