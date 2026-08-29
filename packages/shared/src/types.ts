import type {
  AddressType,
  ContainerStatus,
  ContainerType,
  DimensionUnit,
  ItemProcessingResult,
  ManifestStatus,
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
}

// ==========================================================================
// MANIFESTS (Milestone 3E-A — foundation only: create/list/detail.
// Assignment, finalize, and depart are later controlled steps and are
// not reflected in these shapes' behavior yet, only their structure.)
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
  createdAt: string;
  updatedAt: string;
  originWarehouse: { id: string; name: string; code: string } | null;
  route: { id: string; name: string; originCountry: string; destinationCountry: string } | null;
  finalizedByUser: TrackingEventActor | null;
  departedByUser: TrackingEventActor | null;
  containers: ManifestContainerSummary[];
  items: ManifestItemSummary[];
  summary: ManifestContentsSummary;
}
