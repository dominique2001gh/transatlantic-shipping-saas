'use client';

import { useEffect, useState } from 'react';
import type { SaasAnalyticsResponse } from '@transatlantic/shared';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { fetchSaasAnalytics } from '@/lib/platform';

/**
 * AnanseLogix Phase 2 (Section 23): the platform-wide signup/subscription
 * funnel — see SaasAnalyticsService's own doc comment for why this is
 * derived purely from existing records (no pageview/visit tracking).
 */
export default function PlatformAnalyticsPage() {
  const [data, setData] = useState<SaasAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSaasAnalytics()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load analytics'));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">SaaS Analytics</h1>
      <p className="mt-1 text-sm text-slate-500">
        Signup funnel and subscription health across the whole platform. Website visits are not tracked here.
      </p>

      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      {!error && !data && <p className="mt-4 text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Signup Funnel</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Signups Started" value={data.signupStarts} />
            <Stat label="Checkouts Started" value={data.checkoutStarts} />
            <Stat label="Signups Completed" value={data.signupCompletions} />
            <Stat label="Demo Requests" value={data.demoRequests} />
          </div>

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Subscription Health</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Active" value={data.activeTenants} tone="success" />
            <Stat label="Trialing" value={data.trialingTenants} tone="success" />
            <Stat label="Past Due" value={data.pastDueTenants} tone="warning" />
            <Stat label="Suspended" value={data.suspendedTenants} tone="neutral" />
            <Stat label="Canceled" value={data.canceledTenants} tone="neutral" />
          </div>

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Plan Distribution</h2>
          <Card className="mt-3 overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 font-medium">Tenants</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.planDistribution.map((row) => (
                  <tr key={row.planKey}>
                    <td className="px-6 py-3 font-medium text-slate-900">{row.planName}</td>
                    <td className="px-6 py-3 text-slate-500">{row.tenantCount}</td>
                  </tr>
                ))}
                {data.planDistribution.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-6 py-6 text-center text-slate-400">
                      No subscriptions yet.
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

function Stat({ label, value, tone = 'primary' }: { label: string; value: number; tone?: 'primary' | 'success' | 'warning' | 'neutral' }) {
  const toneClass = {
    primary: 'text-slate-900',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    neutral: 'text-slate-500',
  }[tone];
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold ${toneClass}`}>{value}</p>
    </Card>
  );
}
