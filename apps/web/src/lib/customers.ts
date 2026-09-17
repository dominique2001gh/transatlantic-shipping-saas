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

export function listCustomers(search?: string): Promise<CustomerSummary[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
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
