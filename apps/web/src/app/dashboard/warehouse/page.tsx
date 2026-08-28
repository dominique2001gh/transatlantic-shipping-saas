'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WarehouseActivityEntry, WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { ModeSelector, type WarehouseMode } from '@/components/warehouse/ModeSelector';
import { ReceiveWorkspace } from '@/components/warehouse/ReceiveWorkspace';
import { RecentActivityList } from '@/components/warehouse/RecentActivityList';
import { WarehouseInventoryTable } from '@/components/warehouse/WarehouseInventoryTable';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getInventory, getRecentActivity, listWarehouseLocations } from '@/lib/warehouse';

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
      .then((locations) => {
        setWarehouses(locations);
        const originDefault = locations.find((warehouse) => warehouse.isOriginWarehouse) ?? locations[0];
        if (originDefault) setSelectedWarehouseId(originDefault.id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load warehouses.'));
  }, []);

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
