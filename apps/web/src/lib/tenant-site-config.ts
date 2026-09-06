import type { UpdateSiteConfigRequest } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

/**
 * AnanseLogix Phase 2: the authenticated tenant-owner side of Section 15's
 * site-config — NOT to be confused with lib/site-config.ts, which is Trans
 * Atlantic's own hardcoded public-site content and is untouched by this.
 * See apps/api/src/site-config/site-config.service.ts's own doc comment
 * for the full scope (data management only, no renderer yet).
 */
export function getTenantSiteConfig(): Promise<UpdateSiteConfigRequest> {
  const token = getStoredToken();
  return apiFetch<UpdateSiteConfigRequest>('/site-config', { token: token ?? undefined });
}

export function updateTenantSiteConfig(input: UpdateSiteConfigRequest): Promise<{ success: true }> {
  const token = getStoredToken();
  return apiFetch<{ success: true }>('/site-config', {
    method: 'PATCH',
    body: JSON.stringify(input),
    token: token ?? undefined,
  });
}
