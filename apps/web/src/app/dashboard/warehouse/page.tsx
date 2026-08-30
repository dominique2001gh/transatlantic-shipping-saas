'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WarehouseActivityEntry, WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { DestinationReceiveWorkspace } from '@/components/warehouse/DestinationReceiveWorkspace';
import { LoadContainerWorkspace } from '@/components/warehouse/LoadContainerWorkspace';
import { ModeSelector, type WarehouseMode } from '@/components/warehouse/ModeSelector';
import { PickupWorkspace } from '@/components/warehouse/PickupWorkspace';
import { ProcessWorkspace } from '@/components/warehouse/ProcessWorkspace';
import { ReceiveWorkspace } from '@/components/warehouse/ReceiveWorkspace';
import { RecentActivityList } from '@/components/warehouse/RecentActivityList';
import { WarehouseInventoryTable } from '@/components/warehouse/WarehouseInventoryTable';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getInventory, getRecentActivity, listWarehouseLocations } from '@/lib/warehouse';

/** Which side of the network a mode operates on — determines the warehouse it should default to. */
type WarehouseSide = 'ORIGIN' | 'DESTINATION';
function sideForMode(mode: WarehouseMode): WarehouseSide {
  // Destination Receive and Pickup/Delivery both operate on cargo already
  // at (or arriving at) the destination warehouse — neither should ever
  // default to the origin warehouse. See yesterday's DFW-default fix.
  return mode === 'DESTINATION_RECEIVE' || mode === 'PICKUP_DELIVERY' ? 'DESTINATION' : 'ORIGIN';
}

export default function WarehousePage() {
  const [mode, setMode] = useState<WarehouseMode>('RECEIVE');
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [inventory, setInventory] = useState<WarehouseItemDetail[] | null>(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [activity, setActivity] = useState<WarehouseActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listWarehouseLocations()
      .then(setWarehouses)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load warehouses.'));
  }, []);

  /**
   * Keep the selected warehouse on the correct side of the network for the
   * active mode. Receive/Process/Load are origin-side floor work and
   * should default to the tenant's origin warehouse; Destination Receive
   * is the opposite end of the same shipment's journey and must default
   * to a warehouse flagged isDestinationWarehouse — never silently inherit
   * whatever origin warehouse was selected for the other modes (that was
   * the bug: this page used a single selectedWarehouseId for every mode,
   * defaulted once to the origin warehouse, and never revisited it).
   *
   * `lastDefaultedSideRef` records which side we last auto-defaulted for,
   * so this only fires on an actual origin<->destination mode crossing —
   * a manual pick within one mode (or across modes on the same side, e.g.
   * Receive -> Process) is never fought. Nothing here assumes a specific
   * tenant's warehouse names/count: it reads the isOriginWarehouse /
   * isDestinationWarehouse flags already on each tenant's own Warehouse
   * rows, so it holds for any tenant with at least one warehouse flagged
   * on each side.
   */
  const lastDefaultedSideRef = useRef<WarehouseSide | null>(null);
  useEffect(() => {
    if (warehouses.length === 0) return;
    const side = sideForMode(mode);
    if (lastDefaultedSideRef.current === side) return;
    lastDefaultedSideRef.current = side;
    const preferred =
      warehouses.find((warehouse) => (side === 'DESTINATION' ? warehouse.isDestinationWarehouse : warehouse.isOriginWarehouse)) ??
      warehouses[0];
    if (preferred) setSelectedWarehouseId(preferred.id);
  }, [mode, warehouses]);

  const reload = useCallback(() => {
    getInventory({ warehouseId: selectedWarehouseId || undefined, search: inventorySearch || undefined })
      .then(setInventory)
      .catch(() => setInventory([]));
    getRecentActivity({ warehouseId: selectedWarehouseId || undefined, limit: 20 })
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [selectedWarehouseId, inventorySearch]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Warehouse</h1>
        <p className="mt-1 text-sm text-slate-500">Choose an operation mode, then scan items to process them.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <ModeSelector mode={mode} onChange={setMode} />

      {mode === 'RECEIVE' && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Receive Items</h2>
          <p className="mt-1 text-sm text-slate-500">
            Scan a package&apos;s label, or search manually if it can&apos;t be scanned. The warehouse selected here
            also filters the inventory and activity below.
          </p>
          <Card className="mt-3">
            {warehouses.length > 0 ? (
              <ReceiveWorkspace
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                onReceived={reload}
              />
            ) : (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            )}
          </Card>
        </section>
      )}

      {mode === 'PROCESS' && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Process / Inspect Items</h2>
          <p className="mt-1 text-sm text-slate-500">
            Scan a received item to record its actual weight, dimensions, and condition. Damaged or flagged items are
            automatically held and never marked ready for container loading.
          </p>
          <Card className="mt-3">
            {warehouses.length > 0 ? (
              <ProcessWorkspace
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                onProcessed={reload}
              />
            ) : (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            )}
          </Card>
        </section>
      )}

      {mode === 'LOAD' && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Load Container</h2>
          <p className="mt-1 text-sm text-slate-500">
            Open or book a container, then scan Processed / Ready items into it. Held, unprocessed, or already-loaded
            items are rejected automatically.
          </p>
          <Card className="mt-3">
            {warehouses.length > 0 ? (
              <LoadContainerWorkspace
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
              />
            ) : (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            )}
          </Card>
        </section>
      )}

      {mode === 'DESTINATION_RECEIVE' && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Destination Receive</h2>
          <p className="mt-1 text-sm text-slate-500">
            Scan an arrived item&apos;s label to record it as physically received at this destination warehouse.
            Damaged, missing, or discrepant cargo is flagged and held for review instead — it never silently counts
            as received.
          </p>
          <Card className="mt-3">
            {warehouses.length > 0 ? (
              <DestinationReceiveWorkspace
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                onReceived={reload}
              />
            ) : (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            )}
          </Card>
        </section>
      )}

      {mode === 'PICKUP_DELIVERY' && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Pickup / Delivery</h2>
          <p className="mt-1 text-sm text-slate-500">
            Scan an item to see what it&apos;s eligible for: a received item can be picked up in person or dispatched
            for delivery; an item already out for delivery can be confirmed delivered or returned after a failed
            attempt.
          </p>
          <Card className="mt-3">
            {warehouses.length > 0 ? (
              <PickupWorkspace
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                onPickedUp={reload}
              />
            ) : (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            )}
          </Card>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Warehouse Inventory</h2>
          <input
            type="search"
            placeholder="Search inventory…"
            value={inventorySearch}
            onChange={(event) => setInventorySearch(event.target.value)}
            className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <Card className="mt-3 p-0">
          {inventory === null ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : (
            <WarehouseInventoryTable items={inventory} />
          )}
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Recent Scan Activity</h2>
        <Card className="mt-3">
          {activity === null ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <RecentActivityList entries={activity} />
          )}
        </Card>
      </section>
    </div>
  );
}
