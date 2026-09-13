'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

interface OwnTenantSubscriptionSummary {
  status: string;
  trialEndsAt: string | null;
  planName: string;
  setupFeeStatus: string;
}

interface TenantSummary {
  id: string;
  name: string;
  currency: string;
  subscription: OwnTenantSubscriptionSummary | null;
  /**
   * Forward-compatible only — there is no Tenant.faviconUrl column yet
   * (see Tenant model's phased-field convention, e.g. logoUrl/tagline),
   * so GET /tenants/me never actually sends this today and every tenant,
   * including Titanic, is always undefined here. It's declared now so
   * that once such a column exists and is threaded through that endpoint,
   * DashboardLayout's favicon effect below picks it up immediately with
   * no other code change required — the architecture already allows a
   * tenant's own custom favicon, it's just never hardcoded to any one
   * tenant, and nothing currently populates it.
   */
  faviconUrl?: string | null;
}

/**
 * Fetches the caller's own tenant name (and currency, Stage 3D — used to
 * default the invoice-creation form's currency field) for display in the
 * app shells. Deliberately not hardcoded — this is a multi-tenant
 * platform, and every tenant sees their own organization's name/currency
 * here, not Transatlantic's.
 *
 * Free Trial stage: also surfaces a minimal subscription summary
 * (status/trialEndsAt/planName) — this endpoint (GET /tenants/me) is
 * reachable by any authenticated role, even a suspended tenant, so the
 * persistent trial banner (AppShell) can render for everyone without a
 * separate ONBOARDING_ROLES-gated call.
 */
export function useTenant(enabled: boolean): {
  tenantName: string | null;
  tenantCurrency: string | null;
  subscription: OwnTenantSubscriptionSummary | null;
  tenantFaviconUrl: string | null;
} {
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantCurrency, setTenantCurrency] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<OwnTenantSubscriptionSummary | null>(null);
  const [tenantFaviconUrl, setTenantFaviconUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const token = getStoredToken();
    if (!token) return;

    apiFetch<TenantSummary>('/tenants/me', { token })
      .then((tenant) => {
        setTenantName(tenant.name);
        setTenantCurrency(tenant.currency);
        setSubscription(tenant.subscription);
        setTenantFaviconUrl(tenant.faviconUrl ?? null);
      })
      .catch(() => {
        setTenantName(null);
        setTenantCurrency(null);
        setSubscription(null);
        setTenantFaviconUrl(null);
      });
  }, [enabled]);

  return { tenantName, tenantCurrency, subscription, tenantFaviconUrl };
}
