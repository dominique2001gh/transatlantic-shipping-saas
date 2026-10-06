import { UserRole } from './enums';
import type { AuthenticatedUser } from './types';

/**
 * RBAC permissions (2026-10): the complete, closed set of fine-grained
 * capability keys a tenant OWNER may grant to a staff member, layered on
 * top of (never replacing) the existing `role` + `*_ROLES` tier system in
 * constants.ts. Grounded in the REAL modules/routes audited in this
 * codebase (see PHASE_A audit) — do not add a key here for functionality
 * that doesn't exist yet.
 *
 * Stored as a plain `User.permissions string[]`/`TenantInvitation.
 * permissions string[]` — these string literals are that array's only
 * valid values. OWNER is never limited by this list; see
 * PermissionsGuard's own doc comment (added in Phase C) for why.
 */
export const PERMISSION_KEYS = [
  'customers.view',
  'customers.manage',
  'shipments.view',
  'shipments.manage',
  'shipments.receive',
  'shipments.labels',
  'quickreceive.use',
  'warehouse.view',
  'warehouse.process',
  'containers.view',
  'containers.manage',
  'manifests.view',
  'manifests.manage',
  'dispatch.manage',
  'invoices.view',
  'invoices.manage',
  'payments.view',
  'payments.manage',
  'documents.view',
  'documents.manage',
  'tracking.view',
  'reports.view',
  'analytics.financial',
  'messages.manage',
  'leads.manage',
  'aiassistant.use',
  'staff.view',
  'staff.invite',
  'staff.manage',
  'staff.permissions',
  'settings.view',
  'settings.sensitive',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** O(1) membership check — used to reject an invite/update payload containing an unknown key. */
export const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export interface PermissionGroup {
  label: string;
  keys: PermissionKey[];
}

/** Grouped purely for the Invite/Edit Staff checkbox UI (Phase D) — carries no authorization meaning of its own. */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  { label: 'Customers', keys: ['customers.view', 'customers.manage'] },
  { label: 'Shipments', keys: ['shipments.view', 'shipments.manage', 'shipments.receive', 'shipments.labels'] },
  { label: 'Quick Receive', keys: ['quickreceive.use'] },
  { label: 'Warehouse', keys: ['warehouse.view', 'warehouse.process'] },
  { label: 'Containers', keys: ['containers.view', 'containers.manage'] },
  { label: 'Manifests', keys: ['manifests.view', 'manifests.manage'] },
  { label: 'Dispatch / Delivery', keys: ['dispatch.manage'] },
  { label: 'Invoices', keys: ['invoices.view', 'invoices.manage'] },
  { label: 'Payments', keys: ['payments.view', 'payments.manage'] },
  { label: 'Documents', keys: ['documents.view', 'documents.manage'] },
  { label: 'Tracking', keys: ['tracking.view'] },
  { label: 'Reports & Analytics', keys: ['reports.view', 'analytics.financial'] },
  { label: 'Messages', keys: ['messages.manage'] },
  { label: 'Website Leads', keys: ['leads.manage'] },
  { label: 'AI Assistant', keys: ['aiassistant.use'] },
  { label: 'Staff', keys: ['staff.view', 'staff.invite', 'staff.manage', 'staff.permissions'] },
  { label: 'Settings', keys: ['settings.view', 'settings.sensitive'] },
];

/**
 * Invite-time role presets (Phase D UI). Selecting one populates the
 * checkbox grid with these keys; the owner may still add/remove
 * individual permissions afterward — a preset is a starting point, not a
 * locked set. "ADMIN" is deliberately NOT a `UserRole` enum value (see
 * the Phase A audit for why) — it's a permissions-only preset, and the
 * underlying `role` column is set to MANAGER for it. ADMIN is
 * deliberately denied `staff.invite`/`staff.manage`/`staff.permissions`/
 * `settings.sensitive` by default — per explicit product decision, ADMIN
 * must never be equivalent to OWNER, and staff-management authority must
 * stay an explicit, separate grant, not a side effect of a broad preset.
 * "CUSTOM" has no preset array — the owner builds the set by hand.
 */
export const PERMISSION_PRESETS: Record<'ADMIN' | 'MANAGER' | 'WAREHOUSE_STAFF' | 'ACCOUNTING', PermissionKey[]> = {
  ADMIN: [
    'customers.view',
    'customers.manage',
    'shipments.view',
    'shipments.manage',
    'shipments.receive',
    'shipments.labels',
    'quickreceive.use',
    'warehouse.view',
    'warehouse.process',
    'containers.view',
    'containers.manage',
    'manifests.view',
    'manifests.manage',
    'dispatch.manage',
    'invoices.view',
    'invoices.manage',
    'payments.view',
    'payments.manage',
    'documents.view',
    'documents.manage',
    'tracking.view',
    'reports.view',
    'analytics.financial',
    'messages.manage',
    'leads.manage',
    'aiassistant.use',
    'staff.view',
    'settings.view',
  ],
  MANAGER: [
    'customers.view',
    'customers.manage',
    'shipments.view',
    'shipments.manage',
    'shipments.receive',
    'shipments.labels',
    'quickreceive.use',
    'warehouse.view',
    'warehouse.process',
    'containers.view',
    'containers.manage',
    'manifests.view',
    'manifests.manage',
    'dispatch.manage',
    'documents.view',
    'documents.manage',
    'tracking.view',
    'reports.view',
    'messages.manage',
    'leads.manage',
    'aiassistant.use',
  ],
  WAREHOUSE_STAFF: [
    'customers.view',
    'customers.manage',
    'shipments.view',
    'shipments.manage',
    'shipments.receive',
    'shipments.labels',
    'quickreceive.use',
    'warehouse.view',
    'warehouse.process',
    'containers.view',
    'containers.manage',
    'manifests.view',
    'manifests.manage',
    'dispatch.manage',
    'documents.view',
    'documents.manage',
    'tracking.view',
    'messages.manage',
    'leads.manage',
    'aiassistant.use',
  ],
  ACCOUNTING: [
    'customers.view',
    'invoices.view',
    'invoices.manage',
    'payments.view',
    'payments.manage',
    'analytics.financial',
    'tracking.view',
    'aiassistant.use',
  ],
};

/**
 * Legacy-staff compatibility mapping (2026-10 RBAC rollout) — used ONLY
 * by the one-time migration backfill (scripts/backfill-rbac-permissions.ts),
 * never at request time. Computes, for each pre-existing (pre-RBAC) User
 * row, the permission set that accurately reflects what that row's
 * `role` ALREADY grants today via the existing `*_ROLES` tier constants
 * in constants.ts — so applying this once, at rollout, changes zero
 * actual access for any existing staff member. Deliberately independent
 * of PERMISSION_PRESETS above (those are forward-looking invite
 * defaults the owner can start from; this is a backward-looking,
 * must-match-current-reality computation) — the two happen to overlap
 * heavily for MANAGER/STAFF/FINANCE, but are not required to stay
 * identical if either changes later.
 *
 * OWNER is included for completeness/display only — OWNER is never
 * actually limited by `permissions` (see PermissionsGuard, Phase C), so
 * this entry is never functionally read for access decisions, only shown
 * in the Staff page UI so an OWNER's row doesn't display confusingly
 * empty.
 */
export function legacyRolePermissions(role: UserRole): PermissionKey[] {
  switch (role) {
    case UserRole.OWNER:
      return [...PERMISSION_KEYS];
    case UserRole.MANAGER:
      return [
        'customers.view',
        'customers.manage',
        'shipments.view',
        'shipments.manage',
        'shipments.receive',
        'shipments.labels',
        'quickreceive.use',
        'warehouse.view',
        'warehouse.process',
        'containers.view',
        'containers.manage',
        'manifests.view',
        'manifests.manage',
        'dispatch.manage',
        'invoices.view',
        'invoices.manage',
        'payments.view',
        'payments.manage',
        'documents.view',
        'documents.manage',
        'tracking.view',
        'reports.view',
        'analytics.financial',
        'messages.manage',
        'leads.manage',
        'aiassistant.use',
        'staff.view',
      ];
    case UserRole.STAFF:
      return [
        'customers.view',
        'customers.manage',
        'shipments.view',
        'shipments.manage',
        'shipments.receive',
        'shipments.labels',
        'quickreceive.use',
        'warehouse.view',
        'warehouse.process',
        'containers.view',
        'containers.manage',
        'manifests.view',
        'manifests.manage',
        'dispatch.manage',
        'documents.view',
        'documents.manage',
        'tracking.view',
        'messages.manage',
        'leads.manage',
        'aiassistant.use',
      ];
    case UserRole.FINANCE:
      return [
        'customers.view',
        'invoices.view',
        'invoices.manage',
        'payments.view',
        'payments.manage',
        'analytics.financial',
        'tracking.view',
        'aiassistant.use',
      ];
    // PLATFORM_ADMIN and CUSTOMER are outside this tenant-staff permission
    // system entirely — neither is ever subject to a PermissionsGuard
    // check, so an empty array here is correct, not a gap.
    default:
      return [];
  }
}

/**
 * RBAC permissions UI (Phase D): plain-business-language label for each
 * PERMISSION_KEYS entry, shown on the permission checkboxes in the Staff
 * Invite / Edit Permissions UI. Deliberately never the raw dotted key —
 * a non-technical shipping-business owner reads this, not a developer.
 * One label per existing key only; adding a label here must never be the
 * occasion to invent a new key (see PERMISSION_KEYS' own doc comment).
 */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'customers.view': 'View customers',
  'customers.manage': 'Create and update customers',
  'shipments.view': 'View shipments',
  'shipments.manage': 'Create and update shipments',
  'shipments.receive': 'Receive shipments at the warehouse',
  'shipments.labels': 'Print shipment labels',
  'quickreceive.use': 'Use Quick Receive',
  'warehouse.view': 'View warehouse activity and inventory',
  'warehouse.process': 'Process and inspect packages',
  'containers.view': 'View containers',
  'containers.manage': 'Create and manage containers',
  'manifests.view': 'View manifests',
  'manifests.manage': 'Create and manage manifests',
  'dispatch.manage': 'Update dispatch and delivery status',
  'invoices.view': 'View invoices',
  'invoices.manage': 'Create and manage invoices',
  'payments.view': 'View payments',
  'payments.manage': 'Record and manage payments',
  'documents.view': 'View documents',
  'documents.manage': 'Upload and manage documents',
  'tracking.view': 'View shipment tracking',
  'reports.view': 'View reports and analytics',
  'analytics.financial': 'View financial reports',
  'messages.manage': 'Send and manage customer messages',
  'leads.manage': 'Manage website leads',
  'aiassistant.use': 'Use the AI Assistant',
  'staff.view': 'View the staff list',
  'staff.invite': 'Invite new staff',
  'staff.manage': 'Change staff roles and active status',
  'staff.permissions': "Manage other staff members' permissions",
  'settings.view': 'View company settings',
  'settings.sensitive': 'Manage payment and billing settings',
};

/**
 * RBAC permissions UI (Phase D): the exact set of choices the Staff
 * Invite / Edit Permissions screen offers, in order. Deliberately NOT a
 * 1:1 re-export of PERMISSION_PRESETS — "ADMIN" (the stored preset name)
 * reads to a shipping-business owner as "Manager / Admin", and "MANAGER"
 * reads as "Operations" (its real-world meaning: full day-to-day
 * operational access, no finance) — the label is presentation, the
 * underlying permission array is unchanged. No OWNER preset exists here
 * by design: OWNER is a `role`, never a permissions preset, and is never
 * offered as a starting point to customize away from (see
 * PERMISSION_PRESETS' own doc comment and PermissionsGuard's OWNER
 * bypass) — selecting the OWNER *role* in the invite form hides this
 * picker entirely instead (see StaffPage).
 */
export type PermissionPresetUiKey = 'WAREHOUSE_STAFF' | 'ACCOUNTING' | 'MANAGER' | 'ADMIN' | 'CUSTOM';

export interface PermissionPresetUiOption {
  key: PermissionPresetUiKey;
  label: string;
  description: string;
  /** Permissions this preset starts with — the owner may still add/remove individual ones afterward. Empty for CUSTOM, which starts from nothing. */
  permissions: PermissionKey[];
  /** Convenience default for the invite form's separate Role field when this preset is chosen — the owner can still override it. Undefined for CUSTOM (no role is implied). */
  defaultRole?: UserRole;
}

export const PERMISSION_PRESET_OPTIONS: PermissionPresetUiOption[] = [
  {
    key: 'WAREHOUSE_STAFF',
    label: 'Warehouse Staff',
    description: 'Receive, process, and move shipments and containers. No access to invoices, payments, or settings.',
    permissions: PERMISSION_PRESETS.WAREHOUSE_STAFF,
    defaultRole: UserRole.STAFF,
  },
  {
    key: 'ACCOUNTING',
    label: 'Accounting / Finance',
    description: 'View customers, manage invoices and payments, and view financial reports. No warehouse or container access.',
    permissions: PERMISSION_PRESETS.ACCOUNTING,
    defaultRole: UserRole.FINANCE,
  },
  {
    key: 'MANAGER',
    label: 'Operations',
    description: 'Full day-to-day operations: shipments, warehouse, containers, manifests, and dispatch. No invoices, payments, or staff management.',
    permissions: PERMISSION_PRESETS.MANAGER,
    defaultRole: UserRole.MANAGER,
  },
  {
    key: 'ADMIN',
    label: 'Manager / Admin',
    description: 'Broad day-to-day and financial access, including invoices, payments, and reports. Cannot manage staff or sensitive settings — only an OWNER can grant those.',
    permissions: PERMISSION_PRESETS.ADMIN,
    defaultRole: UserRole.MANAGER,
  },
  {
    key: 'CUSTOM',
    label: 'Custom Access',
    description: 'Start from nothing and choose exactly what this person can view or manage.',
    permissions: [],
  },
];

/**
 * RBAC permissions (2026-10): the one place UI code should ask "can this
 * user do X" — mirrors PermissionsGuard's own OWNER-bypass-then-array-
 * check logic exactly, so the frontend's notion of "allowed" never drifts
 * from the backend's. This is a UX convenience only (hiding/disabling
 * controls a user can't use) — it is never the actual security boundary;
 * the backend re-checks everything on every request regardless of what
 * this returns. Accepts a structural subset of AuthenticatedUser so a
 * caller never needs to import the full type just to check a permission.
 */
export function hasPermission(user: Pick<AuthenticatedUser, 'role' | 'permissions'> | null | undefined, key: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === UserRole.OWNER) return true;
  return user.permissions?.includes(key) ?? false;
}
