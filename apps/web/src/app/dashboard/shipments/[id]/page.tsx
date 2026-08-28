'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ShipmentSummary, TrackingEventSummary } from '@transatlantic/shared';
import { AddItemForm } from '@/components/dashboard/AddItemForm';
import { AddTrackingEventForm } from '@/components/dashboard/AddTrackingEventForm';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';
import { getShipment, listTrackingEvents } from '@/lib/shipments';

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const shipmentId = params.id;

  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [events, setEvents] = useState<TrackingEventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [shipmentData, eventsData] = await Promise.all([
        getShipment(shipmentId),
        listTrackingEvents(shipmentId),
      ]);
      setShipment(shipmentData);
      setEvents(eventsData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load shipment.');
    }
  }, [shipmentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!shipment) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shipment</p>
          <h1 className="mt-1 font-mono text-2xl font-semibold text-slate-900">{shipment.trackingNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {shipment.customer ? `${shipment.customer.firstName} ${shipment.customer.lastName} (${shipment.customer.customerNumber})` : ''}
            {' · '}
            {humanizeEnumValue(shipment.shipmentMode)}
          </p>
        </div>
        <StatusBadge status={shipment.status} />
      </div>

      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Detail
            label="Origin"
            value={[shipment.originLocation, shipment.originCountry].filter(Boolean).join(' · ')}
          />
          <Detail
            label="Destination"
            value={[shipment.destinationLocation, shipment.destinationCountry].filter(Boolean).join(' · ')}
          />
          <Detail
            label="Items"
            value={`${shipment.itemCounts?.received ?? 0} of ${shipment.itemCounts?.total ?? 0} received`}
          />
        </dl>
        {shipment.description && <p className="mt-4 text-sm text-slate-600">{shipment.description}</p>}
      </Card>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Items</h2>
          {(shipment.items?.length ?? 0) > 0 && (
            <Link
              href={`/dashboard/shipments/${shipmentId}/labels`}
              className="text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              Print All Labels
            </Link>
          )}
        </div>
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Item Code</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Weight</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(shipment.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.itemCode}</td>
                  <td className="px-4 py-3 text-slate-700">{humanizeEnumValue(item.itemType)}</td>
                  <td className="px-4 py-3 text-slate-500">{item.description ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {item.weight ? `${item.weight} ${item.weightUnit}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/shipments/${shipmentId}/labels?item=${item.id}`}
                      className="font-medium text-primary-700 hover:text-primary-800"
                    >
                      Print
                    </Link>
                  </td>
                </tr>
              ))}
              {(!shipment.items || shipment.items.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                    No items yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <AddItemForm shipmentId={shipmentId} onAdded={reload} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Tracking History</h2>
        <Card className="mt-3">
          {events && events.length > 0 ? (
            <ol className="flex flex-col gap-4">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {humanizeEnumValue(event.eventType)}
                      {event.shipmentItemId && (
                        <span className="ml-2 text-xs font-normal text-slate-400">(item-level)</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(event.occurredAt)}
                      {event.createdByUser && ` · ${event.createdByUser.firstName} ${event.createdByUser.lastName}`}
                      {event.source !== 'MANUAL' && ` · ${humanizeEnumValue(event.source)}`}
                    </p>
                    {event.notes && <p className="mt-1 text-sm text-slate-600">{event.notes}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-500">No events yet.</p>
          )}
        </Card>
        <AddTrackingEventForm shipmentId={shipmentId} items={shipment.items ?? []} onAdded={reload} />
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-700">{value || '—'}</dd>
    </div>
  );
}
