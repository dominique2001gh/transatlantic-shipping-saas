import { Card } from '@/components/ui/Card';

const SUMMARY_CARDS = [
  { label: 'Active Shipments', value: '—' },
  { label: 'Customers', value: '—' },
  { label: 'Open Invoices', value: '—' },
  { label: 'Containers In Transit', value: '—' },
];

export default function DashboardOverviewPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
      <p className="mt-1 text-sm text-slate-500">
        A snapshot of your operation. Live metrics arrive in a future milestone.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <Card key={card.label}>
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{card.value}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
