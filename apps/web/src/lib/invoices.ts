import type { InvoiceDetail, InvoiceStatus, InvoiceSummary } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface InvoiceItemInput {
  description: string;
  quantity?: number;
  unitPrice: number;
}

export interface CreateInvoiceInput {
  customerId: string;
  shipmentId: string;
  currency: string;
  dueDate?: string;
  tax?: number;
  items: InvoiceItemInput[];
}

export function listInvoices(filters?: {
  customerId?: string;
  shipmentId?: string;
  status?: InvoiceStatus;
}): Promise<InvoiceSummary[]> {
  const params = new URLSearchParams();
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.shipmentId) params.set('shipmentId', filters.shipmentId);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<InvoiceSummary[]>(`/invoices${qs}`, { token: authToken() });
}

export function getInvoice(id: string): Promise<InvoiceDetail> {
  return apiFetch<InvoiceDetail>(`/invoices/${id}`, { token: authToken() });
}

export function createInvoice(input: CreateInvoiceInput): Promise<InvoiceDetail> {
  return apiFetch<InvoiceDetail>('/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function issueInvoice(id: string): Promise<InvoiceDetail> {
  return apiFetch<InvoiceDetail>(`/invoices/${id}/issue`, {
    method: 'POST',
    token: authToken(),
  });
}
