import type { PortalDocumentSummary } from '@transatlantic/shared';
import { apiFetch, downloadAuthenticatedFile } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Stage 3G: typed client for the Customer Portal's document-viewing API
 * (/portal/documents*). Every response here is already scoped server-side
 * to the caller's own tenant + Customer record, and already excludes
 * staff-only (visibleToCustomer: false) documents — this file does no
 * filtering of its own and must never be treated as a security boundary,
 * exactly like lib/portal-invoices.ts.
 */
export function getPortalDocuments(): Promise<PortalDocumentSummary[]> {
  return apiFetch<PortalDocumentSummary[]>('/portal/documents', { token: authToken() });
}

export function downloadPortalDocument(doc: PortalDocumentSummary): Promise<void> {
  return downloadAuthenticatedFile(`/portal/documents/${doc.id}/download`, authToken(), doc.fileName);
}
