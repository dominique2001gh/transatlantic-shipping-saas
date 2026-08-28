'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ShipmentSummary } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { humanizeEnumValue } from '@/lib/format';
import { listShipments } from '@/lib/shipments';

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<ShipmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listShipments()
      .then(setShipments)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load shipments.'));
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Shipments</h1>
          <p className="mt-1 text-sm text-slate-500">
            Create and manage shipments across air, ocean, and RoRo modes.
          </p>
        </div>
        <Link href="/dashboard/shipments/new">
          <Button>New Shipment</Button>
        </Link>
      </div>

      <Card className="mt-6 overflow-x-auto p-0">
        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !shipments && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && shipments && shipments.length === 0 && (
          <p className="p-6 text-sm text-slate-500">No shipments yet.</p>
        )}
        {!error && shipments && shipments.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Tracking #</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shipments.map((shipment) => (
                <tr key={shipment.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">
                    <Link href={`/dashboard/shipments/${shipment.id}`} className="hover:text-primary-700">
                      {shipment.trackingNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {shipment.customer ? `${shipment.customer.firstName} ${shipment.customer.lastName}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(shipment.shipmentMode)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {shipment.originCountry} → {shipment.destinationCountry}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {shipment.itemCounts?.received ?? 0} / {shipment.itemCounts?.total ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={shipment.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
