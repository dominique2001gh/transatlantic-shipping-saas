'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PortalPreRegistration } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatDate } from '@/lib/format';
import { listPreRegistrations } from '@/lib/pre-registrations';

/**
 * Customer Self-Service Pre-Registration, Stage 2: "Prepared Drop-Offs" —
 * every pre-registration on this account, already scoped server-side to
 * the caller's own tenant + Customer record (PreRegistrationsService.
 * listForCustomer). This page adds no filtering of its own that matters
 * for security.
 */
export default function PreRegistrationsListPage() {
  const [records, setRecords] = useState<PortalPreRegistration[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    listPreRegistrations()
      .then(setRecords)
      .catch(() => setError(true));
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Prepared Drop-Offs</h1>
          <p className="mt-1 text-sm text-slate-500">Every drop-off you&apos;ve prepared, and its current status.</p>
        </div>
        <Link href="/portal/pre-register">
          <Button type="button">Prepare a Drop-Off</Button>
        </Link>
      </div>

      <Card className="mt-6 p-0">
        {error && (
          <p className="p-6 text-sm text-red-600">
            We couldn&apos;t load your prepared drop-offs right now. Please refresh the page.
          </p>
        )}

        {!error && !records && (
          <div className="divide-y divide-slate-100 px-4 sm:px-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-4">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1">
                  <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
                  <div className="mt-2 h-3 w-56 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!error && records && records.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-semibold text-slate-900">No prepared drop-offs yet</h2>
            <p className="max-w-sm px-6 text-sm text-slate-500">
              Prepare a drop-off before you arrive at the warehouse to speed up check-in.
            </p>
            <Link href="/portal/pre-register" className="mt-2">
              <Button type="button">Prepare a Drop-Off</Button>
            </Link>
          </div>
        )}

        {!error && records && records.length > 0 && (
          <div className="divide-y divide-slate-100">
            {records.map((record) => (
              <Link
                key={record.id}
                href={`/portal/pre-registrations/${record.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-slate-50 sm:px-6"
              >
                <div>
                  <p className="font-mono text-sm font-medium text-slate-900">{record.referenceNumber ?? 'Not yet submitted'}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {record.recipientName ?? 'No recipient yet'}
                    {record.destinationCountry ? ` · ${record.destinationCountry}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">Created {formatDate(record.createdAt)}</p>
                </div>
                <StatusBadge status={record.status} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
