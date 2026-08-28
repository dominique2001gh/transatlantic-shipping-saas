'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ShipmentSummary } from '@transatlantic/shared';
import { ItemLabel } from '@/components/warehouse/ItemLabel';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { getShipment } from '@/lib/shipments';
import { useTenant } from '@/lib/useTenant';

export default function ShipmentLabelsPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const onlyItemId = searchParams.get('item');

  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { tenantName } = useTenant(true);

  useEffect(() => {
    getShipment(params.id)
      .then(setShipment)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load shipment.'));
  }, [params.id]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!shipment) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const allItems = shipment.items ?? [];
  const items = onlyItemId ? allItems.filter((item) => item.id === onlyItemId) : allItems;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {onlyItemId ? 'Item Label' : 'Item Labels'} — {shipment.trackingNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {items.length} label{items.length === 1 ? '' : 's'} · encodes the internal item code for scanning
          </p>
        </div>
        <Button onClick={() => window.print()} disabled={items.length === 0}>
          {onlyItemId ? 'Print Label' : 'Print All Labels'}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No items to print.</p>
      ) : (
        <div className="label-sheet">
          {items.map((item) => (
            <ItemLabel
              key={item.id}
              data={{
                itemCode: item.itemCode,
                itemType: item.itemType,
                description: item.description,
                sequenceNumber: item.sequenceNumber,
                totalItems: allItems.length,
                trackingNumber: shipment.trackingNumber,
                destinationCountry: shipment.destinationCountry,
                destinationLocation: shipment.destinationLocation,
                companyName: tenantName ?? 'Shipping Company',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
