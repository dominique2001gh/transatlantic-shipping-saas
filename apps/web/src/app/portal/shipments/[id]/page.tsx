'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PortalShipmentDetail } from '@transatlantic/shared';
import { TrackingResult } from '@/components/marketing/TrackingResult';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { getPortalShipmentDetail } from '@/lib/portal';
import { SHIPMENT_MODE_LABELS } from '@/lib/quote';

/**
 * Stage 2C-4: authenticated shipment detail. Fetches GET
 * /portal/shipments/:id (already scoped server-side to this customer's own
 * tenant + Customer record — see CustomerPortalService/
 * TrackingService.getForCustomer) and renders it with the exact same
 * <TrackingResult> component the public /track page uses for Stage 2A/2B —
 * one shared, customer-safe tracking presentation, not a second
 * interpretation of it. PortalShipmentDetail is a strict superset of
 * PublicTrackingResult (adds `id` and `shipmentMode`, both ignored by
 * TrackingResult), so no adapter/mapping is needed.
 *
 * A shipment that doesn't exist and one that exists but belongs to another
 * customer/tenant both 404 identically server-side; this page renders the
 * same generic "not found" message for either case, never distinguishing
 * them.
 */
export default function PortalShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const shipmentId = params.id;

  const [detail, setDetail] = useState<PortalShipmentDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setDetail(null);
    setNotFound(false);
    setError(false);
    getPortalShipmentDetail(shipmentId)
      .then(setDetail)
      .catch((err) => {
        if (err instanceof ApiError && err.statusCode === 404) {
          setNotFound(true);
        } else {
          setError(true);
        }
      });
  }, [shipmentId]);

  return (
    <div>
      <Link href="/portal/shipments" className="text-sm font-medium text-primary-700 hover:text-primary-800">
        ← My Shipments
      </Link>

      {notFound && (
        <Card className="mt-4">
          <h1 className="text-base font-semibold text-slate-900">Shipment not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            We couldn&apos;t find that shipment on your account. Double-check the link, or head back to{' '}
            <Link href="/portal/shipments" className="font-medium text-primary-700 hover:underline">
              My Shipments
            </Link>
            .
          </p>
        </Card>
      )}

      {error && (
        <Card className="mt-4">
          <p className="text-sm text-red-600">
            We couldn&apos;t load this shipment right now. Please refresh the page, or contact us if this keeps
            happening.
          </p>
        </Card>
      )}

      {!notFound && !error && !detail && (
        <div className="mt-4">
          <div className="h-7 w-64 animate-pulse rounded bg-slate-200" />
          <div className="mt-6 h-40 animate-pulse rounded-2xl bg-slate-100" />
          <div className="mt-6 h-56 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      )}

      {detail && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold text-slate-900">{SHIPMENT_MODE_LABELS[detail.shipmentMode]}</span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="text-slate-500">Created {formatDate(detail.createdAt)}</span>
          </div>
          <TrackingResult result={detail} />
        </div>
      )}
    </div>
  );
}
