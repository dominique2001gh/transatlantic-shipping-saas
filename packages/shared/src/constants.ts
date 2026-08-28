import { UserRole } from './enums';

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

/** Roles allowed to sign in to the customer portal (/portal). */
export const PORTAL_ROLES: UserRole[] = [UserRole.CUSTOMER];
