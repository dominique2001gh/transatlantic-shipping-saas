/**
 * Enums shared between the API and the web app.
 *
 * These mirror the Prisma enums 1:1 (see apps/api/prisma/schema.prisma).
 * Keeping a hand-written copy here lets the Next.js app depend on this
 * package without depending on `@prisma/client` (which is Node-only).
 */

/** Platform + tenant-scoped roles. PLATFORM_ADMIN operates across tenants. */
export enum UserRole {
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  TENANT_OWNER = 'TENANT_OWNER',
  TENANT_ADMIN = 'TENANT_ADMIN',
  WAREHOUSE_MANAGER = 'WAREHOUSE_MANAGER',
  WAREHOUSE_STAFF = 'WAREHOUSE_STAFF',
  CUSTOMER_SERVICE = 'CUSTOMER_SERVICE',
  ACCOUNTANT = 'ACCOUNTANT',
  DESTINATION_AGENT = 'DESTINATION_AGENT',
  DRIVER = 'DRIVER',
  CUSTOMER = 'CUSTOMER',
}

/** Roles that represent tenant staff (as opposed to a CUSTOMER end-user). */
export const STAFF_ROLES: UserRole[] = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
  UserRole.CUSTOMER_SERVICE,
  UserRole.ACCOUNTANT,
  UserRole.DESTINATION_AGENT,
  UserRole.DRIVER,
];

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

export enum DocumentType {
  BILL_OF_LADING = 'BILL_OF_LADING',
  INVOICE = 'INVOICE',
  PACKING_LIST = 'PACKING_LIST',
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

export enum AddressType {
  BILLING = 'BILLING',
  SHIPPING = 'SHIPPING',
  DESTINATION = 'DESTINATION',
  ORIGIN = 'ORIGIN',
  OTHER = 'OTHER',
}
