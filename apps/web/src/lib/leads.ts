import type { CreateWebsiteLeadRequest, UpdateWebsiteLeadStatusRequest, WebsiteLeadSummary } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/** Website Launch: public, unauthenticated — the Contact and Request-a-Quote forms both call this. No token attached; the tenant is identified by tenantSlug in the payload, the same way the public tracking lookup already works. */
export function createWebsiteLead(input: CreateWebsiteLeadRequest): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/public/leads', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Staff-facing (LEAD_MANAGE_ROLES) — GET /leads, already scoped server-side to the caller's own tenant. */
export function listLeads(filters?: { status?: string; type?: string }): Promise<WebsiteLeadSummary[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiFetch<WebsiteLeadSummary[]>(`/leads${qs ? `?${qs}` : ''}`, { token: authToken() });
}

export function updateLeadStatus(id: string, input: UpdateWebsiteLeadStatusRequest): Promise<WebsiteLeadSummary> {
  return apiFetch<WebsiteLeadSummary>(`/leads/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    token: authToken(),
  });
}
