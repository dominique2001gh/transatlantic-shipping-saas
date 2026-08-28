import type { WarehouseItemDetail } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { humanizeEnumValue } from '@/lib/format';

export function ItemConfirmPanel({
  item,
  onConfirm,
  onCancel,
  confirming,
}: {
  item: WarehouseItemDetail;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  return (
    <div className="rounded-xl border-2 border-primary-200 bg-primary-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-lg font-semibold text-slate-900">{item.itemCode}</p>
          <p className="mt-1 text-sm text-slate-600">
            Item {item.sequenceNumber} · {item.shipment.trackingNumber} · {item.shipment.customer.firstName}{' '}
            {item.shipment.customer.lastName} ({item.shipment.customer.customerNumber})
          </p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Type</dt>
          <dd className="mt-0.5 text-slate-700">{humanizeEnumValue(item.itemType)}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</dt>
          <dd className="mt-0.5 text-slate-700">{item.description ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Destination</dt>
          <dd className="mt-0.5 text-slate-700">
            {[item.shipment.destinationLocation, item.shipment.destinationCountry].filter(Boolean).join(', ')}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shipment status</dt>
          <dd className="mt-0.5">
            <StatusBadge status={item.shipment.status} />
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex gap-3">
        <Button type="button" onClick={onConfirm} disabled={confirming}>
          {confirming ? 'Receiving…' : 'Confirm Receipt'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
