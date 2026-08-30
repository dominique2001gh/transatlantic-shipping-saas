import type { ContainerDetail, ContainerType } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface CreateContainerInput {
  containerNumber: string;
  containerType: ContainerType;
  warehouseId?: string;
  routeId?: string;
  originPort?: string;
  destinationPort?: string;
}

export interface LoadItemInput {
  scanned: boolean;
  scanIdentifier?: string;
  notes?: string;
}

export function listContainers(params?: { status?: string; warehouseId?: string }): Promise<ContainerDetail[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<ContainerDetail[]>(`/containers${qs}`, { token: authToken() });
}

export function getContainer(id: string): Promise<ContainerDetail> {
  return apiFetch<ContainerDetail>(`/containers/${id}`, { token: authToken() });
}

export function createContainer(input: CreateContainerInput): Promise<ContainerDetail> {
  return apiFetch<ContainerDetail>('/containers', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function loadItemIntoContainer(containerId: string, itemId: string, input: LoadItemInput): Promise<ContainerDetail> {
  return apiFetch<ContainerDetail>(`/containers/${containerId}/items/${itemId}`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function unloadItemFromContainer(containerId: string, itemId: string, reason?: string): Promise<ContainerDetail> {
  return apiFetch<ContainerDetail>(`/containers/${containerId}/items/${itemId}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
    token: authToken(),
  });
}

export function finalizeContainer(containerId: string, sealNumber?: string): Promise<ContainerDetail> {
  return apiFetch<ContainerDetail>(`/containers/${containerId}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ sealNumber }),
    token: authToken(),
  });
}

export function openContainerForUnloading(containerId: string): Promise<ContainerDetail> {
  return apiFetch<ContainerDetail>(`/containers/${containerId}/open`, {
    method: 'POST',
    token: authToken(),
  });
}

export function closeContainerUnloading(containerId: string): Promise<ContainerDetail> {
  return apiFetch<ContainerDetail>(`/containers/${containerId}/close`, {
    method: 'POST',
    token: authToken(),
  });
}
