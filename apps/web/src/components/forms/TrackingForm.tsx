'use client';

import { useState, type FormEvent } from 'react';
import { IconSearch } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { lookupTrackingNumber } from '@/lib/tracking';

export function TrackingForm({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const trimmed = trackingNumber.trim();
    if (!trimmed) {
      setError('Enter a tracking number to continue.');
      return;
    }
    setLoading(true);
    try {
      const result = await lookupTrackingNumber(trimmed);
      setMessage(result.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="trackingNumber" className="sr-only">
          Tracking number
        </label>
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="trackingNumber"
            name="trackingNumber"
            type="text"
            inputMode="text"
            autoComplete="off"
            placeholder="e.g. TAL-2026-000001"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <Button type="submit" size={size} disabled={loading} className="shrink-0">
          {loading ? 'Searching…' : 'Track Shipment'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg bg-primary-50 px-4 py-3 text-sm text-primary-800">
          {message}
        </p>
      )}
    </form>
  );
}
