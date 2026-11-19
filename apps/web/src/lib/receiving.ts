import type { ReceivingCarrier, ReceivingRecordStatus, ReceivingRecordSummary } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface CreateReceivingRecordInput {
  customerId: string;
  warehouseId: string;
  carrier: ReceivingCarrier;
  carrierOther?: string;
  carrierTrackingNumber?: string;
  description?: string;
  quantity?: number;
  notes?: string;
  /** Re-submit with this set to true to create the record anyway after reviewing a 409's matches. */
  allowDuplicate?: boolean;
  duplicateOverrideReason?: string;
}

/** Shape of the 409 response body from ReceivingService.create's duplicate-tracking-number check — read via ApiError.details. */
export interface DuplicateReceivingErrorBody {
  message: string;
  duplicates: { id: string; internalReference: string; receivedAt: string }[];
}

export type UpdateReceivingRecordInput = Partial<
  Pick<CreateReceivingRecordInput, 'carrier' | 'carrierOther' | 'carrierTrackingNumber' | 'description' | 'quantity' | 'notes'>
>;

export function listReceivingRecords(filters?: {
  customerId?: string;
  status?: ReceivingRecordStatus;
  awaitingConsolidation?: boolean;
}): Promise<ReceivingRecordSummary[]> {
  const params = new URLSearchParams();
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.awaitingConsolidation) params.set('awaitingConsolidation', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<ReceivingRecordSummary[]>(`/receiving${qs}`, { token: authToken() });
}

export function searchReceivingRecords(query: string): Promise<ReceivingRecordSummary[]> {
  const params = new URLSearchParams({ query });
  return apiFetch<ReceivingRecordSummary[]>(`/receiving/search?${params.toString()}`, { token: authToken() });
}

export function getReceivingRecord(id: string): Promise<ReceivingRecordSummary> {
  return apiFetch<ReceivingRecordSummary>(`/receiving/${id}`, { token: authToken() });
}

export function createReceivingRecord(input: CreateReceivingRecordInput): Promise<ReceivingRecordSummary> {
  return apiFetch<ReceivingRecordSummary>('/receiving', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function updateReceivingRecord(id: string, input: UpdateReceivingRecordInput): Promise<ReceivingRecordSummary> {
  return apiFetch<ReceivingRecordSummary>(`/receiving/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function cancelReceivingRecord(id: string, reason?: string): Promise<ReceivingRecordSummary> {
  return apiFetch<ReceivingRecordSummary>(`/receiving/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    token: authToken(),
  });
}

export function uploadReceivingPhoto(id: string, file: File): Promise<ReceivingRecordSummary> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'PHOTO');
  return apiFetch<ReceivingRecordSummary>(`/receiving/${id}/photo`, {
    method: 'POST',
    body: formData,
    token: authToken(),
  });
}
