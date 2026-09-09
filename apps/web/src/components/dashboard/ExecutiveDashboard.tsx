'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AnalyticsExecutiveResponse } from '@transatlantic/shared';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { IconArrowRight, IconCheckCircle } from '@/components/icons';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { getAnalyticsExecutive } from '@/lib/analytics';
import { computeRange, EXECUTIVE_PRESET_KEYS, PRESET_LABELS, type PresetKey } from '@/lib/date-range';
import { formatAmounts } from '@/lib/format';

/**
 * Owner/Manager Executive Dashboard — the richer /dashboard landing page
 * for ANALYTICS_ROLES (Owner/Admin/Manager). A compact "is everything OK"
 * snapshot backed by GET /analytics/executive, which itself only
 * reshapes the same getOverview/getAlerts/getRevenue/getOperations
 * calculations Reports already uses (see AnalyticsService.getExecutive's
 * own doc comment) — this component adds no new business logic of its
 * own, only presentation. Detailed breakdowns/charts stay on
 * /dashboard/reports; this page is deliberately shallow, by design —
 * "understand the business in ~10 seconds," not a second Reports.
 *
 * Every tile is tagged "Current" (live state, not bounded by the
 * selector below) or with the selected period's own label — never left
 * ambiguous — matching the same two time semantics AnalyticsService
 * already documents for this endpoint.
 */
export function ExecutiveDashboard() {
  const [preset, setPreset] = useState<PresetKey>('today');
  const [data, setData] = useState<AnalyticsExecutiveResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const range = computeRange(preset);
    setError(false);
    setData(null);
    getAnalyticsExecutive(range)
      .then(setData)
      .catch(() => setError(true));
  }, [preset]);

  const periodLabel = PRESET_LABELS[preset];
  const loading = !error && !data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Executive Overview</h1>
          <p className="mt-1 text-sm text-slate-500">A snapshot of your business — current state plus {periodLabel.toLowerCase()}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {EXECUTIVE_PRESET_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPreset(key)}
                className={`px-3.5 py-2 text-sm font-medium transition-colors ${
                  preset === key ? 'bg-primary-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {PRESET_LABELS[key]}
              </button>
            ))}
          </div>
          <LinkButton href="/dashboard/reports" variant="secondary" size="sm">
            View Detailed Reports
            <IconArrowRight className="h-4 w-4" />
          </LinkButton>
        </div>
      </div>

      {error && (
        <Card>
          <p className="text-sm text-red-600">
            We couldn&apos;t load your dashboard right now. Please refresh the page, or contact support if this keeps
            happening.
          </p>
        </Card>
      )}

      {loading && (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* Financial */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ExecutiveTile href="/dashboard/reports" label="Revenue" value={formatAmounts(data.revenue)} sublabel={periodLabel} />
            <ExecutiveTile href="/dashboard/invoices" label="Outstanding Balance" value={formatAmounts(data.outstandingBalance)} sublabel="Current" />
            <ExecutiveTile href="/dashboard/invoices" label="Open Invoices" value={data.openInvoices} sublabel="Current" />
          </section>

          {/* Operations */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <ExecutiveTile href="/dashboard/shipments" label="Active Shipments" value={data.activeShipments} sublabel="Current" />
            <ExecutiveTile href="/dashboard/warehouse" label="Items Received" value={data.warehouseActivity.received} sublabel={periodLabel} />
            <ExecutiveTile href="/dashboard/containers" label="Containers In Transit" value={data.containerMovement.inTransit} sublabel="Current" />
            <ExecutiveTile href="/dashboard/shipments" label="Completed Shipments" value={data.completedShipments} sublabel={periodLabel} />
          </section>

          {/* Requires Attention */}
          <AttentionSection data={data} />

          {/* Operational snapshot + container movement */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Warehouse activity</h3>
              <p className="mt-0.5 text-xs text-slate-400">{periodLabel} — see Warehouse for live floor detail.</p>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <SnapshotStat label="Received" value={data.warehouseActivity.received} />
                <SnapshotStat label="Processed / Ready" value={data.warehouseActivity.processed} />
                <SnapshotStat label="Loaded" value={data.warehouseActivity.loaded} />
                <SnapshotStat label="Destination Received" value={data.warehouseActivity.destinationReceived} />
                <SnapshotStat label="Delivered / Picked Up" value={data.warehouseActivity.deliveredOrPickedUp} />
              </dl>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Container &amp; shipment movement</h3>
              <p className="mt-0.5 text-xs text-slate-400">Current status — see Containers for full detail.</p>
              <dl className="mt-4 grid grid-cols-3 gap-4">
                <SnapshotStat label="Loading / Loaded" value={data.containerMovement.loadingOrLoaded} />
                <SnapshotStat label="In Transit" value={data.containerMovement.inTransit} />
                <SnapshotStat label="Arrived / Unloading" value={data.containerMovement.arrivedOrUnloading} />
              </dl>
            </Card>
          </div>

          {/* Trends */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Shipment activity trend</h3>
              <MiniLineChart data={data.shipmentVolumeTrend.map((p) => ({ date: p.date, value: p.count }))} />
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-slate-900">Revenue trend</h3>
              <MiniLineChart
                data={data.revenueTrend.map((p) => ({ date: p.date, value: p.amounts.reduce((sum, a) => sum + Number(a.amount), 0) }))}
              />
              {data.revenueTrend.some((p) => p.amounts.length > 1) && (
                <p className="mt-2 text-xs text-slate-400">Sums all currencies for trend shape only — see Revenue above for exact per-currency figures.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function ExecutiveTile({ href, label, value, sublabel }: { href: string; label: string; value: string | number; sublabel: string }) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-slate-500">{label}</p>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {sublabel}
          </span>
        </div>
        <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      </Card>
    </Link>
  );
}

function SnapshotStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function MiniLineChart({ data }: { data: { date: string; value: number }[] }) {
  if (data.length === 0) {
    return <p className="mt-6 text-sm text-slate-500">No activity in this period.</p>;
  }
  return (
    <div className="mt-4 h-32">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={32} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="var(--color-primary-700)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * "Requires Attention" — reuses AnalyticsAlertsResponse verbatim (the
 * `attention` field of GET /analytics/executive IS getAlerts()'s
 * response, unmodified), the same definition of "needs attention" Reports'
 * own AlertsStrip already uses. Never manufactures a new alert condition.
 * A genuinely empty state renders a positive confirmation, not an
 * alarming zero card.
 */
function AttentionSection({ data }: { data: AnalyticsExecutiveResponse }) {
  const items: { text: string; href: string }[] = [];
  if (data.attention.overdueInvoices.count > 0) {
    items.push({
      text: `${data.attention.overdueInvoices.count} invoice${data.attention.overdueInvoices.count === 1 ? '' : 's'} overdue (${formatAmounts(data.attention.overdueInvoices.amounts)})`,
      href: '/dashboard/invoices',
    });
  }
  if (data.attention.staleExceptions.count > 0) {
    items.push({
      text: `${data.attention.staleExceptions.count} open exception${data.attention.staleExceptions.count === 1 ? '' : 's'} unresolved for more than ${data.attention.staleExceptions.staleThresholdDays} days`,
      href: '/dashboard/reports',
    });
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-900">Requires Attention</h3>
      {items.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
          <IconCheckCircle className="h-5 w-5 shrink-0" />
          <span>All clear — nothing needs your attention right now.</span>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.text}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden="true">⚠</span>
                  {item.text}
                </span>
                <IconArrowRight className="h-4 w-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
