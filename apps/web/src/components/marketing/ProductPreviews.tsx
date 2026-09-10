import { BrowserFrame, MiniBarChart, MockList, StatTile, type MockRow } from './BrowserFrame';

/**
 * Real AnanseLogix product UI previews for the marketing site — built from
 * this app's own design tokens, not stock photography or a screenshot
 * asset. Every figure below is clearly fictional demo data (round numbers,
 * placeholder reference codes) — never a real tenant's shipments,
 * customers, invoices, or revenue.
 */

export function OwnerDashboardPreview() {
  const activity: MockRow[] = [
    { primary: 'Container CNTR-2026-0031', secondary: 'Loading — 18 of 24 items', badge: { text: 'In progress', tone: 'amber' } },
    { primary: 'Container CNTR-2026-0028', secondary: 'Departed origin warehouse', badge: { text: 'Departed', tone: 'slate' } },
    { primary: 'Shipment TAL-2026-000119', secondary: 'Flagged: damaged on receipt', badge: { text: 'Exception', tone: 'red' } },
    { primary: 'Payment received — Customer #1042', secondary: '$450.00 via online checkout', badge: { text: 'Paid', tone: 'emerald' } },
  ];
  return (
    <BrowserFrame url="app.ananselogix.com/dashboard">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Received Today" value="47" tone="accent" />
        <StatTile label="Containers Loading" value="3" />
        <StatTile label="Departed This Week" value="5" tone="primary" />
        <StatTile label="Open Exceptions" value="2" />
      </div>
      <div className="mt-3">
        <MockList label="Today's Activity" rows={activity} />
      </div>
    </BrowserFrame>
  );
}

export function ContainerManifestPreview() {
  return (
    <BrowserFrame url="app.ananselogix.com/dashboard/containers">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MockList
          label="Containers"
          rows={[
            { primary: 'CNTR-2026-0031', secondary: 'Ocean · 18/24 items loaded', badge: { text: 'Loading', tone: 'amber' } },
            { primary: 'CNTR-2026-0028', secondary: 'Ocean · 32 items · sealed', badge: { text: 'Departed', tone: 'slate' } },
            { primary: 'CNTR-2026-0025', secondary: 'Air · 11 items', badge: { text: 'Arrived', tone: 'emerald' } },
          ]}
        />
        <MockList
          label="Manifest MAN-2026-0014"
          rows={[
            { primary: 'Origin', secondary: 'Houston, TX warehouse', badge: { text: 'Finalized', tone: 'emerald' } },
            { primary: 'Destination', secondary: 'Accra, Ghana', badge: { text: '32 items', tone: 'slate' } },
            { primary: 'Departure', secondary: 'Sailing confirmed', badge: { text: 'On schedule', tone: 'emerald' } },
          ]}
        />
      </div>
    </BrowserFrame>
  );
}

export function CustomerPortalPreview() {
  return (
    <BrowserFrame url="app.ananselogix.com/portal">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Shipment TAL-2026-000123</p>
          <div className="mt-3 flex items-center gap-1.5">
            {['Received', 'Loaded', 'Departed', 'Arrived'].map((step, i) => (
              <div key={step} className="flex flex-1 flex-col items-center gap-1">
                <span className={`h-2.5 w-2.5 rounded-full ${i < 2 ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                <span className="text-center text-[10px] text-slate-500">{step}</span>
              </div>
            ))}
          </div>
        </div>
        <MockList
          label="My Documents"
          rows={[
            { primary: 'Bill of Lading', secondary: 'PDF · uploaded by staff', badge: { text: 'Available', tone: 'emerald' } },
            { primary: 'Packing List', secondary: 'PDF · uploaded by staff', badge: { text: 'Available', tone: 'emerald' } },
          ]}
        />
      </div>
      <div className="mt-3">
        <MockList
          label="My Invoices"
          rows={[
            { primary: 'INV-2026-0089', secondary: '$450.00 · Ocean LCL shipment', badge: { text: 'Paid', tone: 'emerald' } },
            { primary: 'INV-2026-0102', secondary: '$210.00 · due in 5 days', badge: { text: 'Unpaid', tone: 'amber' } },
          ]}
        />
      </div>
    </BrowserFrame>
  );
}

export function AnalyticsPreview() {
  return (
    <BrowserFrame url="app.ananselogix.com/dashboard/reports">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MiniBarChart label="Revenue by Month" bars={[42, 51, 47, 60, 55, 68, 71, 66, 78, 84]} />
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Revenue (90d)" value="$212,400" tone="primary" />
          <StatTile label="Shipment Volume" value="1,284" tone="accent" />
          <StatTile label="Avg. Transit Time" value="14.2 days" />
          <StatTile label="Open Exceptions" value="6" />
        </div>
      </div>
    </BrowserFrame>
  );
}
