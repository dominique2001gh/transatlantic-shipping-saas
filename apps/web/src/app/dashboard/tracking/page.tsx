'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { ShipmentSummary, TrackingEventSummary } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { TrackingTimeline } from '@/components/dashboard/TrackingTimeline';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { humanizeEnumValue } from '@/lib/format';
import { getShipment, listTrackingEvents, searchShipments } from '@/lib/shipments';

/**
 * Staff Tracking page — search/view only, no mutation. Reuses the exact
 * same data (Shipment + TrackingEvent) and the exact same timeline
 * renderer (TrackingTimeline) as /dashboard/shipments/[id]; the only new
 * server-side piece this depends on is ShipmentsService.search (tracking
 * number / item code / customer name search), everything else — event
 * history, RBAC, tenant scoping — is the pre-existing shipment tracking
 * system. Adding events stays on the shipment detail page.
 */
export default function TrackingPage() {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ShipmentSummary[] | null>(null);
  const [selected, setSelected] = useState<ShipmentSummary | null>(null);
  const [events, setEvents] = useState<TrackingEventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectShipment(shipmentId: string) {
    setError(null);
    try {
      const [shipment, eventsData] = await Promise.all([
        getShipment(shipmentId),
        listTrackingEvents(shipmentId),
      ]);
      setSelected(shipment);
      setEvents(eventsData);
      setResults(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load that shipment.');
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setError(null);
    setSelected(null);
    setEvents(null);
    setSearching(true);
    try {
      const matches = await searchShipments(trimmed);
      if (matches.length === 1) {
        await selectShipment(matches[0].id);
      } else {
        setResults(matches);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  }

  function newSearch() {
    setSelected(null);
    setEvents(null);
    setResults(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Tracking</h1>
        <p className="mt-1 text-sm text-slate-500">
          Search by shipment tracking number, item/package code, or customer name or number to view its full
          tracking history.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tracking number, item code, or customer name…"
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {results && (
        <Card className="p-0">
          {results.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No matching shipment found.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {results.map((shipment) => (
                <li key={shipment.id}>
                  <button
                    type="button"
                    onClick={() => selectShipment(shipment.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <span>
                      <span className="font-mono text-sm font-medium text-slate-900">{shipment.trackingNumber}</span>
                      <span className="ml-2 text-sm text-slate-500">
                        {shipment.customer
                          ? `${shipment.customer.firstName} ${shipment.customer.lastName} (${shipment.customer.customerNumber})`
                          : ''}
                      </span>
                    </span>
                    <StatusBadge status={shipment.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {selected && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shipment</p>
              <h2 className="mt-1 font-mono text-xl font-semibold text-slate-900">{selected.trackingNumber}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {selected.customer
                  ? `${selected.customer.firstName} ${selected.customer.lastName} (${selected.customer.customerNumber})`
                  : ''}
                {' · '}
                {humanizeEnumValue(selected.shipmentMode)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={selected.status} />
              <Link
                href={`/dashboard/shipments/${selected.id}`}
                className="text-sm font-medium text-primary-700 hover:text-primary-800"
              >
                View full shipment
              </Link>
            </div>
          </div>

          <Card>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Origin</dt>
                <dd className="mt-1 text-sm text-slate-700">
                  {[selected.originLocation, selected.originCountry].filter(Boolean).join(' · ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Destination</dt>
                <dd className="mt-1 text-sm text-slate-700">
                  {[selected.destinationLocation, selected.destinationCountry].filter(Boolean).join(' · ') || '—'}
                </dd>
              </div>
            </dl>
          </Card>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Tracking History</h2>
            <div className="mt-3">
              <TrackingTimeline events={events} />
            </div>
          </section>

          <button
            type="button"
            onClick={newSearch}
            className="self-start text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            ← New search
          </button>
        </>
      )}
    </div>
  );
}
