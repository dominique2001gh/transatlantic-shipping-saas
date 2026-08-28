import type { ContainerDetail } from '@transatlantic/shared';
import { IconClose } from '@/components/icons';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';

export function ContainerContentsList({
  container,
  onRemove,
  removing,
}: {
  container: ContainerDetail;
  onRemove: (itemId: string) => void;
  removing: string | null;
}) {
  const canModify = container.status === 'BOOKED' || container.status === 'LOADING';
  const weightSummary = Object.entries(container.summary.weightByUnit)
    .map(([unit, total]) => `${total} ${unit}`)
    .join(' + ');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
        <span>
          <strong className="text-slate-900">{container.summary.itemCount}</strong> item
          {container.summary.itemCount === 1 ? '' : 's'}
        </span>
        <span>
          <strong className="text-slate-900">{container.summary.customerCount}</strong> customer
          {container.summary.customerCount === 1 ? '' : 's'}
        </span>
        {weightSummary && (
          <span>
            <strong className="text-slate-900">{weightSummary}</strong> total weight
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Item Code</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Shipment</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Loaded</th>
              <th className="px-3 py-2 font-medium">By</th>
              {canModify && <th className="px-3 py-2 font-medium">&nbsp;</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {container.items.map((containerItem) => (
              <tr key={containerItem.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs font-medium text-slate-900">
                  {containerItem.shipmentItem.itemCode}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {containerItem.shipment.customer.firstName} {containerItem.shipment.customer.lastName}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{containerItem.shipment.trackingNumber}</td>
                <td className="px-3 py-2 text-slate-600">{humanizeEnumValue(containerItem.shipmentItem.itemType)}</td>
                <td className="px-3 py-2 text-slate-500">{formatDateTime(containerItem.loadedAt)}</td>
                <td className="px-3 py-2 text-slate-500">
                  {containerItem.loadedByUser
                    ? `${containerItem.loadedByUser.firstName} ${containerItem.loadedByUser.lastName}`
                    : '—'}
                </td>
                {canModify && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onRemove(containerItem.shipmentItem.id)}
                      disabled={removing === containerItem.shipmentItem.id}
                      title="Remove from container"
                      aria-label={`Remove ${containerItem.shipmentItem.itemCode} from container`}
                      className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <IconClose className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {container.items.length === 0 && (
              <tr>
                <td colSpan={canModify ? 7 : 6} className="px-3 py-6 text-center text-sm text-slate-500">
                  No items loaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
