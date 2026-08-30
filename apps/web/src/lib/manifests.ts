import type { ManifestDetail, ShipmentMode } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface CreateManifestInput {
  shipmentMode: ShipmentMode;
  originWarehouseId?: string;
  originLocation?: string;
  destinationLocation?: string;
  carrierName?: string;
  vesselName?: string;
  voyageNumber?: string;
  flightNumber?: string;
  plannedDepartureAt?: string;
  estimatedArrivalAt?: string;
}

export interface AssignItemInput {
  scanned: boolean;
  scanIdentifier?: string;
  notes?: string;
}

export function listManifests(params?: { status?: string; shipmentMode?: string }): Promise<ManifestDetail[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.shipmentMode) query.set('shipmentMode', params.shipmentMode);
  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<ManifestDetail[]>(`/manifests${qs}`, { token: authToken() });
}

export function getManifest(id: string): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>(`/manifests/${id}`, { token: authToken() });
}

export function createManifest(input: CreateManifestInput): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>('/manifests', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function assignContainerToManifest(
  manifestId: string,
  containerId: string,
  notes?: string,
): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>(`/manifests/${manifestId}/containers/${containerId}`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
    token: authToken(),
  });
}

export function unassignContainerFromManifest(
  manifestId: string,
  containerId: string,
  reason?: string,
): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>(`/manifests/${manifestId}/containers/${containerId}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
    token: authToken(),
  });
}

export function assignItemToManifest(manifestId: string, itemId: string, input: AssignItemInput): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>(`/manifests/${manifestId}/items/${itemId}`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function unassignItemFromManifest(manifestId: string, itemId: string, reason?: string): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>(`/manifests/${manifestId}/items/${itemId}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
    token: authToken(),
  });
}

export function finalizeManifest(manifestId: string): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>(`/manifests/${manifestId}/finalize`, {
    method: 'POST',
    token: authToken(),
  });
}

export function departManifest(manifestId: string): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>(`/manifests/${manifestId}/depart`, {
    method: 'POST',
    token: authToken(),
  });
}

export function arriveManifest(manifestId: string): Promise<ManifestDetail> {
  return apiFetch<ManifestDetail>(`/manifests/${manifestId}/arrive`, {
    method: 'POST',
    token: authToken(),
  });
}
