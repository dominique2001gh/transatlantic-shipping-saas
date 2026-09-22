import type { EnabledPaymentMethod, TenantPaymentMethodConfigItem, TenantStripeConnectStatus } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  return apiFetch<T>(path, { ...options, token: token ?? undefined });
}

/**
 * Tenant Payment Configuration Phase B: OWNER-only client for the
 * already-built Stripe Connect onboarding/status backend (see
 * TenantPaymentsController) — this file adds no new backend behavior,
 * only a typed frontend consumer for routes that previously had none.
 */
export function getStripeConnectStatus(): Promise<TenantStripeConnectStatus> {
  return authedFetch('/tenant-payments/connect/status');
}

/** Starts or resumes onboarding; the caller should redirect the browser to the returned `url` (Stripe's own hosted page), the same pattern the customer portal's "Pay Now" already uses for Checkout. */
export function createStripeOnboardingLink(): Promise<{ url: string }> {
  return authedFetch('/tenant-payments/connect/onboarding-link', { method: 'POST' });
}

/**
 * Tenant Payment Configuration Phase D: OWNER-only read/write for the
 * Settings → Payments manual-methods form. Always the full configurable
 * set (see TenantPaymentMethodsService.getConfigForTenant's own doc
 * comment on why every method is always present, even unconfigured ones).
 */
export function getPaymentMethodsConfig(): Promise<TenantPaymentMethodConfigItem[]> {
  return authedFetch('/tenant-payments/methods');
}

export function savePaymentMethodsConfig(methods: TenantPaymentMethodConfigItem[]): Promise<TenantPaymentMethodConfigItem[]> {
  return authedFetch('/tenant-payments/methods', { method: 'PUT', body: JSON.stringify({ methods }) });
}

/** Record Payment dropdown — enabled methods only, with the same legacy-fallback rule as the backend (see TenantPaymentMethodsService.getEnabledForStaff's own doc comment); accessible to INVOICE_MANAGE_ROLES, not OWNER-only. */
export function getEnabledPaymentMethodsForStaff(): Promise<EnabledPaymentMethod[]> {
  return authedFetch('/tenant-payments/methods/enabled');
}
