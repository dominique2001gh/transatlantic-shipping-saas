'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReceivingRecordSummary } from '@transatlantic/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError, isForbidden } from '@/lib/api';
import { formatDateTime, humanizeEnumValue, statusBadgeVariant } from '@/lib/format';
import { listReceivingRecords, searchReceivingRecords } from '@/lib/receiving';

type Filter = 'awaiting' | 'all';

export default function ReceivingPage() {
  const [filter, setFilter] = useState<Filter>('awaiting');
  const [search, setSearch] = useState('');
  const [records, setRecords] = useState<ReceivingRecordSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let active = true;
    const trimmed = search.trim();
    const request = trimmed
      ? searchReceivingRecords(trimmed)
      : listReceivingRecords(filter === 'awaiting' ? { awaitingConsolidation: true } : {});
    request
      .then((data) => {
        if (active) setRecords(data);
      })
      .catch((err) => {
        if (!active) return;
        if (isForbidden(err)) {
          setForbidden(true);
          setError("You don't have permission to view warehouse receiving records.");
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Failed to load receiving records.');
      });
    return () => {
      active = false;
    };
  }, [filter, search]);

  if (forbidden) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Warehouse Receiving</h1>
        <Card className="mt-6">
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Warehouse Receiving</h1>
          <p className="mt-1 text-sm text-slate-500">
            Log individual incoming deliveries and later combine them into final shipping boxes.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/receiving/consolidate">
            <Button variant="secondary">Consolidate</Button>
          </Link>
          <Link href="/dashboard/receiving/new">
            <Button>Receive a Delivery</Button>
          </Link>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <input
          type="search"
          placeholder="Search by customer, phone, carrier tracking #, or internal reference…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-96"
        />
        {!search && (
          <div className="flex gap-2">
            <Button variant={filter === 'awaiting' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('awaiting')}>
              Awaiting Consolidation
            </Button>
            <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('all')}>
              All
            </Button>
          </div>
        )}
      </div>

      <Card className="mt-6 overflow-x-auto p-0">
        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !records && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && records && records.length === 0 && (
          <p className="p-6 text-sm text-slate-500">No receiving records found.</p>
        )}
        {!error && records && records.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Internal Ref</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Carrier</th>
                <th className="px-4 py-3 font-medium">Tracking #</th>
                <th className="px-4 py-3 font-medium">Qty</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((record) => (
                <tr key={record.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">
                    <Link href={`/dashboard/receiving/${record.id}`} className="hover:text-primary-700">
                      {record.internalReference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{record.customerName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {record.carrier === 'OTHER' ? record.carrierOther ?? 'Other' : record.carrier}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{record.carrierTrackingNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {record.allocatedQuantity} / {record.quantity}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusBadgeVariant(record.status)}>{humanizeEnumValue(record.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(record.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
