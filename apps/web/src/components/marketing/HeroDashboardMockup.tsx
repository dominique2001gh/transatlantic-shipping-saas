import {
  IconBell,
  IconBox,
  IconCheckCircle,
  IconChartBar,
  IconChevronDown,
  IconContainer,
  IconGear,
  IconHome,
  IconMail,
  IconMapPin,
  IconSearch,
  IconShip,
  IconUsers,
  IconWarehouse,
} from '@/components/icons';

/**
 * The homepage hero's right-side product visual — a compact, wide
 * "desktop application window" style AnanseLogix tenant dashboard mockup,
 * built entirely from HTML/CSS/React (no screenshot asset, no charting
 * library). Deliberately short and horizontal (approx. 16:9) so the whole
 * dashboard reads at a glance without extending past the hero fold — see
 * this component's compact paddings/heights throughout, tuned for the
 * ~60%-width right column apps/ananselogix/page.tsx's hero grid gives it.
 * Every figure here is clearly fictional demo data (round numbers,
 * placeholder reference codes, a placeholder tenant name) — never a real
 * tenant's shipments, customers, or financial figures. This is a homepage
 * illustration only; none of these controls are wired to anything real.
 */

interface NavItem {
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: IconHome },
  { label: 'Shipments', icon: IconShip },
  { label: 'Customers', icon: IconUsers },
  { label: 'Warehouse', icon: IconWarehouse },
  { label: 'Containers', icon: IconContainer },
  { label: 'Invoices', icon: IconCheckCircle },
  { label: 'Tracking', icon: IconMapPin },
  { label: 'Reports', icon: IconChartBar },
  { label: 'Documents', icon: IconBox },
  { label: 'Messages', icon: IconMail },
  { label: 'Settings', icon: IconGear },
];

interface Kpi {
  icon: (props: { className?: string }) => JSX.Element;
  iconTone: string;
  label: string;
  value: string;
  delta: string;
  deltaTone: 'up' | 'neutral';
}

const KPIS: Kpi[] = [
  { icon: IconShip, iconTone: 'bg-primary-50 text-primary-700', label: 'Active Shipments', value: '128', delta: '↑ 12% vs last mo.', deltaTone: 'up' },
  { icon: IconBox, iconTone: 'bg-emerald-50 text-emerald-700', label: 'Received Today', value: '47', delta: '↑ 32% vs yesterday', deltaTone: 'up' },
  { icon: IconContainer, iconTone: 'bg-accent-50 text-accent-700', label: 'Containers Loading', value: '3', delta: 'On schedule', deltaTone: 'neutral' },
  { icon: IconCheckCircle, iconTone: 'bg-emerald-50 text-emerald-700', label: 'Revenue This Month', value: '$84,200', delta: '↑ 18% vs last mo.', deltaTone: 'up' },
];

interface ChartPoint {
  label: string;
  ocean: number;
  air: number;
  roro: number;
}

const CHART_DATA: ChartPoint[] = [
  { label: 'Oct 1', ocean: 30, air: 15, roro: 10 },
  { label: 'Oct 10', ocean: 45, air: 20, roro: 15 },
  { label: 'Oct 15', ocean: 55, air: 25, roro: 15 },
  { label: 'Oct 20', ocean: 70, air: 30, roro: 18 },
  { label: 'Oct 25', ocean: 85, air: 35, roro: 20 },
  { label: 'Oct 30', ocean: 100, air: 45, roro: 25 },
];
const CHART_MAX = 200;
const CHART_GRIDLINES = [200, 100, 0];

interface Invoice {
  number: string;
  amount: string;
  due: string;
  status: 'Sent' | 'Paid';
}

const INVOICES: Invoice[] = [
  { number: 'INV-2026-0142', amount: '$1,250.00', due: 'due in 3 days', status: 'Sent' },
  { number: 'INV-2026-0138', amount: '$680.00', due: 'due in 9 days', status: 'Sent' },
  { number: 'INV-2026-0131', amount: '$2,100.00', due: 'paid', status: 'Paid' },
];

interface StatusSlice {
  label: string;
  count: number;
  pct: number;
  color: string;
  dot: string;
}

const TOTAL_SHIPMENTS = 128;
const STATUS_SLICES: StatusSlice[] = [
  { label: 'Delivered', count: 48, pct: 37.5, color: '#10b981', dot: 'bg-emerald-500' },
  { label: 'In Transit', count: 56, pct: 43.75, color: '#3b82f6', dot: 'bg-blue-500' },
  { label: 'Processing', count: 18, pct: 14.06, color: '#f59e0b', dot: 'bg-amber-500' },
  { label: 'Exception', count: 6, pct: 4.69, color: '#ef4444', dot: 'bg-red-500' },
];

interface ActivityItem {
  icon: (props: { className?: string }) => JSX.Element;
  iconTone: string;
  text: string;
  time: string;
}

const ACTIVITY: ActivityItem[] = [
  { icon: IconBox, iconTone: 'bg-primary-50 text-primary-700', text: 'Package TA123456 received', time: '2 min ago' },
  { icon: IconContainer, iconTone: 'bg-accent-50 text-accent-700', text: 'Container CNU7890123 departed', time: '1 hr ago' },
  { icon: IconCheckCircle, iconTone: 'bg-emerald-50 text-emerald-700', text: 'Invoice INV-2026-0131 paid', time: '3 hrs ago' },
];

function conicGradient(slices: StatusSlice[]) {
  let cursor = 0;
  const stops = slices.map((slice) => {
    const start = cursor;
    cursor += slice.pct;
    return `${slice.color} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export function HeroDashboardMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white text-slate-900 shadow-2xl">
      {/* Outer browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3.5 py-1.5">
        <span className="h-2 w-2 rounded-full bg-red-300" />
        <span className="h-2 w-2 rounded-full bg-amber-300" />
        <span className="h-2 w-2 rounded-full bg-emerald-300" />
      </div>

      {/* App top bar */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 sm:gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-700 text-white">
          <IconContainer className="h-3.5 w-3.5" />
        </span>
        <span className="hidden shrink-0 font-display text-xs font-bold text-slate-900 sm:inline">AnanseLogix</span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-slate-400">
          <IconSearch className="h-3 w-3 shrink-0" />
          <span className="truncate text-[10px]">
            <span className="hidden sm:inline">Search shipments, customers, containers…</span>
            <span className="sm:hidden">Search…</span>
          </span>
        </div>
        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400">
          <IconBell className="h-3.5 w-3.5" />
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-700 text-[9px] font-semibold text-white">
            TA
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-[10px] font-semibold text-slate-800">Trans Atlantic Logistics</span>
            <span className="block text-[9px] text-slate-400">Owner</span>
          </span>
        </div>
      </div>

      <div className="flex bg-slate-50">
        {/* Sidebar */}
        <nav aria-hidden="true" className="hidden shrink-0 flex-col gap-0.5 border-r border-slate-100 bg-white p-1.5 sm:flex md:w-11 lg:w-32 lg:p-2">
          {NAV_ITEMS.map((item, i) => (
            <span
              key={item.label}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-[10px] font-medium ${
                i === 0 ? 'bg-primary-700 text-white' : 'text-slate-500'
              }`}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden truncate lg:inline">{item.label}</span>
            </span>
          ))}
        </nav>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5 sm:p-3">
          {/* KPI cards — one row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KPIS.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${kpi.iconTone}`}>
                    <kpi.icon className="h-3 w-3" />
                  </span>
                  <p className="truncate text-[9px] font-medium uppercase tracking-wide text-slate-400">{kpi.label}</p>
                </div>
                <p className="mt-1 font-display text-base font-bold leading-none text-slate-900">{kpi.value}</p>
                <p className={`mt-1 truncate text-[9px] font-medium ${kpi.deltaTone === 'up' ? 'text-emerald-600' : 'text-accent-600'}`}>
                  {kpi.delta}
                </p>
              </div>
            ))}
          </div>

          {/* Chart + Outstanding Invoices */}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 lg:col-span-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-slate-700">Shipment Volume</p>
                <span className="flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[9px] text-slate-500">
                  Last 30 Days
                  <IconChevronDown className="h-2.5 w-2.5" />
                </span>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <div className="flex flex-col justify-between text-[8px] text-slate-300" style={{ height: '52px' }}>
                  {CHART_GRIDLINES.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
                <div className="relative flex flex-1 items-end justify-between gap-1.5 sm:gap-2" style={{ height: '52px' }}>
                  <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                    {CHART_GRIDLINES.map((line) => (
                      <span key={line} className="border-t border-slate-100" />
                    ))}
                  </div>
                  {CHART_DATA.map((point) => {
                    const total = point.ocean + point.air + point.roro;
                    return (
                      <div key={point.label} className="relative flex h-full flex-1 flex-col-reverse items-stretch">
                        <div className="rounded-t bg-blue-500" style={{ height: `${(point.ocean / CHART_MAX) * 100}%` }} />
                        <div className="bg-primary-600" style={{ height: `${(point.air / CHART_MAX) * 100}%` }} />
                        <div className="rounded-t bg-emerald-500" style={{ height: `${(point.roro / CHART_MAX) * 100}%` }} />
                        <span className="sr-only">
                          {point.label}: {total} shipments
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-1 flex justify-between pl-5 text-[8px] text-slate-400">
                {CHART_DATA.map((point) => (
                  <span key={point.label}>{point.label}</span>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[9px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Ocean
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-600" /> Air
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> RoRo
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-slate-700">Outstanding Invoices</p>
                <span className="text-[9px] font-medium text-primary-700">View all →</span>
              </div>
              <ul className="mt-1 flex flex-col divide-y divide-slate-100">
                {INVOICES.map((invoice) => (
                  <li key={invoice.number} className="flex items-center justify-between gap-2 py-1.5 first:pt-0.5 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-medium text-slate-800">{invoice.number}</p>
                      <p className="truncate text-[9px] text-slate-400">
                        {invoice.amount} · {invoice.due}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${
                        invoice.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {invoice.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Shipments by Status + Recent Activity */}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <p className="text-[10px] font-semibold text-slate-700">Shipments by Status</p>
              <div className="mt-1.5 flex items-center gap-3">
                <div
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
                  style={{ background: conicGradient(STATUS_SLICES) }}
                >
                  <div className="flex h-9 w-9 flex-col items-center justify-center rounded-full bg-white">
                    <span className="font-display text-xs font-bold leading-none text-slate-900">{TOTAL_SHIPMENTS}</span>
                    <span className="text-[7px] text-slate-400">Total</span>
                  </div>
                </div>
                <ul className="min-w-0 flex-1 space-y-1">
                  {STATUS_SLICES.map((slice) => (
                    <li key={slice.label} className="flex items-center justify-between gap-2 text-[9px] text-slate-600">
                      <span className="flex items-center gap-1.5 truncate">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${slice.dot}`} />
                        <span className="truncate">{slice.label}</span>
                      </span>
                      <span className="shrink-0 font-medium text-slate-800">
                        {slice.count} ({Math.round(slice.pct)}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-slate-700">Recent Activity</p>
                <span className="text-[9px] font-medium text-primary-700">View all →</span>
              </div>
              <ul className="mt-1 flex flex-col divide-y divide-slate-100">
                {ACTIVITY.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 py-1.5 first:pt-0.5 last:pb-0">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${item.iconTone}`}>
                      <item.icon className="h-2.5 w-2.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-slate-700">{item.text}</span>
                    <span className="shrink-0 text-[9px] text-slate-400">{item.time}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
