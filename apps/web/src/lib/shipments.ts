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

export interface CreateShipmentInput {
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

export function createShipment(input: CreateShipmentInput): Promise<ShipmentSummary> {
  return apiFetch<ShipmentSummary>('/shipments', {
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
