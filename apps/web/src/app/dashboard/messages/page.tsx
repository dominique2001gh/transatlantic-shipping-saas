'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { NotificationSummary, OperationalExceptionSummary } from '@transatlantic/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';
import { listDisruptions, listNotifications } from '@/lib/notifications';

const STATUS_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'neutral'> = {
  SENT: 'success',
  READ: 'success',
  PENDING: 'neutral',
  FAILED: 'warning',
};

export default function MessagesPage() {
  const [disruptions, setDisruptions] = useState<OperationalExceptionSummary[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDisruptions()
      .then(setDisruptions)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load disruption messages.'));
    listNotifications()
      .then(setNotifications)
      .catch(() => setNotifications([]));
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
          <p className="mt-1 text-sm text-slate-500">
            Customer notification history, and staff-composed container/manifest disruption messages.
          </p>
        </div>
        <Link href="/dashboard/messages/new">
          <Button>New Disruption Message</Button>
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Disruption Messages</h2>
        <Card className="mt-3 overflow-x-auto p-0">
          {!disruptions && <p className="p-6 text-sm text-slate-500">Loading…</p>}
          {disruptions && disruptions.length === 0 && (
            <p className="p-6 text-sm text-slate-500">No disruption messages sent yet.</p>
          )}
          {disruptions && disruptions.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Applies to</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Notified</th>
                  <th className="px-4 py-3 font-medium">Sent</th>
                  <th className="px-4 py-3 font-medium">By</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {disruptions.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {d.containerNumber ?? d.manifestNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(d.type)}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-700" title={d.message}>
                      {d.message}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{d.notifiedCustomerCount}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(d.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{d.createdByName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={d.resolvedAt ? 'success' : 'warning'}>{d.resolvedAt ? 'Resolved' : 'Open'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Notification History</h2>
        <p className="mt-1 text-sm text-slate-500">Every customer notification this tenant has generated, and whether it was delivered.</p>
        <Card className="mt-3 overflow-x-auto p-0">
          {!notifications && <p className="p-6 text-sm text-slate-500">Loading…</p>}
          {notifications && notifications.length === 0 && (
            <p className="p-6 text-sm text-slate-500">No notifications sent yet.</p>
          )}
          {notifications && notifications.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Channel</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Sent</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <tr key={n.id}>
                    <td className="px-4 py-3 text-slate-700">{n.customerName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(n.channel)}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-700" title={n.title}>
                      {n.title}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(n.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE_VARIANT[n.status] ?? 'neutral'}>{humanizeEnumValue(n.status)}</Badge>
                      {n.status === 'FAILED' && n.errorMessage && (
                        <div className="mt-1 text-xs text-red-600">{n.errorMessage}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </div>
  );
}
