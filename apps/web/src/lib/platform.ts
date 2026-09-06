import type { PlatformLeadStatus, PlatformLeadSummary, PlatformTenantListItem, SaasAnalyticsResponse } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  return apiFetch<T>(path, { ...options, token: token ?? undefined });
}

/** AnanseLogix Phase 1: the extended /platform/tenants data source — see TenantsService.findAllForPlatformOverview's own doc comment. */
export function fetchPlatformTenants(): Promise<PlatformTenantListItem[]> {
  return authedFetch('/tenants/platform-overview');
}

export function suspendTenant(id: string, reason?: string): Promise<unknown> {
  return authedFetch(`/tenants/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function reactivateTenant(id: string): Promise<unknown> {
  return authedFetch(`/tenants/${id}/reactivate`, { method: 'POST' });
}

export function fetchPlatformLeads(status?: PlatformLeadStatus): Promise<PlatformLeadSummary[]> {
  return authedFetch(`/platform/leads${status ? `?status=${status}` : ''}`);
}

export function updatePlatformLeadStatus(id: string, status: PlatformLeadStatus): Promise<PlatformLeadSummary> {
  return authedFetch(`/platform/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export function fetchSaasAnalytics(): Promise<SaasAnalyticsResponse> {
  return authedFetch('/platform/saas-analytics');
}
