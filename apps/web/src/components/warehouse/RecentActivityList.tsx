import type { WarehouseActivityEntry } from '@transatlantic/shared';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';

export function RecentActivityList({ entries }: { entries: WarehouseActivityEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No warehouse activity yet.</p>;
  }
  return (
    <ol className="flex flex-col divide-y divide-slate-100">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <div>
            <span className="font-mono font-medium text-slate-900">{entry.shipmentItem?.itemCode ?? '—'}</span>{' '}
            <span className="text-slate-500">
              {humanizeEnumValue(entry.eventType)} · {entry.shipment.trackingNumber}
              {entry.warehouse ? ` · ${entry.warehouse.code}` : ''}
            </span>
          </div>
          <div className="text-xs text-slate-400">
            {formatDateTime(entry.occurredAt)}
            {entry.createdByUser ? ` · ${entry.createdByUser.firstName} ${entry.createdByUser.lastName}` : ''}
            {entry.source !== 'MANUAL' ? ` · ${humanizeEnumValue(entry.source)}` : ''}
          </div>
        </li>
      ))}
    </ol>
  );
}
