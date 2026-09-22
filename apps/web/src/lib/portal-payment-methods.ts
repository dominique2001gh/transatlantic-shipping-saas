import type { EnabledPaymentMethod } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Tenant Payment Configuration Phase E: this tenant's manual payment
 * methods + customer-facing instructions, already scoped server-side to
 * the caller's own tenant (see CustomerPortalController.paymentMethods) —
 * this file does no filtering of its own, exactly like every other
 * lib/portal-*.ts function. Purely informational: nothing this returns,
 * or anything the invoice detail page does with it, ever changes an
 * invoice's status — only a staff Record Payment submission does that.
 */
export function getPortalPaymentMethods(): Promise<EnabledPaymentMethod[]> {
  return apiFetch<EnabledPaymentMethod[]>('/portal/payment-methods', { token: authToken() });
}
