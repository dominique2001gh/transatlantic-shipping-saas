import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Quick Receive's "Send Drop-Off Link" card. Both calls are tenant-aware
 * server-side (GET/POST /tenants/me/dropoff-link*, see
 * TenantsService.getDropoffLink/sendDropoffLinkEmail's own doc comments) —
 * this file never constructs or guesses the URL itself, so it works
 * correctly for any tenant without change.
 */
export function getDropoffLink(): Promise<{ url: string }> {
  return apiFetch<{ url: string }>('/tenants/me/dropoff-link', { token: authToken() });
}

export function sendDropoffLinkEmail(email: string): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/tenants/me/dropoff-link/email', {
    method: 'POST',
    body: JSON.stringify({ email }),
    token: authToken(),
  });
}
