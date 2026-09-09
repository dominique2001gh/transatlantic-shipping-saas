'use client';

import { useEffect, useState } from 'react';
import type { AnalyticsOverviewResponse } from '@transatlantic/shared';
import { ANALYTICS_ROLES, DASHBOARD_ROLES } from '@transatlantic/shared';
import { ExecutiveDashboard } from '@/components/dashboard/ExecutiveDashboard';
import { Card } from '@/components/ui/Card';
import { getAnalyticsOverview } from '@/lib/analytics';
import { useRequireAuth } from '@/lib/useRequireAuth';

/**
 * Stage 4: wires the four tiles that have sat as hardcoded "—" placeholders
 * since the very first dashboard scaffold to GET /analytics/overview —
 * open to any DASHBOARD_ROLES member (no financial figures here; see
 * AnalyticsController's own doc comment for why this one endpoint is
 * deliberately not ANALYTICS_ROLES-gated like the rest of Stage 4). The
 * deeper financial/operational analytics live at /dashboard/reports.
 *
 * Executive Dashboard upgrade: ANALYTICS_ROLES (Owner/Admin/Manager) get
 * the richer <ExecutiveDashboard/> instead of these four tiles — the API
 * would 403 them out of most of that page's data anyway (its financial
 * figures require ANALYTICS_ROLES, same as /dashboard/reports), so this
 * is a UX routing choice, not the security boundary; every other staff
 * role (WAREHOUSE_STAFF, DRIVER, CUSTOMER_SERVICE, ACCOUNTANT,
 * DESTINATION_AGENT) keeps exactly this original operational-only
 * Overview, unchanged, since they were never entitled to tenant-wide
 * financial data.
 *
 * `useRequireAuth` is already called once by DashboardLayout — calling it
 * again here is cheap (localStorage read only, no network) and is the
 * same pattern DashboardLayout itself uses to read `user.role`.
 */
export default function DashboardOverviewPage() {
  const { user, loading } = useRequireAuth(DASHBOARD_ROLES);

  // Wait for the role to actually be known before picking a variant —
  // otherwise a management user would flash the plain Overview (and fire
  // its GET /analytics/overview call) for one render before switching.
  if (loading || !user) {
    return null;
  }

  if ((ANALYTICS_ROLES as string[]).includes(user.role)) {
    return <ExecutiveDashboard />;
  }

  return <PlainOverview />;
}

function PlainOverview() {
  const [overview, setOverview] = useState<AnalyticsOverviewResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getAnalyticsOverview()
      .then(setOverview)
      .catch(() => setError(true));
  }, []);

  const cards = [
    { label: 'Active Shipments', value: overview?.activeShipments },
    { label: 'Customers', value: overview?.totalCustomers },
    { label: 'Open Invoices', value: overview?.openInvoices },
    { label: 'Containers In Transit', value: overview?.containersInTransit },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
      <p className="mt-1 text-sm text-slate-500">A snapshot of your operation.</p>

      {error && (
        <Card className="mt-6">
          <p className="text-sm text-red-600">
            We couldn&apos;t load your dashboard right now. Please refresh the page, or contact support if this keeps
            happening.
          </p>
        </Card>
      )}

      {!error && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Card key={card.label}>
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                {card.value === undefined ? (
                  <span className="inline-block h-8 w-12 animate-pulse rounded bg-slate-100 align-middle" />
                ) : (
                  card.value
                )}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
