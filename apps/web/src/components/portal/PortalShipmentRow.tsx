import Link from 'next/link';
import type { PortalShipmentSummary } from '@transatlantic/shared';
import { IconArrowRight, IconBox, IconMapPin } from '@/components/icons';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/format';
import { milestoneBadgeVariant } from '@/lib/portal-shipment-status';
import { SHIPMENT_MODE_LABELS } from '@/lib/quote';

/**
 * One shipment row, shared by the dashboard's "recent shipments" section
 * and the full /portal/shipments list, so both read identically. Every
 * field here is already customer-safe (see PortalShipmentSummary/
 * TrackingService.listForCustomer) — this component makes no further
 * decisions about what's safe to show.
 *
 * Links to /portal/shipments/:id, which doesn't have a page yet — that's
 * Stage 2C-4. Until then this is a dead link by design (Next.js 404s),
 * not a bug in this stage.
 */
export function PortalShipmentRow({ shipment }: { shipment: PortalShipmentSummary }) {
  return (
    <Link
      href={`/portal/shipments/${shipment.id}`}
      className="flex flex-wrap items-center justify-between gap-3 py-4 transition-colors hover:bg-slate-50 sm:px-2"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
          <IconBox className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold text-slate-900">{shipment.trackingNumber}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
            <IconMapPin className="h-3.5 w-3.5 shrink-0" />
            <span>
              {shipment.originCountry} → {shipment.destinationCountry}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>{SHIPMENT_MODE_LABELS[shipment.shipmentMode]}</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-xs text-slate-400">{formatDate(shipment.createdAt)}</p>
          <p className="text-xs text-slate-500">
            {shipment.itemSummary.total} item{shipment.itemSummary.total === 1 ? '' : 's'}
          </p>
        </div>
        <Badge variant={milestoneBadgeVariant(shipment.overallMilestone.label, shipment.isCompleted)}>
          {shipment.overallMilestone.label}
        </Badge>
        <IconArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
      </div>
    </Link>
  );
}
