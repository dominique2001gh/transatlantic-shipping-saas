import type { CreateCheckoutSessionResponse, InvoiceSummary, PortalInvoiceDetail } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Stage 3E: typed client for the Customer Portal's invoice-viewing API
 * (/portal/invoices*). Every response here is already scoped server-side
 * to the caller's own tenant + Customer record, and already excludes
 * DRAFT invoices (see CustomerPortalService/InvoicesService.
 * findAllForCustomer/findByIdForCustomer) — this file does no filtering
 * of its own and must never be treated as a security boundary, exactly
 * like lib/portal.ts's existing shipment functions.
 */
export function getPortalInvoices(): Promise<InvoiceSummary[]> {
  return apiFetch<InvoiceSummary[]>('/portal/invoices', { token: authToken() });
}

export function getPortalInvoiceDetail(id: string): Promise<PortalInvoiceDetail> {
  return apiFetch<PortalInvoiceDetail>(`/portal/invoices/${encodeURIComponent(id)}`, { token: authToken() });
}

/**
 * Stage 3F: starts a Stripe-hosted Checkout for this invoice's current
 * balance. The only thing the caller should do with the result is
 * redirect the browser to `url` — no card data, no Stripe.js, ever
 * touches this app's frontend. Same ownership scoping as every other
 * portal-invoices function here (server-side, not this file's concern).
 */
export function createPortalInvoiceCheckoutSession(id: string): Promise<CreateCheckoutSessionResponse> {
  return apiFetch<CreateCheckoutSessionResponse>(`/portal/invoices/${encodeURIComponent(id)}/checkout-session`, {
    method: 'POST',
    token: authToken(),
  });
}
