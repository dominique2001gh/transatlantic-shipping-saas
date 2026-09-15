import { InvoiceStatus, UserRole, STAFF_ROLES } from './enums';

/**
 * Fallback prefixes used only when a tenant has not configured its own
 * customer/tracking number prefix in TenantSettings. Never hard-code a
 * tenant's prefix into business logic — read it from TenantSettings.
 */
export const DEFAULT_CUSTOMER_NUMBER_PREFIX = 'CUST';
export const DEFAULT_TRACKING_NUMBER_PREFIX = 'SHP';

/** Zero-padded width for the sequential portion of generated numbers. */
export const CUSTOMER_NUMBER_SEQUENCE_LENGTH = 6;
export const TRACKING_NUMBER_SEQUENCE_LENGTH = 6;

/**
 * Builds a human-friendly customer number, e.g. "TA-000001".
 * `prefix` should come from TenantSettings.customerNumberPrefix.
 */
export function formatCustomerNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(CUSTOMER_NUMBER_SEQUENCE_LENGTH, '0')}`;
}

/**
 * Builds a human-friendly tracking number, e.g. "TAL-2026-000001".
 * `prefix` should come from TenantSettings.trackingNumberPrefix.
 */
export function formatTrackingNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(TRACKING_NUMBER_SEQUENCE_LENGTH, '0')}`;
}

/** Zero-padded width for an item's position within its shipment. */
export const ITEM_SEQUENCE_LENGTH = 2;

/**
 * Builds a ShipmentItem's scan payload from its parent shipment's
 * trackingNumber and its 1-based position within that shipment, e.g.
 * "TAL-2026-000001-02" for the second item of shipment TAL-2026-000001.
 * Globally unique the same way trackingNumber already is — no separate
 * per-tenant counter needed.
 */
export function formatItemCode(trackingNumber: string, sequenceNumber: number): string {
  return `${trackingNumber}-${String(sequenceNumber).padStart(ITEM_SEQUENCE_LENGTH, '0')}`;
}

/** Roles allowed to sign in to the staff dashboard (/dashboard) — every tenant-staff role. */
export const DASHBOARD_ROLES: UserRole[] = STAFF_ROLES;

/** Roles allowed to sign in to the platform admin console (/platform). */
export const PLATFORM_ROLES: UserRole[] = [UserRole.PLATFORM_ADMIN];

/** Roles allowed to sign in to the customer portal (/portal). */
export const PORTAL_ROLES: UserRole[] = [UserRole.CUSTOMER];

// ==========================================================================
// RBAC V1 (2026-09) tier constants — the single source of truth every
// controller's @Roles() call and every frontend nav/UI gate reads from.
// Building a new capability should reuse one of these, not invent a new
// bespoke array — see UserRole's own doc comment for the 4-tier model
// these encode.
// ==========================================================================

/** OWNER only — tenant ownership, the AnanseLogix subscription/billing plan, staff administration, and sensitive tenant-level settings (branding, numbering, site config, onboarding). */
export const OWNER_ONLY_ROLES: UserRole[] = [UserRole.OWNER];

/** OWNER + MANAGER — broad tenant operational and reporting control, excluding billing/subscription, staff administration, and destructive tenant settings. */
export const MANAGER_UP_ROLES: UserRole[] = [UserRole.OWNER, UserRole.MANAGER];

/** OWNER + MANAGER + STAFF — day-to-day operational work: customers, shipments, warehouse, containers, manifests, tracking, operational documents. No invoices/payments, no billing, no staff administration. */
export const OPERATIONS_ROLES: UserRole[] = [UserRole.OWNER, UserRole.MANAGER, UserRole.STAFF];

/** OPERATIONS_ROLES + FINANCE — customer profiles are explicitly part of FINANCE's remit ("customers plus invoices, payments, financial reporting"), unlike shipments/warehouse/containers/manifests, which FINANCE has no access to at all. */
export const CUSTOMER_VIEW_ROLES: UserRole[] = [...OPERATIONS_ROLES, UserRole.FINANCE];

/**
 * OWNER + MANAGER + FINANCE — invoices, payments, and financial reporting.
 * STAFF is deliberately excluded: per the approved V1 role definitions,
 * operational staff never manage financial/customer-account documents.
 * Single source of truth for both the backend guards (Invoices/Payments
 * controllers) and the frontend nav — the frontend use is a UX convenience
 * only; the backend's own @Roles() check is what actually enforces this.
 */
export const INVOICE_MANAGE_ROLES: UserRole[] = [UserRole.OWNER, UserRole.MANAGER, UserRole.FINANCE];

/** Same membership as INVOICE_MANAGE_ROLES — the one analytics endpoint (`/analytics/revenue`) FINANCE may reach; every other analytics route stays ANALYTICS_ROLES-gated (OWNER/MANAGER only). */
export const FINANCE_ANALYTICS_ROLES: UserRole[] = INVOICE_MANAGE_ROLES;

/**
 * Stage 3B/3F: invoice statuses that can still legitimately receive a
 * payment — DRAFT (never issued), PAID, and VOID are all excluded, each
 * for its own reason (see PaymentsService.recordPayment's own error
 * messages for the backend's authoritative version of this same rule).
 * Single source of truth for the backend's manual-payment guard, the
 * backend's online-checkout guard, and the frontend's "Pay Now"/"Record
 * Payment" button visibility — the frontend use is a UX convenience only;
 * the backend's own checks are what actually enforce this.
 */
export const PAYABLE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
];

/**
 * Stage 3G: roles that may upload/edit documents and control their
 * customer-visibility — operational work, same membership as
 * OPERATIONS_ROLES. No broader read-only tier exists — VIEW_ROLES equals
 * this list, same as invoices. FINANCE is deliberately excluded: it has no
 * access to operational documents (BOLs, customs forms, packing lists)
 * under the V1 role definitions.
 */
export const DOCUMENT_MANAGE_ROLES: UserRole[] = OPERATIONS_ROLES;

/**
 * Stage 3H: roles that may view notification/delivery history and compose
 * staff-authored bulk container/manifest disruption messages — operational
 * + front-office work, same membership as OPERATIONS_ROLES. No broader
 * read-only tier exists — VIEW_ROLES equals this list, same pattern as
 * invoices/documents.
 */
export const NOTIFICATION_MANAGE_ROLES: UserRole[] = OPERATIONS_ROLES;

/**
 * Stage 4: roles that may view the Owner/Manager Analytics dashboard
 * (/dashboard/reports and every GET /analytics/* endpoint except
 * `overview`, which stays open to all DASHBOARD_ROLES, and `revenue`,
 * which is additionally open to FINANCE — see
 * AnalyticsController/FINANCE_ANALYTICS_ROLES). Full-tenant financial
 * visibility (revenue, payments, outstanding invoices) plus
 * cross-warehouse operational visibility is OWNER/MANAGER only, per
 * explicit product decision — STAFF and FINANCE are deliberately
 * excluded, matching the closed-list scope each of those two roles was
 * given.
 */
export const ANALYTICS_ROLES: UserRole[] = MANAGER_UP_ROLES;

/**
 * Website Launch: roles that may view and triage public website leads
 * (Contact/Request-a-Quote form submissions) — front-office + operational
 * work, same membership as OPERATIONS_ROLES. No broader read-only tier
 * exists — VIEW_ROLES equals this list, same pattern as
 * invoices/documents/notifications.
 */
export const LEAD_MANAGE_ROLES: UserRole[] = OPERATIONS_ROLES;

/**
 * AnanseLogix Phase 1 / RBAC V1: roles that may run the post-signup
 * onboarding wizard, and every tenant-settings-adjacent surface (branding,
 * numbering, site config, billing/subscription) — OWNER only. This is
 * exactly the "sensitive tenant-level settings" + "AnanseLogix
 * subscription/billing plan" scope the V1 role definitions reserve for
 * OWNER alone; MANAGER's broad operational access explicitly excludes it.
 */
export const ONBOARDING_ROLES: UserRole[] = OWNER_ONLY_ROLES;

/**
 * RBAC V1: staff *administration* — invite, change role, deactivate/
 * reactivate, promote to OWNER — is OWNER only. Distinct from STAFF_ROLES
 * (imported from ./enums), which is who may merely *view* the staff
 * directory (every tenant-staff role, matching prior behavior) — MANAGER
 * gets that view but none of the administration actions.
 */
export const STAFF_ADMIN_ROLES: UserRole[] = OWNER_ONLY_ROLES;
