import type { TenantEntitlementItem } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

/** UX convenience only — EntitlementsGuard on the API is the real enforcement (see that guard's own doc comment). Lets the frontend show "not included in your plan" instead of a raw 403. */
export function fetchMyEntitlements(): Promise<TenantEntitlementItem[]> {
  const token = getStoredToken();
  return apiFetch<TenantEntitlementItem[]>('/entitlements/me', { token: token ?? undefined });
}
