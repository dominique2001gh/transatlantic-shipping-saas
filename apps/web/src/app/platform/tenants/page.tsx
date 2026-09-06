'use client';

import { useEffect, useState } from 'react';
import type { PlatformTenantListItem } from '@transatlantic/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { fetchPlatformTenants, reactivateTenant, suspendTenant } from '@/lib/platform';

const SUBSCRIPTION_BADGE: Record<string, 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  TRIALING: 'success',
  PAST_DUE: 'warning',
  UNPAID: 'warning',
  SUSPENDED: 'neutral',
  CANCELED: 'neutral',
};

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<PlatformTenantListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  function load() {
    fetchPlatformTenants()
      .then(setTenants)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load tenants'));
  }

  useEffect(load, []);

  async function handleToggle(tenant: PlatformTenantListItem) {
    setActingId(tenant.id);
    try {
      if (tenant.isActive) {
        await suspendTenant(tenant.id);
      } else {
        await reactivateTenant(tenant.id);
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setActingId(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Tenants</h1>
      <p className="mt-1 text-sm text-slate-500">Every logistics company running on this platform.</p>

      <Card className="mt-6 overflow-x-auto p-0">
        {error && <p role="alert" className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !tenants && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && tenants && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Plan</th>
                <th className="px-6 py-3 font-medium">Subscription</th>
                <th className="px-6 py-3 font-medium">Onboarding</th>
                <th className="px-6 py-3 font-medium">Account</th>
                <th className="px-6 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {tenant.name}
                    <span className="block text-xs font-normal text-slate-400">{tenant.slug}</span>
                  </td>
                  <td className="px-6 py-3 text-slate-500">{tenant.subscription?.planName ?? '—'}</td>
                  <td className="px-6 py-3">
                    {tenant.subscription ? (
                      <Badge variant={SUBSCRIPTION_BADGE[tenant.subscription.status] ?? 'neutral'}>{tenant.subscription.status}</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">No subscription</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-slate-500">
                    {tenant.onboardingCompleted ? <Badge variant="success">Complete</Badge> : tenant.onboardingStep ?? '—'}
                  </td>
                  <td className="px-6 py-3">
                    <Badge variant={tenant.isActive ? 'success' : 'neutral'}>{tenant.isActive ? 'Active' : 'Suspended'}</Badge>
                  </td>
                  <td className="px-6 py-3">
                    <Button
                      variant={tenant.isActive ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={actingId === tenant.id}
                      onClick={() => handleToggle(tenant)}
                    >
                      {tenant.isActive ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
