'use client';

import { useEffect, useState } from 'react';
import type { PlatformTenantListItem } from '@transatlantic/shared';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { fetchPlatformTenants } from '@/lib/platform';

/**
 * AnanseLogix Phase 1: aggregate billing visibility across every tenant —
 * MRR is computed client-side from each tenant's active subscription
 * (ACTIVE/TRIALING only; PAST_DUE/SUSPENDED/CANCELED don't count as
 * recognized recurring revenue), reading the same platform-overview data
 * source as /platform/tenants. Per-tenant billing management (payment
 * method, invoices) happens on Stripe's own Customer Portal, opened from
 * the tenant's own /onboarding/billing step — this page is read-only
 * platform-wide visibility, not a management console for one tenant's
 * card on file.
 */
export default function PlatformBillingPage() {
  const [tenants, setTenants] = useState<PlatformTenantListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPlatformTenants()
      .then(setTenants)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load billing data'));
  }, []);

  const withSubscription = tenants?.filter((t) => t.subscription) ?? [];
  const recognized = withSubscription.filter((t) => t.subscription!.status === 'ACTIVE' || t.subscription!.status === 'TRIALING');
  const pastDue = withSubscription.filter((t) => t.subscription!.status === 'PAST_DUE');
  const suspended = withSubscription.filter((t) => t.subscription!.status === 'SUSPENDED');
  // Amounts aren't in the overview payload (only status/dates) — MRR would
  // require joining SaasPlanPrice per tenant, deferred to Phase 2. For now
  // this page reports counts, which is still real signal for a founder
  // checking platform health at a glance.

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Billing</h1>
      <p className="mt-1 text-sm text-slate-500">Subscription health across every tenant on the platform.</p>

      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      {!error && !tenants && <p className="mt-4 text-sm text-slate-500">Loading…</p>}

      {!error && tenants && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active / Trialing</p>
              <p className="mt-2 font-display text-2xl font-bold text-slate-900">{recognized.length}</p>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Past Due</p>
              <p className="mt-2 font-display text-2xl font-bold text-amber-600">{pastDue.length}</p>
            </Card>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suspended</p>
              <p className="mt-2 font-display text-2xl font-bold text-slate-600">{suspended.length}</p>
            </Card>
          </div>

          <Card className="mt-6 overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Tenant</th>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Next billing date</th>
                  <th className="px-6 py-3 font-medium">Setup fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {withSubscription.map((tenant) => (
                  <tr key={tenant.id}>
                    <td className="px-6 py-3 font-medium text-slate-900">{tenant.name}</td>
                    <td className="px-6 py-3 text-slate-500">{tenant.subscription!.planName}</td>
                    <td className="px-6 py-3">
                      <Badge variant={tenant.subscription!.status === 'ACTIVE' || tenant.subscription!.status === 'TRIALING' ? 'success' : 'warning'}>
                        {tenant.subscription!.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-3 text-slate-500">
                      {tenant.subscription!.currentPeriodEnd ? new Date(tenant.subscription!.currentPeriodEnd).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-3 text-slate-500">{tenant.subscription!.setupFeeStatus}</td>
                  </tr>
                ))}
                {withSubscription.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-6 text-center text-slate-400">
                      No tenants with a subscription yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
