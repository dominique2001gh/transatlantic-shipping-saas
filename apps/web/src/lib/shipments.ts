import type {
  DimensionUnit,
  ShipmentItemStatus,
  ShipmentItemType,
  ShipmentMode,
  ShipmentStatus,
  ShipmentSummary,
  TrackingEventSummary,
  TrackingEventType,
  WeightUnit,
} from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface ShipmentItemInput {
  itemType: ShipmentItemType;
  description?: string;
  quantity?: number;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: DimensionUnit;
  weight?: number;
  weightUnit?: WeightUnit;
  declaredValue?: number;
}

/** Consignee at destination — required name/phone, everything else optional. Shared shape between New Shipment and Quick Receive; both create the same Shipment.recipient* columns. */
export interface RecipientInput {
  recipientName: string;
  recipientPhone: string;
  recipientEmail?: string;
  recipientAddressLine1?: string;
  recipientAddressLine2?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientCountry?: string;
  recipientPostalCode?: string;
}

export interface CreateShipmentInput extends RecipientInput {
  customerId: string;
  shipmentMode: ShipmentMode;
  originCountry: string;
  destinationCountry: string;
  originLocation?: string;
  destinationLocation?: string;
  originWarehouseId?: string;
  destinationWarehouseId?: string;
  description?: string;
  declaredValue?: number;
  currency?: string;
  items?: ShipmentItemInput[];
}

/**
 * Quick Receive: mirrors CreateShipmentInput but takes `packageCount`
 * instead of an explicit `items[]` — the server generates that many
 * identical-defaults items and marks every one of them received at
 * `originWarehouseId` immediately (see ShipmentsService.createQuickReceive).
 *
 * Phase 2: deliberately has no `originCountry`/`originLocation` — the
 * server derives both from the selected `originWarehouseId`'s own address,
 * so there is nothing for this client to send (see QuickReceiveDto's own
 * doc comment). `destinationWarehouseId` is optional and purely additive —
 * it never overrides the staff-entered `destinationCountry`/`destinationLocation`.
 */
export interface QuickReceiveInput extends RecipientInput {
  customerId: string;
  shipmentMode: ShipmentMode;
  destinationCountry: string;
  destinationLocation?: string;
  originWarehouseId: string;
  destinationWarehouseId?: string;
  description?: string;
  packageCount: number;
  itemType?: ShipmentItemType;
  itemDescription?: string;
  weight?: number;
  weightUnit?: WeightUnit;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: DimensionUnit;
  declaredValue?: number;
  notes?: string;
}

export interface CreateTrackingEventInput {
  eventType: TrackingEventType;
  shipmentItemId?: string;
  status?: ShipmentStatus;
  itemStatus?: ShipmentItemStatus;
  warehouseId?: string;
  location?: string;
  notes?: string;
  occurredAt?: string;
}

export function listShipments(filters?: {
  customerId?: string;
  status?: ShipmentStatus;
}): Promise<ShipmentSummary[]> {
  const params = new URLSearchParams();
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<ShipmentSummary[]>(`/shipments${qs}`, { token: authToken() });
}

export function getShipment(id: string): Promise<ShipmentSummary> {
  return apiFetch<ShipmentSummary>(`/shipments/${id}`, { token: authToken() });
}

/** Staff Tracking page: search by tracking number, item/package code, or customer name/number. */
export function searchShipments(query: string): Promise<ShipmentSummary[]> {
  const params = new URLSearchParams({ query });
  return apiFetch<ShipmentSummary[]>(`/shipments/search?${params.toString()}`, { token: authToken() });
}

export function createShipment(input: CreateShipmentInput): Promise<ShipmentSummary> {
  return apiFetch<ShipmentSummary>('/shipments', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function createQuickReceive(input: QuickReceiveInput): Promise<ShipmentSummary> {
  return apiFetch<ShipmentSummary>('/shipments/quick-receive', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function addShipmentItem(shipmentId: string, input: ShipmentItemInput): Promise<ShipmentSummary> {
  return apiFetch<ShipmentSummary>(`/shipments/${shipmentId}/items`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function listTrackingEvents(shipmentId: string): Promise<TrackingEventSummary[]> {
  return apiFetch<TrackingEventSummary[]>(`/shipments/${shipmentId}/tracking-events`, {
    token: authToken(),
  });
}

export function createTrackingEvent(
  shipmentId: string,
  input: CreateTrackingEventInput,
): Promise<TrackingEventSummary> {
  return apiFetch<TrackingEventSummary>(`/shipments/${shipmentId}/tracking-events`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}
