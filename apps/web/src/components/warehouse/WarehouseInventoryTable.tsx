import type { WarehouseItemDetail } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';

export function WarehouseInventoryTable({ items }: { items: WarehouseItemDetail[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Item Code</th>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Shipment</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Description</th>
            <th className="px-4 py-3 font-medium">Destination</th>
            <th className="px-4 py-3 font-medium">Received</th>
            <th className="px-4 py-3 font-medium">Received By</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Warehouse</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">{item.itemCode}</td>
              <td className="px-4 py-3 text-slate-600">
                {item.shipment.customer.firstName} {item.shipment.customer.lastName}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.shipment.trackingNumber}</td>
              <td className="px-4 py-3 text-slate-600">{humanizeEnumValue(item.itemType)}</td>
              <td className="px-4 py-3 text-slate-500">{item.description ?? '—'}</td>
              <td className="px-4 py-3 text-slate-500">
                {[item.shipment.destinationLocation, item.shipment.destinationCountry].filter(Boolean).join(', ')}
              </td>
              <td className="px-4 py-3 text-slate-500">{item.receivedAt ? formatDateTime(item.receivedAt) : '—'}</td>
              <td className="px-4 py-3 text-slate-500">
                {item.receivedByUser ? `${item.receivedByUser.firstName} ${item.receivedByUser.lastName}` : '—'}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-4 py-3 text-slate-500">{item.currentWarehouse?.code ?? '—'}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-500">
                No items currently at this warehouse.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
