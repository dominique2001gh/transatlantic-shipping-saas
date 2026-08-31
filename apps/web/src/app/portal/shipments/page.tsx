'use client';

import { useEffect, useState } from 'react';
import type { PortalShipmentSummary } from '@transatlantic/shared';
import { IconBox } from '@/components/icons';
import { PortalShipmentRow } from '@/components/portal/PortalShipmentRow';
import { Card } from '@/components/ui/Card';

import { listPortalShipments } from '@/lib/portal';

/**
 * The customer's full shipment list — every shipment GET /portal/shipments
 * returns for this account, already scoped server-side to the caller's own
 * tenant + Customer record (see CustomerPortalService). This page adds no
 * filtering of its own that matters for security; it only decides how to
 * render what the API already returned.
 */
export default function PortalShipmentsPage() {
  const [shipments, setShipments] = useState<PortalShipmentSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    listPortalShipments()
      .then(setShipments)
      .catch(() => setError(true));
  }, []);

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My Shipments</h1>
        <p className="mt-1 text-sm text-slate-500">Every shipment on your account, with its current status.</p>
      </div>

      <Card className="mt-6 p-0">
        {error && (
          <p className="p-6 text-sm text-red-600">
            We couldn&apos;t load your shipments right now. Please refresh the page, or contact us if this keeps
            happening.
          </p>
        )}

        {!error && !shipments && (
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

        {!error && shipments && shipments.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <IconBox className="h-6 w-6" />
            </span>
            <h2 className="mt-2 text-base font-semibold text-slate-900">No shipments yet</h2>
            <p className="max-w-sm px-6 text-sm text-slate-500">
              Once your shipping company adds a shipment to your account, it will show up here with live status
              updates.
            </p>
          </div>
        )}

        {!error && shipments && shipments.length > 0 && (
          <div className="divide-y divide-slate-100 px-4 sm:px-6">
            {shipments.map((shipment) => (
              <PortalShipmentRow key={shipment.id} shipment={shipment} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
