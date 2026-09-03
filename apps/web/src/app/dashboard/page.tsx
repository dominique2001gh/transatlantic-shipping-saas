'use client';

import { useEffect, useState } from 'react';
import type { AnalyticsOverviewResponse } from '@transatlantic/shared';
import { Card } from '@/components/ui/Card';
import { getAnalyticsOverview } from '@/lib/analytics';

/**
 * Stage 4: wires the four tiles that have sat as hardcoded "—" placeholders
 * since the very first dashboard scaffold to GET /analytics/overview —
 * open to any DASHBOARD_ROLES member (no financial figures here; see
 * AnalyticsController's own doc comment for why this one endpoint is
 * deliberately not ANALYTICS_ROLES-gated like the rest of Stage 4). The
 * deeper financial/operational analytics live at /dashboard/reports.
 */
export default function DashboardOverviewPage() {
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
