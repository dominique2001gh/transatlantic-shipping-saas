/**
 * Enums shared between the API and the web app.
 *
 * These mirror the Prisma enums 1:1 (see apps/api/prisma/schema.prisma).
 * Keeping a hand-written copy here lets the Next.js app depend on this
 * package without depending on `@prisma/client` (which is Node-only).
 */

/**
 * Platform + tenant-scoped roles. PLATFORM_ADMIN operates across tenants
 * (tenantId always null — see RolesGuard, which enforces that pairing).
 *
 * RBAC V1 (2026-09): this replaces the earlier 8-value granular tenant-staff
 * taxonomy (TENANT_OWNER/TENANT_ADMIN/WAREHOUSE_MANAGER/WAREHOUSE_STAFF/
 * CUSTOMER_SERVICE/ACCOUNTANT/DESTINATION_AGENT/DRIVER) with 4 tiers, each a
 * closed list of capabilities (see the shared `*_ROLES` constants in
 * constants.ts for exactly which tier can reach which endpoint):
 *   - OWNER: full tenant control, including staff administration and the
 *     AnanseLogix subscription/billing plan. Absorbs the old TENANT_OWNER
 *     and TENANT_ADMIN (which had near-identical power already).
 *   - MANAGER: broad day-to-day operational + reporting access; cannot
 *     administer staff (view-only) or touch billing/subscription/sensitive
 *     settings. Absorbs the old WAREHOUSE_MANAGER.
 *   - STAFF: hands-on operational work (customers, shipments, warehouse,
 *   containers, manifests, tracking, operational documents); no
 *     invoices/payments, no billing, no staff administration. Absorbs the
 *     old WAREHOUSE_STAFF, CUSTOMER_SERVICE, DESTINATION_AGENT, and DRIVER.
 *   - FINANCE: customers (view) plus invoices/payments/financial reporting
 *     only — no warehouse/container/manifest access at all, even to view.
 *     Absorbs the old ACCOUNTANT.
 * A data migration backfills every existing User.role to its successor
 * tier — see apps/api/prisma/migrations for the exact mapping.
 */
export enum UserRole {
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  STAFF = 'STAFF',
  FINANCE = 'FINANCE',
  CUSTOMER = 'CUSTOMER',
}

/** Every role that represents tenant staff (as opposed to a CUSTOMER end-user) — also exactly who may sign in to /dashboard. */
export const STAFF_ROLES: UserRole[] = [UserRole.OWNER, UserRole.MANAGER, UserRole.STAFF, UserRole.FINANCE];

export enum ShipmentMode {
  AIR = 'AIR',
  OCEAN_LCL = 'OCEAN_LCL',
  OCEAN_FCL = 'OCEAN_FCL',
  RORO = 'RORO',
}

/** Growable status flow. Values are ordered but not assumed contiguous. */
export enum ShipmentStatus {
  DRAFT = 'DRAFT',
  QUOTE_REQUESTED = 'QUOTE_REQUESTED',
  AWAITING_ITEMS = 'AWAITING_ITEMS',
  WAREHOUSE_RECEIVED = 'WAREHOUSE_RECEIVED',
  PROCESSING = 'PROCESSING',
  READY_FOR_CONSOLIDATION = 'READY_FOR_CONSOLIDATION',
  CONSOLIDATED = 'CONSOLIDATED',
  BOOKED = 'BOOKED',
  LOADED = 'LOADED',
  DEPARTED = 'DEPARTED',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_DESTINATION = 'ARRIVED_DESTINATION',
  CUSTOMS_PROCESSING = 'CUSTOMS_PROCESSING',
  CUSTOMS_CLEARED = 'CUSTOMS_CLEARED',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ShipmentItemType {
  BOX = 'BOX',
  BARREL = 'BARREL',
  PALLET = 'PALLET',
  CRATE = 'CRATE',
  VEHICLE = 'VEHICLE',
  MACHINERY = 'MACHINERY',
  HOUSEHOLD_GOODS = 'HOUSEHOLD_GOODS',
  OTHER = 'OTHER',
}

/// Physical workflow status of one ShipmentItem — distinct from
/// ShipmentStatus. A shipment can be WAREHOUSE_RECEIVED overall while one
/// of its items is still REGISTERED (not yet physically dropped off).
export enum ShipmentItemStatus {
  REGISTERED = 'REGISTERED',
  RECEIVED_ORIGIN_WAREHOUSE = 'RECEIVED_ORIGIN_WAREHOUSE',
  MEASURED = 'MEASURED',
  PROCESSED = 'PROCESSED',
  CONSOLIDATED = 'CONSOLIDATED',
  ASSIGNED_TO_CONTAINER = 'ASSIGNED_TO_CONTAINER',
  /// Air-freight equivalent of ASSIGNED_TO_CONTAINER (Milestone 3E) — used
  /// only for items assigned directly to a Manifest with no container.
  ASSIGNED_TO_MANIFEST = 'ASSIGNED_TO_MANIFEST',
  LOADED = 'LOADED',
  DEPARTED_ORIGIN = 'DEPARTED_ORIGIN',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_DESTINATION = 'ARRIVED_DESTINATION',
  RECEIVED_DESTINATION_WAREHOUSE = 'RECEIVED_DESTINATION_WAREHOUSE',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  PICKED_UP = 'PICKED_UP',
  EXCEPTION = 'EXCEPTION',
  CANCELLED = 'CANCELLED',
}

/// The operational audit-trail vocabulary for TrackingEvent — deliberately
/// more granular than ShipmentStatus, and covers both shipment-level and
/// item-level events (see TrackingEvent.shipmentItemId in the API).
export enum TrackingEventType {
  SHIPMENT_CREATED = 'SHIPMENT_CREATED',
  ITEM_REGISTERED = 'ITEM_REGISTERED',
  RECEIVED_AT_WAREHOUSE = 'RECEIVED_AT_WAREHOUSE',
  MEASURED = 'MEASURED',
  PROCESSED = 'PROCESSED',
  CONSOLIDATED = 'CONSOLIDATED',
  ASSIGNED_TO_CONTAINER = 'ASSIGNED_TO_CONTAINER',
  REMOVED_FROM_CONTAINER = 'REMOVED_FROM_CONTAINER',
  ASSIGNED_TO_MANIFEST = 'ASSIGNED_TO_MANIFEST',
  REMOVED_FROM_MANIFEST = 'REMOVED_FROM_MANIFEST',
  LOADED = 'LOADED',
  DEPARTED_ORIGIN = 'DEPARTED_ORIGIN',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_DESTINATION = 'ARRIVED_DESTINATION',
  RECEIVED_DESTINATION_WAREHOUSE = 'RECEIVED_DESTINATION_WAREHOUSE',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  PICKED_UP = 'PICKED_UP',
  /// A failed/incomplete delivery attempt that came back to a destination
  /// warehouse — see WarehouseService.returnItem in the API.
  RETURNED_TO_WAREHOUSE = 'RETURNED_TO_WAREHOUSE',
  /// Shipment-level: every applicable item reached a terminal successful
  /// handoff (PICKED_UP and/or DELIVERED, any mix) — see the API's
  /// WarehouseService.maybeRollupShipmentCompletion.
  COMPLETED = 'COMPLETED',
  EXCEPTION = 'EXCEPTION',
  CANCELLED = 'CANCELLED',
  NOTE_ADDED = 'NOTE_ADDED',
}

/** How a tracking event was captured. */
export enum TrackingEventSource {
  MANUAL = 'MANUAL',
  BARCODE_SCAN = 'BARCODE_SCAN',
  QR_SCAN = 'QR_SCAN',
  SYSTEM = 'SYSTEM',
  API = 'API',
}

/**
 * Controlled vocabulary for the physical condition observed during a
 * warehouse inspection (Milestone 3C). Replaces the free-text
 * ShipmentItem.condition Milestone 3B left as a placeholder.
 */
export enum ShipmentItemCondition {
  GOOD = 'GOOD',
  MINOR_DAMAGE = 'MINOR_DAMAGE',
  DAMAGED = 'DAMAGED',
  REPACKAGED = 'REPACKAGED',
  OTHER = 'OTHER',
}

/**
 * Outcome of a warehouse inspection: whether the item may continue
 * forward through the pipeline. Maps 1:1 onto ShipmentItemStatus.PROCESSED
 * (READY) vs .EXCEPTION (HOLD) — see WarehouseService.processItem.
 */
export enum ItemProcessingResult {
  READY = 'READY',
  HOLD = 'HOLD',
}

export enum DimensionUnit {
  IN = 'IN',
  CM = 'CM',
}

export enum WeightUnit {
  LB = 'LB',
  KG = 'KG',
}

export enum ContainerType {
  TWENTY_FT = 'TWENTY_FT',
  FORTY_FT = 'FORTY_FT',
  FORTY_FT_HIGH_CUBE = 'FORTY_FT_HIGH_CUBE',
  OTHER = 'OTHER',
}

export enum ContainerStatus {
  BOOKED = 'BOOKED',
  LOADING = 'LOADING',
  LOADED = 'LOADED',
  DEPARTED = 'DEPARTED',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED = 'ARRIVED',
  CUSTOMS_HOLD = 'CUSTOMS_HOLD',
  UNLOADING = 'UNLOADING',
  CLOSED = 'CLOSED',
}

export enum ManifestStatus {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
  /// Milestone 3E-A adds this value for schema completeness; the depart
  /// action itself is a deliberately separate, later controlled step.
  DEPARTED = 'DEPARTED',
  /// Milestone 3F: the whole transport movement has landed at
  /// destination. Distinct from any individual item being physically
  /// received at a destination warehouse.
  ARRIVED = 'ARRIVED',
  SUBMITTED = 'SUBMITTED',
  ARCHIVED = 'ARCHIVED',
}

export enum VehicleTitleStatus {
  CLEAN = 'CLEAN',
  SALVAGE = 'SALVAGE',
  REBUILT = 'REBUILT',
  LIEN = 'LIEN',
  BILL_OF_SALE_ONLY = 'BILL_OF_SALE_ONLY',
  UNKNOWN = 'UNKNOWN',
}

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  CONVERTED = 'CONVERTED',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  VOID = 'VOID',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  MOBILE_MONEY = 'MOBILE_MONEY',
  CHECK = 'CHECK',
  OTHER = 'OTHER',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

/** Stage 3F: MANUAL (staff-recorded, Stage 3B) vs ONLINE (customer self-service via a payment provider, Stage 3F). */
export enum PaymentSource {
  MANUAL = 'MANUAL',
  ONLINE = 'ONLINE',
}

export enum DocumentType {
  BILL_OF_LADING = 'BILL_OF_LADING',
  INVOICE = 'INVOICE',
  PACKING_LIST = 'PACKING_LIST',
  MANIFEST = 'MANIFEST',
  CUSTOMS_FORM = 'CUSTOMS_FORM',
  ID_DOCUMENT = 'ID_DOCUMENT',
  TITLE_DOCUMENT = 'TITLE_DOCUMENT',
  PHOTO = 'PHOTO',
  OTHER = 'OTHER',
}

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  READ = 'READ',
}

/** Stage 3H: what kind of business occurrence produced a NotificationEvent. */
export enum NotificationEventType {
  SHIPMENT_STATUS_CHANGED = 'SHIPMENT_STATUS_CHANGED',
  DOCUMENT_VISIBLE = 'DOCUMENT_VISIBLE',
  INVOICE_ISSUED = 'INVOICE_ISSUED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  CONTAINER_DISRUPTED = 'CONTAINER_DISRUPTED',
  STAFF_ANNOUNCEMENT = 'STAFF_ANNOUNCEMENT',
}

/** Stage 3H: the kind of operational disruption staff are reporting on a container/manifest. */
export enum DisruptionType {
  DELAYED = 'DELAYED',
  HELD = 'HELD',
  INSPECTED = 'INSPECTED',
  IMPOUNDED = 'IMPOUNDED',
  OTHER = 'OTHER',
}

export enum AddressType {
  BILLING = 'BILLING',
  SHIPPING = 'SHIPPING',
  DESTINATION = 'DESTINATION',
  ORIGIN = 'ORIGIN',
  OTHER = 'OTHER',
}

/** Website Launch: which public marketing-site form a WebsiteLead came from. */
export enum WebsiteLeadType {
  QUOTE_REQUEST = 'QUOTE_REQUEST',
  CONTACT = 'CONTACT',
}

/** Website Launch: simple staff-managed triage state for a WebsiteLead. */
export enum WebsiteLeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  CLOSED = 'CLOSED',
}

// ==========================================================================
// SAAS PLATFORM — mirrors apps/api/prisma/schema.prisma's SAAS PLATFORM
// section 1:1. See that section's own header comment for what this layer is.
// ==========================================================================

/**
 * SOFTWARE_ONLY and WEBSITE_AND_SOFTWARE are retired from public sale —
 * SOFTWARE_AND_WEBSITE_BASIC/PROFESSIONAL replace WEBSITE_AND_SOFTWARE as
 * the combined offering, at two price points — but stay in this enum
 * (never removed) so existing plan/subscription records from tenants who
 * bought under the old structure keep resolving cleanly.
 */
export enum SaasPlanType {
  WEBSITE_ONLY = 'WEBSITE_ONLY',
  SOFTWARE_ONLY = 'SOFTWARE_ONLY',
  WEBSITE_AND_SOFTWARE = 'WEBSITE_AND_SOFTWARE',
  SOFTWARE_AND_WEBSITE_BASIC = 'SOFTWARE_AND_WEBSITE_BASIC',
  SOFTWARE_AND_WEBSITE_PROFESSIONAL = 'SOFTWARE_AND_WEBSITE_PROFESSIONAL',
}

export enum BillingInterval {
  MONTH = 'MONTH',
}

export enum SignupSessionStatus {
  DRAFT = 'DRAFT',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
}

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  UNPAID = 'UNPAID',
  CANCELED = 'CANCELED',
  SUSPENDED = 'SUSPENDED',
}

export enum SetupFeeStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  WAIVED = 'WAIVED',
}

export enum EntitlementFeature {
  PUBLIC_WEBSITE = 'PUBLIC_WEBSITE',
  OPERATIONS_SOFTWARE = 'OPERATIONS_SOFTWARE',
  CUSTOMER_PORTAL = 'CUSTOMER_PORTAL',
  TRACKING = 'TRACKING',
  BILLING = 'BILLING',
  ANALYTICS = 'ANALYTICS',
  AI_AGENT = 'AI_AGENT',
  ADVANCED_FEATURES = 'ADVANCED_FEATURES',
}

export enum OnboardingStep {
  BRANDING = 'BRANDING',
  OPERATIONS = 'OPERATIONS',
  STAFF = 'STAFF',
  TRACKING = 'TRACKING',
  NOTIFICATIONS = 'NOTIFICATIONS',
  BILLING = 'BILLING',
  DONE = 'DONE',
}

export enum TenantInvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

/** Platform-level triage state for a prospect wanting to become a tenant — separate from WebsiteLeadStatus. */
export enum PlatformLeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  DEMO_SCHEDULED = 'DEMO_SCHEDULED',
  TRIAL = 'TRIAL',
  CONVERTED = 'CONVERTED',
  LOST = 'LOST',
}

export enum PlatformLeadSource {
  DIRECT = 'DIRECT',
  CAMPAIGN = 'CAMPAIGN',
  REFERRAL = 'REFERRAL',
  SALES_OUTREACH = 'SALES_OUTREACH',
}
