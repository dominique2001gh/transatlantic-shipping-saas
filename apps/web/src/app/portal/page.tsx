'use client';

import { useEffect, useState } from 'react';
import type { PortalCustomerProfile, PortalShipmentSummary } from '@transatlantic/shared';
import { IconArrowRight, IconBox, IconCheckCircle, IconMapPin, IconShip } from '@/components/icons';
import { PortalShipmentRow } from '@/components/portal/PortalShipmentRow';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { getPortalProfile, listPortalShipments } from '@/lib/portal';
import { bucketForShipment, isActiveShipment } from '@/lib/portal-shipment-status';

const RECENT_SHIPMENT_COUNT = 3;

/**
 * Customer dashboard. Deliberately an *overview*, not a second copy of the
 * shipment list: summary tiles + a short recent-shipments slice, with a
 * clear link out to the full list at /portal/shipments. Every number here
 * is derived client-side from GET /portal/shipments — already scoped
 * server-side to this customer's own shipments (see
 * CustomerPortalService) — this page does no filtering that matters for
 * security, only for what's shown where.
 */
export default function PortalOverviewPage() {
  const [profile, setProfile] = useState<PortalCustomerProfile | null>(null);
  const [shipments, setShipments] = useState<PortalShipmentSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([getPortalProfile(), listPortalShipments()])
      .then(([profileResult, shipmentsResult]) => {
        setProfile(profileResult);
        setShipments(shipmentsResult);
      })
      .catch(() => setError(true));
  }, []);

  const loading = !error && (!profile || !shipments);

  if (error) {
    return (
      <Card className="mt-2">
        <p className="text-sm text-red-600">
          We couldn&apos;t load your dashboard right now. Please refresh the page, or contact us if this keeps
          happening.
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <div>
        <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-slate-100" />
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  const allShipments = shipments!;
  const activeCount = allShipments.filter(isActiveShipment).length;
  const inTransitCount = allShipments.filter((s) => bucketForShipment(s) === 'inTransit').length;
  const arrivedOrReadyCount = allShipments.filter((s) => bucketForShipment(s) === 'arrivedOrReady').length;
  const completedCount = allShipments.filter((s) => bucketForShipment(s) === 'completed').length;
  const recentShipments = allShipments.slice(0, RECENT_SHIPMENT_COUNT);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Welcome back, {profile!.firstName}</h1>
      <p className="mt-1 text-sm text-slate-500">Here&apos;s a quick look at your shipments.</p>

      {allShipments.length === 0 ? (
        <Card className="mt-6 flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <IconBox className="h-6 w-6" />
          </span>
          <h2 className="mt-2 text-base font-semibold text-slate-900">No shipments yet</h2>
          <p className="max-w-sm text-sm text-slate-500">
            Once your shipping company adds a shipment to your account, it will show up here with live status
            updates.
          </p>
        </Card>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="flex flex-col gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconBox className="h-4 w-4" />
              </span>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{activeCount}</p>
              <p className="text-sm text-slate-500">Active Shipments</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconShip className="h-4 w-4" />
              </span>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{inTransitCount}</p>
              <p className="text-sm text-slate-500">In Transit</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconMapPin className="h-4 w-4" />
              </span>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{arrivedOrReadyCount}</p>
              <p className="text-sm text-slate-500">Arrived / Ready</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <IconCheckCircle className="h-4 w-4" />
              </span>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{completedCount}</p>
              <p className="text-sm text-slate-500">Completed</p>
            </Card>
          </div>

          <Card className="mt-6 p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">Recent shipments</h2>
              <LinkButton href="/portal/shipments" variant="ghost" size="sm">
                View all
                <IconArrowRight className="h-4 w-4" />
              </LinkButton>
            </div>
            <div className="divide-y divide-slate-100 px-4 sm:px-6">
              {recentShipments.map((shipment) => (
                <PortalShipmentRow key={shipment.id} shipment={shipment} />
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
