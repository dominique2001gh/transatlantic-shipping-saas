import type { PlatformLeadCreateRequest } from '@transatlantic/shared';
import { apiFetch } from '@/lib/api';

/** The /demo page's form — a prospect wanting to become a tenant, not an existing tenant's own shipping customer (see PlatformLead's own schema doc comment). */
export function submitPlatformLead(input: PlatformLeadCreateRequest): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/public/platform-leads', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
