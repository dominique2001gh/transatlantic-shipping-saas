import type {
  AddressType,
  ContainerStatus,
  ContainerType,
  DimensionUnit,
  DisruptionType,
  DocumentType,
  InvoiceStatus,
  ItemProcessingResult,
  ManifestStatus,
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  PaymentMethod,
  PaymentSource,
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
  /** Stage 3F: MANUAL (staff-recorded) or ONLINE (customer self-service via a payment provider). */
  source: PaymentSource;
  /** Stage 3F: the payment provider that processed an ONLINE payment (e.g. "STRIPE"); always null for MANUAL. Never the provider's session/reference id — that's an internal reconciliation handle, deliberately never serialized to any API response, staff or customer. */
  provider: string | null;
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

// ==========================================================================
// STAGE 3E: CUSTOMER PORTAL INVOICE VIEWING
// ==========================================================================

/**
 * GET /portal/invoices/:id — identical to the staff InvoiceDetail (there is
 * nothing staff-only in an invoice's own fields — no internal notes, no
 * other customer's data, no staff identity — unlike the Stage 2A/2C
 * shipment-tracking projection, which does strip staff-only detail) plus
 * the payments already recorded against it, so the customer can see their
 * own payment history without a second request. Only ever returned for an
 * invoice that has actually been issued (never DRAFT) and belongs to the
 * caller's own tenant + Customer record — see
 * InvoicesService.findByIdForCustomer.
 */
export interface PortalInvoiceDetail extends InvoiceDetail {
  payments: PaymentSummary[];
}

// ==========================================================================
// STAGE 3F: CUSTOMER SELF-SERVICE ONLINE PAYMENTS
// ==========================================================================

/**
 * POST /portal/invoices/:id/checkout-session — the only field the
 * frontend needs. `url` is Stripe's own hosted Checkout page; the
 * frontend does nothing but redirect the browser to it
 * (`window.location.href = url`) — no card data, no Stripe.js, no
 * publishable key ever touches this app's frontend.
 */
export interface CreateCheckoutSessionResponse {
  url: string;
}

// ==========================================================================
// STAGE 3G: DOCUMENTS
// ==========================================================================

/**
 * GET /documents, GET /documents/:id (staff). Never includes the
 * underlying storage key/URL — see apps/api's Document model doc comment
 * and DocumentsService.toSummary; downloads only ever happen through
 * GET /documents/:id/download, which resolves the file after its own
 * ownership check, not from a URL handed to the client in this shape.
 */
export interface DocumentSummary {
  id: string;
  tenantId: string;
  customerId: string | null;
  /** Display-only, joined from Customer — null only if customerId itself is null. */
  customerName: string | null;
  shipmentId: string | null;
  /** Display-only, joined from Shipment — null only if shipmentId itself is null. */
  shipmentTrackingNumber: string | null;
  type: DocumentType;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  description: string | null;
  visibleToCustomer: boolean;
  uploadedByUserId: string | null;
  /** Display-only, joined from User — null if uploadedByUserId is null (e.g. the uploading user was later removed). */
  uploadedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /portal/documents, GET /portal/documents/:id (customer) — a
 * deliberately stripped-down projection, the same "customer-safe
 * projection that never carries staff-only detail" principle the Stage
 * 2A/2C shipment-tracking projection already establishes (see
 * TrackingService's own doc comment) rather than DocumentSummary reused
 * as-is: no tenantId/customerId (redundant — this list is already scoped
 * to the caller), no uploadedByUserId/uploadedByName (internal staff
 * identity, not the customer's business), no visibleToCustomer (every row
 * here is, by construction, always true). Every document here is
 * guaranteed customer-visible server-side — see
 * DocumentsService.findAllForCustomer/findByIdForCustomer.
 */
export interface PortalDocumentSummary {
  id: string;
  shipmentId: string | null;
  shipmentTrackingNumber: string | null;
  type: DocumentType;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  description: string | null;
  createdAt: string;
}

// ==========================================================================
// STAGE 3H: NOTIFICATIONS & CUSTOMER MESSAGES
// ==========================================================================

/**
 * GET /notifications (staff, tenant-wide delivery/event history) — one row
 * per (customer, channel) delivery attempt, exactly what got fanned out
 * from a NotificationEvent. Never used by the portal — see
 * PortalNotificationSummary for the deliberately-stripped customer shape.
 */
export interface NotificationSummary {
  id: string;
  tenantId: string;
  eventId: string | null;
  eventType: NotificationEventType | null;
  customerId: string | null;
  customerName: string | null;
  channel: NotificationChannel;
  status: NotificationStatus;
  title: string;
  body: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * GET /portal/notifications (customer) — no tenantId/customerId (redundant,
 * already scoped), no provider tracking fields (internal delivery
 * mechanics, not the customer's business), same minimal-projection
 * principle PortalDocumentSummary/PortalShipmentSummary already follow.
 * At most one of shipmentId/invoiceId/documentId is set, resolved
 * server-side from the originating NotificationEvent — the frontend can
 * use it to link the notification to the relevant page without
 * re-deriving anything.
 */
export interface PortalNotificationSummary {
  id: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  shipmentId: string | null;
  invoiceId: string | null;
  documentId: string | null;
}

/**
 * A staff-reported container/manifest disruption — the anchor for the
 * bulk customer-notification flow (see AffectedCustomerPreviewItem/
 * DisruptionPreviewResponse below for the preview staff sees before
 * confirming). Exactly one of containerId/manifestId is set.
 */
export interface OperationalExceptionSummary {
  id: string;
  tenantId: string;
  containerId: string | null;
  containerNumber: string | null;
  manifestId: string | null;
  manifestNumber: string | null;
  type: DisruptionType;
  message: string;
  createdByUserId: string | null;
  createdByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** How many distinct customers were fanned out to when this was created. */
  notifiedCustomerCount: number;
}

/**
 * One row of the "who will be notified" preview staff see before
 * confirming a bulk disruption message — computed by resolving
 * Container/Manifest -> ContainerItem/ManifestItem -> ShipmentItem ->
 * Shipment -> Customer, deduplicated. The three willNotifyBy* flags
 * reflect that customer's own channel preferences (Customer.notifyByEmail/
 * notifyBySms/notifyByWhatsapp) — staff can see up front that, say, a
 * customer who never opted into SMS won't get one, rather than assuming a
 * blast reaches everyone the same way.
 */
export interface AffectedCustomerPreviewItem {
  customerId: string;
  customerName: string;
  shipmentTrackingNumbers: string[];
  willNotifyByEmail: boolean;
  willNotifyBySms: boolean;
  willNotifyByWhatsapp: boolean;
}

export interface DisruptionPreviewResponse {
  affectedCustomers: AffectedCustomerPreviewItem[];
}

/** GET /portal/notifications/unread-count — wrapped in an object rather than a bare number, the more robust shape for a JSON API response. */
export interface UnreadNotificationCountResponse {
  count: number;
}

// ==========================================================================
// STAGE 3I: CUSTOMER PROFILE, NOTIFICATION PREFERENCES, PASSWORD CHANGE
// ==========================================================================

/**
 * PATCH /portal/me — all fields optional (partial update). Deliberately
 * excludes `email` and `customerNumber`: email is kept read-only in this
 * stage (a real email-change flow needs its own verification/
 * re-authentication design, deferred rather than shipped unsafely), and
 * customerNumber is system/staff-assigned, never customer-editable.
 */
export interface UpdatePortalProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
}

/**
 * GET/PATCH /portal/me/notification-preferences. Mirrors the four
 * Stage 3H opt-in columns on Customer exactly — `notifyByEmail` /
 * `notifyBySms` / `notifyByWhatsapp` / `whatsappPhone` — which
 * NotificationsService.notifyCustomer already reads on every send, so a
 * preference update here takes effect on the very next notification fired,
 * with no cache or backfill involved. Deliberately no `notifyInApp` field:
 * IN_APP has no opt-out anywhere in the system (see notifyCustomer's own
 * doc comment) — critical operational in-app notification history is never
 * something a preference toggle can hide. Deliberately no "preferred
 * channel" field either: dispatch fires every enabled channel in parallel,
 * not a single preferred one, so a field nothing reads would be decorative.
 */
export interface PortalNotificationPreferences {
  notifyByEmail: boolean;
  notifyBySms: boolean;
  notifyByWhatsapp: boolean;
  /** E.164-formatted (e.g. "+233201234567"). Null unless the customer has set one. */
  whatsappPhone: string | null;
}

/** All fields optional (partial update) — same shape as PortalNotificationPreferences minus the "always present" guarantee. */
export interface UpdatePortalNotificationPreferencesRequest {
  notifyByEmail?: boolean;
  notifyBySms?: boolean;
  notifyByWhatsapp?: boolean;
  whatsappPhone?: string | null;
}

/**
 * PATCH /users/me/password — role-agnostic (any authenticated User, not
 * just CUSTOMER), since password belongs to the login-capable User
 * account, not to Customer. currentPassword is required and
 * bcrypt-verified server-side before newPassword is accepted; the
 * response never echoes back either value.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
