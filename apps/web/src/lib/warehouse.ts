import type { WarehouseActivityEntry, WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

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

export function getInventory(params?: { warehouseId?: string; search?: string }): Promise<WarehouseItemDetail[]> {
  const query = new URLSearchParams();
  if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
  if (params?.search) query.set('search', params.search);
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
