'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

interface TenantSummary {
  id: string;
  name: string;
}

/**
 * Fetches the caller's own tenant name for display in the app shells.
 * Deliberately not hardcoded — this is a multi-tenant platform, and every
 * tenant sees their own organization's name here, not Transatlantic's.
 */
export function useTenant(enabled: boolean): { tenantName: string | null } {
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const token = getStoredToken();
    if (!token) return;

    apiFetch<TenantSummary>('/tenants/me', { token })
      .then((tenant) => setTenantName(tenant.name))
      .catch(() => setTenantName(null));
  }, [enabled]);

  return { tenantName };
}
