'use client';

import { useState, type FormEvent } from 'react';
import { IconSearch } from '@/components/icons';
import { TrackingResult } from '@/components/marketing/TrackingResult';
import { Button } from '@/components/ui/Button';
import { lookupTrackingNumber, type TrackingLookupResult } from '@/lib/tracking';

/**
 * Stage 2B: wires the public tracking search to the real, customer-safe
 * Stage 2A API (see lib/tracking.ts) — this component owns only input
 * state and which of three states to render (idle/error/result); it
 * never re-derives shipment status or decides what's safe to show, that
 * all comes from the API response as-is.
 */
export function TrackingForm({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<TrackingLookupResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    const trimmedNumber = trackingNumber.trim();
    const trimmedName = lastName.trim();
    if (!trimmedNumber || !trimmedName) {
      setValidationError('Enter both your tracking number and the last name on the shipment to continue.');
      setLookupResult(null);
      return;
    }
    setLoading(true);
    setLookupResult(null);
    try {
      const result = await lookupTrackingNumber(trimmedNumber, trimmedName);
      setLookupResult(result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="relative">
            <label htmlFor="trackingNumber" className="sr-only">
              Tracking number
            </label>
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="trackingNumber"
              name="trackingNumber"
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="Tracking number, e.g. TAL-2026-000001"
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="trackingLastName" className="sr-only">
              Last name on the shipment
            </label>
            <input
              id="trackingLastName"
              name="lastName"
              type="text"
              autoComplete="family-name"
              placeholder="Last name on the shipment"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
        <Button type="submit" size={size} disabled={loading} className="w-full sm:w-auto sm:self-start">
          {loading ? 'Searching…' : 'Track Shipment'}
        </Button>
      </form>

      {validationError && (
        <p role="alert" className="text-sm text-red-600">
          {validationError}
        </p>
      )}
      {lookupResult && !lookupResult.found && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {lookupResult.message}
        </p>
      )}
      {lookupResult && lookupResult.found && <TrackingResult result={lookupResult.result} />}
    </div>
  );
}
