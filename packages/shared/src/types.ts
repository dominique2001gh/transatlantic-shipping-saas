import type {
  AddressType,
  ContainerStatus,
  ContainerType,
  DimensionUnit,
  InvoiceStatus,
  ItemProcessingResult,
  ManifestStatus,
  PaymentMethod,
  PaymentStatus,
  ShipmentItemCondition,
  ShipmentItemStatus,
  ShipmentItemType,
  ShipmentMode,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
  WeightUnit,
} from './enums';
import { UserRole } from './enums';

/** Shape of the JWT access token payload issued by the API. */
export interface JwtPayload {
  /** User id (subject). */
  sub: string;
  email: string;
  role: UserRole;
  /**
   * Null only for PLATFORM_ADMIN users, who are not scoped to a tenant.
   * Every other role must always carry a tenantId.
   */
  tenantId: string | null;
  /** Set when role === CUSTOMER, links the user to their Customer record. */
  customerId?: string | null;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
  customerId?: string | null;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface LoginResponseDto {
  accessToken: string;
  user: AuthenticatedUser;
}

/** Standard shape for a validation/error response from the API. */
export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
}

/** Standard envelope for paginated list endpoints. */
export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
}

// ==========================================================================
// OPERATIONS (Milestone 3A) — response shapes returned by the API.
//
// Prisma Decimal fields (weight/length/width/height/declaredValue) are
// serialized to JSON as strings (Decimal.prototype.toJSON), not numbers —
// these interfaces reflect that actual wire shape rather than the Prisma
// model's in-process type.
// ==========================================================================

export interface CustomerSummary {
  id: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentItemSummary {
  id: string;
  shipmentId: string;
  itemCode: string;
  sequenceNumber: number;
  itemType: ShipmentItemType;
  status: ShipmentItemStatus;
  description: string | null;
  quantity: number;
  length: string | null;
  width: string | null;
  height: string | null;
  dimensionUnit: DimensionUnit;
  weight: string | null;
  weightUnit: WeightUnit;
  declaredValue: string | null;
  condition: ShipmentItemCondition | null;
  externalTrackingCarrier: string | null;
  externalTrackingNumber: string | null;
  currentWarehouseId: string | null;
  receivedAt: string | null;
  receivedByUserId: string | null;
  /** Denormalized convenience only — see ItemInspectionSummary for the full history. */
  lastInspectedAt: string | null;
  lastInspectedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentItemCounts {
  total: number;
  received: number;
}

export interface ShipmentSummary {
  id: string;
  tenantId: string;
  trackingNumber: string;
  shipmentMode: ShipmentMode;
  status: ShipmentStatus;
  originCountry: string;
  destinationCountry: string;
  originLocation: string | null;
  destinationLocation: string | null;
  description: string | null;
  declaredValue: string | null;
  currency: string | null;
  customerId: string;
  createdAt: string;
  updatedAt: string;
  customer?: CustomerSummary;
  items?: ShipmentItemSummary[];
  itemCounts?: ShipmentItemCounts;
}

export interface TrackingEventActor {
  id: string;
  firstName: string;
  lastName: string;
}

export interface TrackingEventSummary {
  id: string;
  shipmentId: string;
  shipmentItemId: string | null;
  eventType: TrackingEventType;
  source: TrackingEventSource;
  status: ShipmentStatus | null;
  warehouseId: string | null;
  location: string | null;
  notes: string | null;
  scanIdentifier: string | null;
  metadata: unknown;
  occurredAt: string;
  createdAt: string;
  createdByUserId: string | null;
  createdByUser?: TrackingEventActor | null;
}

export interface AddressSummary {
  id: string;
  type: AddressType;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface CustomerDetail extends CustomerSummary {
  addresses: AddressSummary[];
  shipments: ShipmentSummary[];
}

// ==========================================================================
// WAREHOUSE (Milestone 3B)
// ==========================================================================

export interface WarehouseSummary {
  id: string;
  name: string;
  code: string;
  isOriginWarehouse: boolean;
  isDestinationWarehouse: boolean;
}

/** One inspection/processing record (Milestone 3C) — append-only history behind a ShipmentItem. */
export interface ItemInspectionSummary {
  id: string;
  weight: string | null;
  weightUnit: WeightUnit | null;
  length: string | null;
  width: string | null;
  height: string | null;
  dimensionUnit: DimensionUnit | null;
  condition: ShipmentItemCondition;
  result: ItemProcessingResult;
  hasException: boolean;
  exceptionDescription: string | null;
  notes: string | null;
  inspectedAt: string;
  inspectedByUser: TrackingEventActor | null;
  warehouse: { id: string; name: string; code: string } | null;
}

/** A fully resolved ShipmentItem — the shape returned by scan/search/receive/inventory/process. */
export interface WarehouseItemDetail {
  id: string;
  itemCode: string;
  sequenceNumber: number;
  itemType: ShipmentItemType;
  status: ShipmentItemStatus;
  description: string | null;
  weight: string | null;
  weightUnit: WeightUnit;
  length: string | null;
  width: string | null;
  height: string | null;
  dimensionUnit: DimensionUnit;
  condition: ShipmentItemCondition | null;
  receivedAt: string | null;
  lastInspectedAt: string | null;
  shipment: {
    id: string;
    trackingNumber: string;
    status: ShipmentStatus;
    destinationCountry: string;
    destinationLocation: string | null;
    customer: {
      id: string;
      customerNumber: string;
      firstName: string;
      lastName: string;
    };
  };
  currentWarehouse: { id: string; name: string; code: string } | null;
  receivedByUser: TrackingEventActor | null;
  lastInspectedByUser: TrackingEventActor | null;
  /** Most recent inspection, if any — null for an item that has never been processed. */
  lastInspection: ItemInspectionSummary | null;
}

export interface WarehouseActivityEntry {
  id: string;
  eventType: TrackingEventType;
  source: TrackingEventSource;
  occurredAt: string;
  notes: string | null;
  createdByUser: TrackingEventActor | null;
  warehouse: { id: string; name: string; code: string } | null;
  shipmentItem: { id: string; itemCode: string; itemType: ShipmentItemType } | null;
  shipment: { id: string; trackingNumber: string };
}

// ==========================================================================
// CONTAINERS (Milestone 3D)
// ==========================================================================

/** One currently-loaded (not removed) item inside a container. */
export interface ContainerItemSummary {
  id: string;
  loadedAt: string;
  loadedByUser: TrackingEventActor | null;
  shipmentItem: {
    id: string;
    itemCode: string;
    itemType: ShipmentItemType;
    description: string | null;
    weight: string | null;
    weightUnit: WeightUnit;
    status: ShipmentItemStatus;
  };
  shipment: {
    id: string;
    trackingNumber: string;
    destinationCountry: string;
    destinationLocation: string | null;
    customer: { id: string; customerNumber: string; firstName: string; lastName: string };
  };
}

/** Live-computed contents summary — never stored, always derived from current ContainerItem rows. */
export interface ContainerContentsSummary {
  itemCount: number;
  customerCount: number;
  /** Grouped by unit rather than converted — see schema.prisma Container doc comment. */
  weightByUnit: Record<string, number>;
}

/**
 * Live-computed, destination-side progress (Milestone 3F). Present only
 * once the container has reached ARRIVED or later — null beforehand.
 * `outstandingCount` is never silently folded into `receivedCount`: a
 * still-outstanding or EXCEPTION item is always visible here, even after
 * the container is CLOSED, so a discrepancy can never be hidden.
 */
export interface ContainerDestinationSummary {
  receivedCount: number;
  outstandingCount: number;
  exceptionCount: number;
}

export interface ContainerDetail {
  id: string;
  tenantId: string;
  containerNumber: string;
  containerType: ContainerType;
  status: ContainerStatus;
  sealNumber: string | null;
  originPort: string | null;
  destinationPort: string | null;
  departureDate: string | null;
  estimatedArrival: string | null;
  actualArrival: string | null;
  loadingFinalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  warehouse: { id: string; name: string; code: string } | null;
  route: { id: string; name: string; originCountry: string; destinationCountry: string } | null;
  loadingFinalizedByUser: TrackingEventActor | null;
  items: ContainerItemSummary[];
  summary: ContainerContentsSummary;
  /** Present only on a loadItem response when the item's destination doesn't match the container's route. */
  destinationWarning?: string;
  /**
   * Non-null once this (LOADED) container has been assigned to an Ocean/
   * RoRo manifest (Milestone 3E). Needed by the Manifest frontend's
   * container picker to distinguish "eligible" from "already assigned"
   * containers before attempting an assignment.
   */
  manifestId: string | null;
  manifest: { id: string; manifestNumber: string } | null;
  /** Milestone 3F: null until this container has ARRIVED — see ContainerDestinationSummary. */
  destinationSummary: ContainerDestinationSummary | null;
}

// ==========================================================================
// MANIFESTS (3E-A: create/list/detail. 3E-B: container/item assignment.
// 3E-C: finalize (DRAFT -> FINALIZED) and depart (FINALIZED -> DEPARTED).)
// ==========================================================================

/** One direct (air-freight) item assignment to a manifest — not yet writable in 3E-A. */
export interface ManifestItemSummary {
  id: string;
  addedAt: string;
  addedByUser: TrackingEventActor | null;
  shipmentItem: {
    id: string;
    itemCode: string;
    itemType: ShipmentItemType;
    description: string | null;
    weight: string | null;
    weightUnit: WeightUnit;
    status: ShipmentItemStatus;
  };
  shipment: {
    id: string;
    trackingNumber: string;
    destinationCountry: string;
    destinationLocation: string | null;
    customer: { id: string; customerNumber: string; firstName: string; lastName: string };
  };
}

/** Minimal container summary as seen from a manifest — full detail lives at GET /containers/:id. */
export interface ManifestContainerSummary {
  id: string;
  containerNumber: string;
  containerType: ContainerType;
  status: ContainerStatus;
}

/** Live-computed contents summary — never stored, always derived. Always zero in 3E-A (nothing can be assigned yet). */
export interface ManifestContentsSummary {
  containerCount: number;
  itemCount: number;
  customerCount: number;
  weightByUnit: Record<string, number>;
}

export interface ManifestDetail {
  id: string;
  tenantId: string;
  manifestNumber: string;
  status: ManifestStatus;
  shipmentMode: ShipmentMode;
  originLocation: string | null;
  destinationLocation: string | null;
  carrierName: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
  flightNumber: string | null;
  plannedDepartureAt: string | null;
  estimatedArrivalAt: string | null;
  finalizedAt: string | null;
  departedAt: string | null;
  /** Milestone 3F: when this movement's cargo landed at destination. */
  arrivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  originWarehouse: { id: string; name: string; code: string } | null;
  route: { id: string; name: string; originCountry: string; destinationCountry: string } | null;
  finalizedByUser: TrackingEventActor | null;
  departedByUser: TrackingEventActor | null;
  arrivedByUser: TrackingEventActor | null;
  containers: ManifestContainerSummary[];
  items: ManifestItemSummary[];
  summary: ManifestContentsSummary;
}

// ==========================================================================
// STAGE 2A: CUSTOMER/PUBLIC TRACKING
// ==========================================================================

/** One entry in a shipment's curated, customer-facing milestone timeline. */
export interface PublicTrackingMilestone {
  label: string;
  occurredAt: string;
  /** City/country only — never a warehouse's internal name/code/id. */
  location: string | null;
}

/** One item's current stage, within a resolved shipment lookup — never independently searchable in V1 (see PublicTrackingLookupResult). */
export interface PublicTrackingItemSummary {
  itemCode: string;
  itemType: ShipmentItemType;
  description: string | null;
  milestone: {
    label: string;
    occurredAt: string | null;
  };
}

/**
 * The complete customer-safe projection returned by the public tracking
 * lookup. Deliberately excludes: database ids (other than the public
 * tracking number/item code, which are themselves the lookup keys),
 * customer/staff identity, declared value, raw TrackingEvent notes/
 * metadata, and any EXCEPTION detail — see WarehouseController's
 * TrackingController equivalent (apps/api/src/tracking) for the
 * enforcement, and packages/shared/tracking-milestones.ts for the label
 * mapping this is built from.
 */
export interface PublicTrackingResult {
  trackingNumber: string;
  originCountry: string;
  destinationCountry: string;
  createdAt: string;
  /** The shipment's current stage — read directly from the existing, unmodified Shipment.status rollup, never re-derived here. */
  overallMilestone: {
    label: string;
    occurredAt: string | null;
  };
  isCompleted: boolean;
  /** "X of Y items reached a final handoff" — present even when 1, so multi- and single-item shipments share one shape. */
  itemSummary: {
    total: number;
    completed: number;
  };
  /** Shipment-level milestone history, chronological, deduplicated by label. */
  timeline: PublicTrackingMilestone[];
  items: PublicTrackingItemSummary[];
}

// ==========================================================================
// STAGE 2C: AUTHENTICATED CUSTOMER PORTAL
// ==========================================================================

/** GET /portal/me — the logged-in customer's own profile. Deliberately thin: no addresses, no internal/staff-facing fields. */
export interface PortalCustomerProfile {
  customerNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

/**
 * One row in GET /portal/shipments. A lighter shape than
 * PortalShipmentDetail/PublicTrackingResult on purpose — no item list, no
 * full timeline — since a list view only needs to render current status per
 * shipment, not re-fetch everything about each one.
 */
export interface PortalShipmentSummary {
  id: string;
  trackingNumber: string;
  shipmentMode: ShipmentMode;
  originCountry: string;
  destinationCountry: string;
  createdAt: string;
  overallMilestone: {
    label: string;
    occurredAt: string | null;
  };
  isCompleted: boolean;
  itemSummary: {
    total: number;
    completed: number;
  };
}

/**
 * GET /portal/shipments/:id — full detail for one of the caller's own
 * shipments. Identical shape to PublicTrackingResult, because it's built by
 * the exact same TrackingService projection (see
 * TrackingService.getForCustomer) — just reached through JWT-based
 * tenant+customer scoping instead of the public tenantSlug+trackingNumber+
 * lastName lookup. `id` is additionally safe to expose here (unlike the
 * public projection) because the caller has already authenticated as the
 * owning customer.
 */
export interface PortalShipmentDetail extends PublicTrackingResult {
  id: string;
  shipmentMode: ShipmentMode;
}

// ==========================================================================
// STAGE 3A: STAFF INVOICE MANAGEMENT
// ==========================================================================

/**
 * Every monetary field below is a fixed 2-decimal-place STRING (e.g.
 * "1234.50"), never a number — see apps/api/src/common/money/money.util.ts.
 * Prisma's Decimal serializes to JSON as a variable-precision string by
 * default (toJSON() => toString(), e.g. "1234.5"); the API normalizes
 * every value to exactly 2 decimals before it reaches this shape. Treat
 * these as display-ready strings, not numbers to compute with — all
 * financial arithmetic (subtotal/tax/total/balance) is done server-side
 * with Prisma.Decimal, never floating-point.
 */
export interface InvoiceItemSummary {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
}

export interface InvoiceSummary {
  id: string;
  tenantId: string;
  customerId: string;
  /** Display-only, joined from Customer — never authoritative for authorization. */
  customerName: string;
  /** Nullable at the schema level for future non-shipment invoices (credits/adjustments) — required by the API for every invoice created in Stage 3A. */
  shipmentId: string | null;
  /** Display-only, joined from Shipment — null only if shipmentId itself is null. */
  shipmentTrackingNumber: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotal: string;
  tax: string;
  total: string;
  amountPaid: string;
  /** total - amountPaid, computed server-side so the frontend never re-derives it from two decimal strings. */
  balanceDue: string;
  currency: string;
  dueDate: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /invoices/:id (staff) — full detail including line items. */
export interface InvoiceDetail extends InvoiceSummary {
  items: InvoiceItemSummary[];
}

// ==========================================================================
// STAGE 3B: MANUAL PAYMENT RECORDING
// ==========================================================================

/**
 * A manually-recorded payment against one invoice (GET/POST
 * /invoices/:invoiceId/payments). `customerId` and `currency` are always
 * derived server-side from the parent invoice — never accepted as request
 * input — so a payment can never be attributed to the wrong customer or
 * carry a mismatched currency. Payments are append-only in Stage 3B: no
 * edit/delete endpoint exists. `amount` follows the same fixed
 * 2-decimal-place string convention as every other money field (see
 * InvoiceSummary's doc comment / apps/api/src/common/money/money.util.ts).
 */
export interface PaymentSummary {
  id: string;
  tenantId: string;
  invoiceId: string;
  customerId: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  referenceNumber: string | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stage 3D: GET /payments (staff, tenant-wide) — the same fields as
 * PaymentSummary plus a couple of display-only fields so the staff
 * payments list doesn't need a separate lookup per row to show which
 * invoice/customer each payment belongs to. Nothing new is exposed beyond
 * what a staff user could already reach via the invoice itself.
 */
export interface PaymentListItem extends PaymentSummary {
  invoiceNumber: string;
  customerName: string;
}
