import type { PaymentListItem, PaymentMethod, PaymentStatus, PaymentSummary } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface RecordPaymentInput {
  amount: number;
  method: PaymentMethod;
  referenceNumber?: string;
  paidAt?: string;
  notes?: string;
}

export function listPaymentsForInvoice(invoiceId: string): Promise<PaymentSummary[]> {
  return apiFetch<PaymentSummary[]>(`/invoices/${invoiceId}/payments`, { token: authToken() });
}

export function recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<PaymentSummary> {
  return apiFetch<PaymentSummary>(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function listPayments(filters?: {
  invoiceId?: string;
  customerId?: string;
  status?: PaymentStatus;
}): Promise<PaymentListItem[]> {
  const params = new URLSearchParams();
  if (filters?.invoiceId) params.set('invoiceId', filters.invoiceId);
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<PaymentListItem[]>(`/payments${qs}`, { token: authToken() });
}
