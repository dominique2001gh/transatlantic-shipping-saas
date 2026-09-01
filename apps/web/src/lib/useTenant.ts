'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

interface TenantSummary {
  id: string;
  name: string;
  currency: string;
}

/**
 * Fetches the caller's own tenant name (and currency, Stage 3D — used to
 * default the invoice-creation form's currency field) for display in the
 * app shells. Deliberately not hardcoded — this is a multi-tenant
 * platform, and every tenant sees their own organization's name/currency
 * here, not Transatlantic's.
 */
export function useTenant(enabled: boolean): { tenantName: string | null; tenantCurrency: string | null } {
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantCurrency, setTenantCurrency] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const token = getStoredToken();
    if (!token) return;

    apiFetch<TenantSummary>('/tenants/me', { token })
      .then((tenant) => {
        setTenantName(tenant.name);
        setTenantCurrency(tenant.currency);
      })
      .catch(() => {
        setTenantName(null);
        setTenantCurrency(null);
      });
  }, [enabled]);

  return { tenantName, tenantCurrency };
}
