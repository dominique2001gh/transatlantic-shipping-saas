import type { WarehouseItemDetail } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';

/**
 * Shown when a scanned/searched item has already been processed — proves
 * a repeated scan surfaces the existing state instead of silently
 * re-processing. "Reinspect" is the only way past this screen, and it's
 * always a deliberate click, never automatic.
 */
export function AlreadyProcessedSummary({
  item,
  onReinspect,
}: {
  item: WarehouseItemDetail;
  onReinspect: () => void;
}) {
  const inspection = item.lastInspection;

  return (
    <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-lg font-semibold text-slate-900">{item.itemCode}</p>
          <p className="mt-1 text-sm text-slate-600">
            Item {item.sequenceNumber} · {item.shipment.trackingNumber} · {item.shipment.customer.firstName}{' '}
            {item.shipment.customer.lastName}
          </p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <p className="mt-3 rounded-lg bg-white px-4 py-3 text-sm font-medium text-slate-700">
        This item has already been processed.
        {item.lastInspectedAt ? ` Last inspected ${formatDateTime(item.lastInspectedAt)}` : ''}
        {item.lastInspectedByUser
          ? ` by ${item.lastInspectedByUser.firstName} ${item.lastInspectedByUser.lastName}.`
          : '.'}
      </p>

      {inspection && (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Condition</dt>
            <dd className="mt-0.5">
              <StatusBadge status={inspection.condition} />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Result</dt>
            <dd className="mt-0.5">
              <StatusBadge status={inspection.result} />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Weight</dt>
            <dd className="mt-0.5 text-slate-700">
              {inspection.weight ? `${inspection.weight} ${inspection.weightUnit}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Dimensions</dt>
            <dd className="mt-0.5 text-slate-700">
              {inspection.length || inspection.width || inspection.height
                ? `${inspection.length ?? '—'} × ${inspection.width ?? '—'} × ${inspection.height ?? '—'} ${inspection.dimensionUnit ?? ''}`
                : '—'}
            </dd>
          </div>
          {inspection.hasException && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Exception</dt>
              <dd className="mt-0.5 text-red-700">{inspection.exceptionDescription ?? humanizeEnumValue('OTHER')}</dd>
            </div>
          )}
          {inspection.notes && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</dt>
              <dd className="mt-0.5 text-slate-700">{inspection.notes}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-5">
        <Button type="button" variant="secondary" onClick={onReinspect}>
          Reinspect this item
        </Button>
      </div>
    </div>
  );
}
