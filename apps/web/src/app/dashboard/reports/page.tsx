'use client';

import { useEffect, useState } from 'react';
import type {
  AnalyticsAlertsResponse,
  AnalyticsCustomersResponse,
  AnalyticsDestinationsResponse,
  AnalyticsExceptionsResponse,
  AnalyticsOperationsResponse,
  AnalyticsRevenueResponse,
  CurrencyAmount,
  ShipmentMode,
  WarehouseSummary,
} from '@transatlantic/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import { SelectInput } from '@/components/forms/FormField';
import { humanizeEnumValue } from '@/lib/format';
import {
  getAnalyticsAlerts,
  getAnalyticsCustomers,
  getAnalyticsDestinations,
  getAnalyticsExceptions,
  getAnalyticsOperations,
  getAnalyticsRevenue,
} from '@/lib/analytics';
import { listWarehouseLocations } from '@/lib/warehouse';

// ---------------------------------------------------------------------------
// Date-range presets
// ---------------------------------------------------------------------------

type PresetKey = 'today' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom';

const PRESET_LABELS: Record<PresetKey, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  thisQuarter: 'This Quarter',
  thisYear: 'This Year',
  custom: 'Custom range',
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeRange(preset: PresetKey): { from: string; to: string } {
  const now = new Date();
  const end = isoDate(now);
  switch (preset) {
    case 'today':
      return { from: end, to: end };
    case '7d':
      return { from: isoDate(new Date(now.getTime() - 7 * 86400000)), to: end };
    case 'thisMonth':
      return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: end };
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: isoDate(first), to: isoDate(last) };
    }
    case 'thisQuarter': {
      const q = Math.floor(now.getMonth() / 3);
      return { from: isoDate(new Date(now.getFullYear(), q * 3, 1)), to: end };
    }
    case 'thisYear':
      return { from: isoDate(new Date(now.getFullYear(), 0, 1)), to: end };
    case '30d':
    default:
      return { from: isoDate(new Date(now.getTime() - 30 * 86400000)), to: end };
  }
}

/** Amounts joined for display — e.g. "$1,234.50" or "$1,234.50 + GH₵500.00" when a tenant genuinely has more than one currency in play. Never summed into one number across currencies. */
function formatAmounts(amounts: CurrencyAmount[]): string {
  if (amounts.length === 0) return '—';
  return amounts.map((a) => formatCurrencyAmount(a)).join(' + ');
}

function formatCurrencyAmount({ currency, amount }: CurrencyAmount): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${amount}`;
  }
}

const CHART_COLORS = ['var(--color-primary-700)', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#64748b', '#be185d'];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const [preset, setPreset] = useState<PresetKey>('30d');
  const [range, setRange] = useState(() => computeRange('30d'));
  const [shipmentMode, setShipmentMode] = useState<ShipmentMode | ''>('');
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);

  const [alerts, setAlerts] = useState<AnalyticsAlertsResponse | null>(null);
  const [revenue, setRevenue] = useState<AnalyticsRevenueResponse | null>(null);
  const [operations, setOperations] = useState<AnalyticsOperationsResponse | null>(null);
  const [destinations, setDestinations] = useState<AnalyticsDestinationsResponse | null>(null);
  const [customers, setCustomers] = useState<AnalyticsCustomersResponse | null>(null);
  const [exceptions, setExceptions] = useState<AnalyticsExceptionsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    listWarehouseLocations()
      .then(setWarehouses)
      .catch(() => undefined); // filter dropdown just stays empty — not fatal to the rest of the page
  }, []);

  useEffect(() => {
    const query = { from: range.from, to: range.to, ...(shipmentMode ? { shipmentMode } : {}), ...(warehouseId ? { warehouseId } : {}) };
    setError(false);
    Promise.all([
      getAnalyticsAlerts(),
      getAnalyticsRevenue(query),
      getAnalyticsOperations(query),
      getAnalyticsDestinations(query),
      getAnalyticsCustomers(query),
      getAnalyticsExceptions(query),
    ])
      .then(([alertsRes, revenueRes, operationsRes, destinationsRes, customersRes, exceptionsRes]) => {
        setAlerts(alertsRes);
        setRevenue(revenueRes);
        setOperations(operationsRes);
        setDestinations(destinationsRes);
        setCustomers(customersRes);
        setExceptions(exceptionsRes);
      })
      .catch(() => setError(true));
  }, [range.from, range.to, shipmentMode, warehouseId]);

  function handlePresetChange(next: PresetKey) {
    setPreset(next);
    if (next !== 'custom') setRange(computeRange(next));
  }

  const loading = !error && (!alerts || !revenue || !operations || !destinations || !customers || !exceptions);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">Operational and financial reporting across your tenant.</p>
      </div>

      {/* Global date range + filters */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="preset" className="block text-sm font-medium text-slate-700">
              Date range
            </label>
            <select
              id="preset"
              value={preset}
              onChange={(e) => handlePresetChange(e.target.value as PresetKey)}
              className="mt-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {(Object.keys(PRESET_LABELS) as PresetKey[]).map((key) => (
                <option key={key} value={key}>
                  {PRESET_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          {preset === 'custom' && (
            <>
              <div>
                <label htmlFor="from" className="block text-sm font-medium text-slate-700">
                  From
                </label>
                <input
                  id="from"
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  className="mt-1.5 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label htmlFor="to" className="block text-sm font-medium text-slate-700">
                  To
                </label>
                <input
                  id="to"
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  className="mt-1.5 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </>
          )}
          <SelectInput
            label="Shipment Mode"
            id="shipmentMode"
            value={shipmentMode}
            onChange={(e) => setShipmentMode(e.target.value as ShipmentMode | '')}
            className="w-auto"
          >
            <option value="">All modes</option>
            <option value="AIR">Air</option>
            <option value="OCEAN_LCL">Ocean LCL</option>
            <option value="OCEAN_FCL">Ocean FCL</option>
            <option value="RORO">RoRo</option>
          </SelectInput>
          <SelectInput
            label="Warehouse"
            id="warehouseId"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-auto"
          >
            <option value="">All warehouses</option>
            {warehouses.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {wh.name}
              </option>
            ))}
          </SelectInput>
        </div>
      </Card>

      {error && (
        <Card>
          <p className="text-sm text-red-600">
            We couldn&apos;t load your reports right now. Please refresh the page, or contact support if this keeps
            happening.
          </p>
        </Card>
      )}

      {!error && loading && (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      {!error && !loading && (
        <>
          <AlertsStrip alerts={alerts!} />
          <RevenueSection data={revenue!} />
          <OperationsSection data={operations!} />
          <DestinationsSection data={destinations!} />
          <CustomersSection data={customers!} />
          <ExceptionsSection data={exceptions!} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small display building blocks
// ---------------------------------------------------------------------------

function KpiTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </Card>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function AlertsStrip({ alerts }: { alerts: AnalyticsAlertsResponse }) {
  const items: string[] = [];
  if (alerts.overdueInvoices.count > 0) {
    items.push(
      `${alerts.overdueInvoices.count} invoice${alerts.overdueInvoices.count === 1 ? '' : 's'} overdue (${formatAmounts(alerts.overdueInvoices.amounts)})`,
    );
  }
  if (alerts.staleExceptions.count > 0) {
    items.push(
      `${alerts.staleExceptions.count} open exception${alerts.staleExceptions.count === 1 ? '' : 's'} unresolved > ${alerts.staleExceptions.staleThresholdDays} days`,
    );
  }
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((text) => (
        <div key={text} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800">
          <span aria-hidden="true">⚠</span>
          {text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue & Payments
// ---------------------------------------------------------------------------

function RevenueSection({ data }: { data: AnalyticsRevenueResponse }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title="Revenue & Payments" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile label="Total Revenue" value={formatAmounts(data.totalRevenue)} />
        <KpiTile label="Outstanding Balance" value={formatAmounts(data.outstandingBalance)} />
        <KpiTile label="Avg Invoice Value" value={formatAmounts(data.avgInvoiceValue)} />
      </div>

      <Card>
        <h3 className="text-sm font-semibold text-slate-900">Revenue trend</h3>
        {data.revenueTrend.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No revenue in this range.</p>
        ) : (
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.revenueTrend.map((p) => ({ date: p.date, total: p.amounts.reduce((sum, a) => sum + Number(a.amount), 0) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="total" stroke="var(--color-primary-700)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {data.revenueTrend.some((p) => p.amounts.length > 1) && (
          <p className="mt-2 text-xs text-slate-400">
            Chart sums all currencies present per day for trend shape only — see the currency-separated totals above for exact figures.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold text-slate-900">Revenue by payment method</h3>
          <ul className="mt-3 divide-y divide-slate-100">
            {data.revenueByMethod.map((row) => (
              <li key={row.method} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-600">{humanizeEnumValue(row.method)}</span>
                <span className="font-medium text-slate-900">{formatAmounts(row.amounts)}</span>
              </li>
            ))}
            {data.revenueByMethod.length === 0 && <li className="py-2 text-sm text-slate-500">No payments in this range.</li>}
          </ul>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-slate-900">Revenue by source</h3>
          <ul className="mt-3 divide-y divide-slate-100">
            {data.revenueBySource.map((row) => (
              <li key={row.source} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-600">{row.source === 'ONLINE' ? 'Online (Stripe)' : 'Recorded by staff'}</span>
                <span className="font-medium text-slate-900">{formatAmounts(row.amounts)}</span>
              </li>
            ))}
            {data.revenueBySource.length === 0 && <li className="py-2 text-sm text-slate-500">No payments in this range.</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <h3 className="text-sm font-semibold text-slate-900">Outstanding invoice aging</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Age</th>
                <th className="py-2 pr-4 font-medium">Invoices</th>
                <th className="py-2 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.outstandingAging.map((bucket) => (
                <tr key={bucket.bucket}>
                  <td className="py-2 pr-4 text-slate-700">{bucket.bucket === 'current' ? 'Not yet due' : `${bucket.bucket} days overdue`}</td>
                  <td className="py-2 pr-4 text-slate-500">{bucket.count}</td>
                  <td className="py-2 font-medium text-slate-900">{formatAmounts(bucket.amounts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Operations (Shipments, Warehouse, Containers)
// ---------------------------------------------------------------------------

function OperationsSection({ data }: { data: AnalyticsOperationsResponse }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title="Shipments & Operations" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Total Shipments" value={data.totalShipments} />
        <KpiTile label="Active" value={data.activeShipments} />
        <KpiTile label="Completed" value={data.completedShipments} />
        <KpiTile label="Cancelled" value={data.cancelledShipments} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold text-slate-900">Shipment volume trend</h3>
          {data.shipmentVolumeTrend.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No shipments in this range.</p>
          ) : (
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.shipmentVolumeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="var(--color-primary-700)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-slate-900">Air vs Ocean/RoRo mix</h3>
          {data.shipmentModeMix.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No shipments in this range.</p>
          ) : (
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.shipmentModeMix} dataKey="count" nameKey="mode" outerRadius={80} label={(entry) => humanizeEnumValue(entry.mode as string)}>
                    {data.shipmentModeMix.map((entry, i) => (
                      <Cell key={entry.mode} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend formatter={(value: string) => humanizeEnumValue(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-900">Warehouse throughput</h3>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Warehouse</th>
              <th className="py-2 pr-4 font-medium">Received</th>
              <th className="py-2 pr-4 font-medium">Processed</th>
              <th className="py-2 pr-4 font-medium">Dispatched</th>
              <th className="py-2 font-medium">Avg time in warehouse</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.warehouseThroughput.map((wh) => (
              <tr key={wh.warehouseId}>
                <td className="py-2 pr-4 text-slate-900">{wh.warehouseName}</td>
                <td className="py-2 pr-4 text-slate-500">{wh.received}</td>
                <td className="py-2 pr-4 text-slate-500">{wh.processed}</td>
                <td className="py-2 pr-4 text-slate-500">{wh.dispatched}</td>
                <td className="py-2 text-slate-500">{wh.avgTimeInWarehouseHours !== null ? `${wh.avgTimeInWarehouseHours} hrs` : '—'}</td>
              </tr>
            ))}
            {data.warehouseThroughput.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-slate-500">
                  No active warehouses.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold text-slate-900">Containers by status</h3>
          {data.containerStatusBreakdown.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No containers yet.</p>
          ) : (
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.containerStatusBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} tickFormatter={(v) => humanizeEnumValue(v)} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip labelFormatter={(label) => humanizeEnumValue(label as string)} />
                  <Bar dataKey="count" fill="var(--color-primary-700)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="overflow-x-auto">
          <h3 className="text-sm font-semibold text-slate-900">Container loading levels</h3>
          <p className="mt-0.5 text-xs text-slate-400">Item count loaded — not a % of volumetric capacity (not tracked in this system).</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Container</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Items loaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.containerLoadingLevels.map((c) => (
                <tr key={c.containerId}>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-900">{c.containerNumber}</td>
                  <td className="py-2 pr-4 text-slate-500">{humanizeEnumValue(c.status)}</td>
                  <td className="py-2 text-slate-900">{c.itemsLoaded}</td>
                </tr>
              ))}
              {data.containerLoadingLevels.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-3 text-center text-slate-500">
                    No containers currently loaded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Destinations & Delivery
// ---------------------------------------------------------------------------

function DestinationsSection({ data }: { data: AnalyticsDestinationsResponse }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title="Destinations & Delivery" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiTile label="Delivery Success Rate" value={data.deliverySuccessRate !== null ? `${data.deliverySuccessRate}%` : '—'} />
        <KpiTile label="Avg Transit Time" value={data.avgTransitDays !== null ? `${data.avgTransitDays} days` : '—'} />
      </div>

      <Card className="overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-900">Top destinations</h3>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Origin</th>
              <th className="py-2 pr-4 font-medium">Destination</th>
              <th className="py-2 pr-4 font-medium">Shipments</th>
              <th className="py-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.topDestinations.map((d) => (
              <tr key={`${d.originCountry}-${d.destinationCountry}`}>
                <td className="py-2 pr-4 text-slate-500">{d.originCountry}</td>
                <td className="py-2 pr-4 text-slate-900">{d.destinationCountry}</td>
                <td className="py-2 pr-4 text-slate-500">{d.shipmentCount}</td>
                <td className="py-2 font-medium text-slate-900">{formatAmounts(d.revenue)}</td>
              </tr>
            ))}
            {data.topDestinations.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-slate-500">
                  No shipments in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-900">Route performance (actual vs. estimated transit)</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Only covers shipments a staff member manually assigned a route to — &quot;Unassigned Route&quot; below is everything else, shown honestly rather than excluded.
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Route</th>
              <th className="py-2 pr-4 font-medium">Shipments</th>
              <th className="py-2 pr-4 font-medium">Avg Actual Transit</th>
              <th className="py-2 font-medium">Estimated Transit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.routePerformance.map((r) => (
              <tr key={r.routeId ?? 'unassigned'}>
                <td className="py-2 pr-4 text-slate-900">{r.routeName ?? 'Unassigned Route'}</td>
                <td className="py-2 pr-4 text-slate-500">{r.shipmentCount}</td>
                <td className="py-2 pr-4 text-slate-500">{r.avgActualTransitDays !== null ? `${r.avgActualTransitDays} days` : '—'}</td>
                <td className="py-2 text-slate-500">{r.estimatedTransitDays !== null ? `${r.estimatedTransitDays} days` : '—'}</td>
              </tr>
            ))}
            {data.routePerformance.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-slate-500">
                  No completed transit legs in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

function CustomersSection({ data }: { data: AnalyticsCustomersResponse }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title="Customers" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile label="New Customers" value={data.newCustomers} />
        <KpiTile label="Active" value={data.activeCustomers} />
        <KpiTile label="Dormant" value={data.dormantCustomers} />
      </div>

      <Card>
        <h3 className="text-sm font-semibold text-slate-900">Customer growth</h3>
        {data.growthTrend.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No new customers in this range.</p>
        ) : (
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.growthTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="cumulativeCustomers" name="Total customers" stroke="var(--color-primary-700)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-900">Top 10 customers</h3>
        <p className="mt-0.5 text-xs text-slate-400">Ranked by shipment count — revenue is shown per currency and can&apos;t be safely collapsed into one cross-currency sort.</p>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Customer</th>
              <th className="py-2 pr-4 font-medium">Shipments</th>
              <th className="py-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.topCustomers.map((c) => (
              <tr key={c.customerId}>
                <td className="py-2 pr-4 text-slate-900">
                  {c.customerName} <span className="font-mono text-xs text-slate-400">{c.customerNumber}</span>
                </td>
                <td className="py-2 pr-4 text-slate-500">{c.shipmentCount}</td>
                <td className="py-2 font-medium text-slate-900">{formatAmounts(c.revenue)}</td>
              </tr>
            ))}
            {data.topCustomers.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-center text-slate-500">
                  No customer activity in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Exceptions & Delays
// ---------------------------------------------------------------------------

function ExceptionsSection({ data }: { data: AnalyticsExceptionsResponse }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title="Exceptions & Delays" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiTile label="Open Exceptions" value={data.openExceptions} />
        <KpiTile label="Avg Resolution Time" value={data.avgResolutionHours !== null ? `${data.avgResolutionHours} hrs` : '—'} />
      </div>

      <Card className="overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-900">Exceptions by type</h3>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium">Open</th>
              <th className="py-2 font-medium">Resolved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.exceptionsByType.map((row) => (
              <tr key={row.type}>
                <td className="py-2 pr-4 text-slate-900">{humanizeEnumValue(row.type)}</td>
                <td className="py-2 pr-4 text-slate-500">{row.open}</td>
                <td className="py-2 text-slate-500">{row.resolved}</td>
              </tr>
            ))}
            {data.exceptionsByType.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-center text-slate-500">
                  No exceptions in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
