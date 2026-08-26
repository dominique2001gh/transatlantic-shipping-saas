import type { Metadata } from 'next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = { title: 'Track a Shipment' };

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-slate-900">Track a Shipment</h1>
      <p className="mt-2 text-sm text-slate-600">
        Enter your tracking number to see the latest status. Tracking numbers look like{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">TAL-2026-000001</code>.
      </p>

      <Card className="mt-8">
        <form className="flex flex-col gap-4 sm:flex-row">
          <input
            type="text"
            name="trackingNumber"
            placeholder="e.g. TAL-2026-000001"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <Button type="submit" className="shrink-0">
            Track
          </Button>
        </form>
        <p className="mt-4 text-xs text-slate-400">
          Public tracking lookups will be connected in a future milestone.
        </p>
      </Card>
    </div>
  );
}
