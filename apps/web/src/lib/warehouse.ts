import type {
  DimensionUnit,
  ItemProcessingResult,
  ShipmentItemCondition,
  WarehouseActivityEntry,
  WarehouseItemDetail,
  WarehouseSummary,
  WeightUnit,
} from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

export interface DestinationReceiveItemInput {
  warehouseId: string;
  condition: ShipmentItemCondition;
  hasException?: boolean;
  exceptionDescription?: string;
  notes?: string;
  scanned: boolean;
  scanIdentifier?: string;
}

export interface PickupItemInput {
  warehouseId: string;
  recipientName: string;
  recipientPhone?: string;
  recipientIdReference?: string;
  notes?: string;
  scanned: boolean;
  scanIdentifier?: string;
}

export interface DispatchItemInput {
  warehouseId: string;
  recipientName: string;
  recipientPhone?: string;
  deliveryAddress?: string;
  driverUserId?: string;
  courierName?: string;
  courierPhone?: string;
  courierReference?: string;
  notes?: string;
  scanned: boolean;
  scanIdentifier?: string;
}

export interface DeliverItemInput {
  warehouseId: string;
  recipientName: string;
  recipientPhone?: string;
  recipientIdReference?: string;
  driverUserId?: string;
  courierName?: string;
  courierPhone?: string;
  courierReference?: string;
  notes?: string;
  scanned: boolean;
  scanIdentifier?: string;
}

export interface ReturnItemInput {
  warehouseId: string;
  failureReason: string;
  hasException?: boolean;
  notes?: string;
  scanned: boolean;
  scanIdentifier?: string;
}

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface ReceiveItemInput {
  warehouseId: string;
  notes?: string;
  scanned: boolean;
  scanIdentifier?: string;
}

export interface ProcessItemInput {
  warehouseId: string;
  weight?: number;
  weightUnit?: WeightUnit;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: DimensionUnit;
  condition: ShipmentItemCondition;
  result: ItemProcessingResult;
  hasException?: boolean;
  exceptionDescription?: string;
  notes?: string;
  scanned: boolean;
  scanIdentifier?: string;
  reinspection?: boolean;
}

export function listWarehouseLocations(): Promise<WarehouseSummary[]> {
  return apiFetch<WarehouseSummary[]>('/warehouse/locations', { token: authToken() });
}

export function scanItem(code: string): Promise<WarehouseItemDetail> {
  return apiFetch<WarehouseItemDetail>(`/warehouse/scan?code=${encodeURIComponent(code)}`, {
    token: authToken(),
  });
}

export function searchWarehouseItems(query: string): Promise<WarehouseItemDetail[]> {
  return apiFetch<WarehouseItemDetail[]>(`/warehouse/search?query=${encodeURIComponent(query)}`, {
    token: authToken(),
  });
}

export function receiveItem(itemId: string, input: ReceiveItemInput): Promise<WarehouseItemDetail> {
  return apiFetch<WarehouseItemDetail>(`/warehouse/items/${itemId}/receive`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function processItem(itemId: string, input: ProcessItemInput): Promise<WarehouseItemDetail> {
  return apiFetch<WarehouseItemDetail>(`/warehouse/items/${itemId}/process`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function destinationReceiveItem(
  itemId: string,
  input: DestinationReceiveItemInput,
): Promise<WarehouseItemDetail & { destinationWarning?: string }> {
  return apiFetch<WarehouseItemDetail & { destinationWarning?: string }>(`/warehouse/items/${itemId}/destination-receive`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function pickupItem(itemId: string, input: PickupItemInput): Promise<WarehouseItemDetail> {
  return apiFetch<WarehouseItemDetail>(`/warehouse/items/${itemId}/pickup`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function dispatchItem(itemId: string, input: DispatchItemInput): Promise<WarehouseItemDetail> {
  return apiFetch<WarehouseItemDetail>(`/warehouse/items/${itemId}/dispatch`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function deliverItem(itemId: string, input: DeliverItemInput): Promise<WarehouseItemDetail> {
  return apiFetch<WarehouseItemDetail>(`/warehouse/items/${itemId}/deliver`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function returnItem(itemId: string, input: ReturnItemInput): Promise<WarehouseItemDetail> {
  return apiFetch<WarehouseItemDetail>(`/warehouse/items/${itemId}/return`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function getInventory(params?: {
  warehouseId?: string;
  search?: string;
  status?: string;
}): Promise<WarehouseItemDetail[]> {
  const query = new URLSearchParams();
  if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
  if (params?.search) query.set('search', params.search);
  if (params?.status) query.set('status', params.status);
  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<WarehouseItemDetail[]>(`/warehouse/inventory${qs}`, { token: authToken() });
}

export function getRecentActivity(params?: {
  warehouseId?: string;
  limit?: number;
}): Promise<WarehouseActivityEntry[]> {
  const query = new URLSearchParams();
  if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<WarehouseActivityEntry[]>(`/warehouse/activity${qs}`, { token: authToken() });
}
