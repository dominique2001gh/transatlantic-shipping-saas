import { Card } from '@/components/ui/Card';

export default function PortalOverviewPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-500">
        Here&apos;s a quick look at your shipments and account.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Active Shipments</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">—</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Outstanding Balance</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">—</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Documents</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">—</p>
        </Card>
      </div>
    </div>
  );
}
