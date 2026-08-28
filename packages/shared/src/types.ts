import type {
  AddressType,
  DimensionUnit,
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
  condition: string | null;
  externalTrackingCarrier: string | null;
  externalTrackingNumber: string | null;
  currentWarehouseId: string | null;
  receivedAt: string | null;
  receivedByUserId: string | null;
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

/** A fully resolved ShipmentItem — the shape returned by scan/search/receive/inventory. */
export interface WarehouseItemDetail {
  id: string;
  itemCode: string;
  sequenceNumber: number;
  itemType: ShipmentItemType;
  status: ShipmentItemStatus;
  description: string | null;
  weight: string | null;
  weightUnit: WeightUnit;
  receivedAt: string | null;
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
