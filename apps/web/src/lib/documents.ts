import type { DocumentSummary, DocumentType } from '@transatlantic/shared';
import { apiFetch, downloadAuthenticatedFile } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface UploadDocumentInput {
  file: File;
  type: DocumentType;
  description?: string;
  visibleToCustomer?: boolean;
}

function toFormData(input: UploadDocumentInput): FormData {
  const formData = new FormData();
  formData.append('file', input.file);
  formData.append('type', input.type);
  if (input.description) formData.append('description', input.description);
  formData.append('visibleToCustomer', String(input.visibleToCustomer ?? false));
  return formData;
}

export function listDocuments(filters?: { customerId?: string; shipmentId?: string; type?: DocumentType }): Promise<DocumentSummary[]> {
  const params = new URLSearchParams();
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.shipmentId) params.set('shipmentId', filters.shipmentId);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<DocumentSummary[]>(`/documents${qs}`, { token: authToken() });
}

export function getDocument(id: string): Promise<DocumentSummary> {
  return apiFetch<DocumentSummary>(`/documents/${id}`, { token: authToken() });
}

export function uploadDocumentForShipment(shipmentId: string, input: UploadDocumentInput): Promise<DocumentSummary> {
  return apiFetch<DocumentSummary>(`/documents/shipments/${shipmentId}`, {
    method: 'POST',
    body: toFormData(input),
    token: authToken(),
  });
}

export function uploadDocumentForCustomer(customerId: string, input: UploadDocumentInput): Promise<DocumentSummary> {
  return apiFetch<DocumentSummary>(`/documents/customers/${customerId}`, {
    method: 'POST',
    body: toFormData(input),
    token: authToken(),
  });
}

export interface UpdateDocumentInput {
  type?: DocumentType;
  description?: string;
  visibleToCustomer?: boolean;
}

export function updateDocument(id: string, input: UpdateDocumentInput): Promise<DocumentSummary> {
  return apiFetch<DocumentSummary>(`/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function downloadDocument(doc: DocumentSummary): Promise<void> {
  return downloadAuthenticatedFile(`/documents/${doc.id}/download`, authToken(), doc.fileName);
}
