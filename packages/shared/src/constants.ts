import { InvoiceStatus, UserRole } from './enums';

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

/** Roles allowed to sign in to the staff dashboard (/dashboard). */
export const DASHBOARD_ROLES: UserRole[] = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
  UserRole.CUSTOMER_SERVICE,
  UserRole.ACCOUNTANT,
  UserRole.DESTINATION_AGENT,
  UserRole.DRIVER,
];

/** Roles allowed to sign in to the platform admin console (/platform). */
export const PLATFORM_ROLES: UserRole[] = [UserRole.PLATFORM_ADMIN];

/**
 * Stage 3A/3D: roles that may manage invoices and record payments —
 * financial/customer-account documents, not warehouse-floor work.
 * Warehouse-only operational roles (WAREHOUSE_MANAGER, WAREHOUSE_STAFF,
 * DRIVER, DESTINATION_AGENT) are deliberately excluded, unlike
 * DASHBOARD_ROLES above. Single source of truth for both the backend
 * guard (InvoicesController) and the frontend UI (nav visibility) — the
 * frontend use is a UX convenience only; the backend's own @Roles() check
 * is what actually enforces this.
 */
export const INVOICE_MANAGE_ROLES: UserRole[] = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.CUSTOMER_SERVICE,
];

/** Roles allowed to sign in to the customer portal (/portal). */
export const PORTAL_ROLES: UserRole[] = [UserRole.CUSTOMER];

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
 * customer-visibility. Operational roles that actually produce these
 * documents (BOLs, customs forms, packing lists) — not the full
 * DASHBOARD_ROLES list, and deliberately not WAREHOUSE_STAFF/DRIVER,
 * matching the same "staff status alone must never imply access" stance
 * INVOICE_MANAGE_ROLES already documents. No broader read-only tier
 * exists — VIEW_ROLES equals this list, same as invoices.
 */
export const DOCUMENT_MANAGE_ROLES: UserRole[] = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.CUSTOMER_SERVICE,
  UserRole.DESTINATION_AGENT,
];

/**
 * Stage 3H: roles that may view notification/delivery history and compose
 * staff-authored bulk container/manifest disruption messages — the same
 * operational + front-office mix as DOCUMENT_MANAGE_ROLES (this is
 * customer communication about shipments, not warehouse-floor scanning).
 * No broader read-only tier exists — VIEW_ROLES equals this list, same
 * pattern as invoices/documents.
 */
export const NOTIFICATION_MANAGE_ROLES: UserRole[] = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.CUSTOMER_SERVICE,
  UserRole.DESTINATION_AGENT,
];

/**
 * Stage 4: roles that may view the Owner/Manager Analytics dashboard
 * (/dashboard/reports and every GET /analytics/* endpoint except
 * /analytics/overview, which stays open to all DASHBOARD_ROLES — see
 * AnalyticsController's own doc comment). Deliberately narrower than
 * every other *_MANAGE_ROLES list in this file: this is full-tenant
 * financial visibility (revenue, payments, outstanding invoices) plus
 * cross-warehouse operational visibility, not a single feature area.
 * WAREHOUSE_STAFF/DRIVER/DESTINATION_AGENT/CUSTOMER_SERVICE/ACCOUNTANT
 * are deliberately excluded — "staff status alone must never imply
 * access" (same stance INVOICE_MANAGE_ROLES documents), and this
 * business asked specifically for Owner/Admin/Manager, not a broader
 * front-office or single-department tier. WAREHOUSE_MANAGER is the only
 * role in this schema literally named "Manager" and is included with
 * full access (including financials) per explicit instruction, not
 * scoped to warehouse-only data.
 */
export const ANALYTICS_ROLES: UserRole[] = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
];
