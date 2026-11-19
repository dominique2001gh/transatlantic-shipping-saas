import type { CustomerDetail, CustomerSummary } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface CreateCustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  /** Re-submit with this set to true to create a customer anyway after reviewing a 409 DuplicateCustomerError's matches. */
  confirmDuplicate?: boolean;
}

/** Shape of the 409 response body from CustomersService.create's duplicate-email/phone check — read via ApiError.details. */
export interface DuplicateCustomerErrorBody {
  message: string;
  duplicates: CustomerSummary[];
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export function listCustomers(search?: string, archived?: boolean): Promise<CustomerSummary[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (archived) params.set('archived', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<CustomerSummary[]>(`/customers${qs}`, { token: authToken() });
}

export function getCustomer(id: string): Promise<CustomerDetail> {
  return apiFetch<CustomerDetail>(`/customers/${id}`, { token: authToken() });
}

export function createCustomer(input: CreateCustomerInput): Promise<CustomerSummary> {
  return apiFetch<CustomerSummary>('/customers', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function updateCustomer(id: string, input: UpdateCustomerInput): Promise<CustomerSummary> {
  return apiFetch<CustomerSummary>(`/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function archiveCustomer(id: string): Promise<CustomerSummary> {
  return apiFetch<CustomerSummary>(`/customers/${id}/archive`, { method: 'POST', token: authToken() });
}

export function restoreCustomer(id: string): Promise<CustomerSummary> {
  return apiFetch<CustomerSummary>(`/customers/${id}/restore`, { method: 'POST', token: authToken() });
}

/** Shape of the 409 response body from CustomersService.remove's linked-history guard — read via ApiError.details. */
export interface CustomerDeleteGuardErrorBody {
  message: string;
  linkedCounts: { shipments: number; receivingRecords: number; invoices: number; payments: number; documents: number };
}

export function deleteCustomer(id: string): Promise<void> {
  return apiFetch<void>(`/customers/${id}`, { method: 'DELETE', token: authToken() });
}
