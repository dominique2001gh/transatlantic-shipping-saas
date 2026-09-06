import type { CustomerEntryPointResponse } from '@transatlantic/shared';
import { API_URL } from './api';

/**
 * One-off lookup used only by the central AnanseLogix login (see that
 * page's own doc comment) to find where a CUSTOMER-role account's
 * tenant-branded portal lives, if one is configured.
 *
 * Deliberately bypasses apiFetch: that helper treats any 401 on a
 * token-bearing request as "this browser's stored session is dead" and
 * force-navigates to /login (Trans Atlantic's page) — exactly the wrong
 * behavior here, since this call uses a just-issued token that is never
 * stored, and /ananselogix/login must never bounce a visitor to a
 * Trans-Atlantic-branded page on its own. Any failure here (network
 * error, unexpected status) is treated the same as "not available" —
 * the caller falls back to the generic message, never an error page.
 */
export async function resolveCustomerEntryPoint(accessToken: string): Promise<CustomerEntryPointResponse | null> {
  try {
    const response = await fetch(`${API_URL}/auth/customer-entry-point`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as CustomerEntryPointResponse;
  } catch {
    return null;
  }
}
