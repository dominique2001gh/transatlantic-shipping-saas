'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MANAGER_UP_ROLES, hasPermission } from '@transatlantic/shared';
import type { WarehouseActivityEntry, WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { AskAiLink } from '@/components/warehouse/AskAiLink';
import { DestinationReceiveWorkspace } from '@/components/warehouse/DestinationReceiveWorkspace';
import { LoadContainerWorkspace } from '@/components/warehouse/LoadContainerWorkspace';
import { ModeSelector, type WarehouseMode } from '@/components/warehouse/ModeSelector';
import { PickupWorkspace } from '@/components/warehouse/PickupWorkspace';
import { ProcessWorkspace } from '@/components/warehouse/ProcessWorkspace';
import { ReceiveWorkspace } from '@/components/warehouse/ReceiveWorkspace';
import { RecentActivityList } from '@/components/warehouse/RecentActivityList';
import { WarehouseInventoryTable } from '@/components/warehouse/WarehouseInventoryTable';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { getInventory, getRecentActivity, listWarehouseLocations } from '@/lib/warehouse';

/** Which side of the network a mode operates on — determines the warehouse it should default to. */
type WarehouseSide = 'ORIGIN' | 'DESTINATION';
function sideForMode(mode: WarehouseMode): WarehouseSide {
  // Destination Receive and Pickup/Delivery both operate on cargo already
  // at (or arriving at) the destination warehouse — neither should ever
  // default to the origin warehouse. See yesterday's DFW-default fix.
  return mode === 'DESTINATION_RECEIVE' || mode === 'PICKUP_DELIVERY' ? 'DESTINATION' : 'ORIGIN';
}

/**
 * Shown by Destination Receive / Pickup / Delivery instead of a workspace
 * when this tenant has zero warehouses flagged isDestinationWarehouse —
 * deliberately never falls back to offering an origin warehouse (that was
 * the Gold Coast/Mansfield production bug). OWNER/MANAGER get a direct
 * link to actually fix it; STAFF/FINANCE (who can reach this page but not
 * /dashboard/settings/warehouses) get the same explanation without a link
 * they can't use.
 */
function NoDestinationWarehouseMessage({ canManageWarehouses }: { canManageWarehouses: boolean }) {
  return (
    <p className="text-sm text-slate-500">
      No destination warehouse is configured for this tenant yet.{' '}
      {canManageWarehouses ? (
        <>
          Add one and flag it as a destination warehouse under{' '}
          <Link href="/dashboard/settings/warehouses" className="text-primary-700 underline">
            Manage Warehouses
          </Link>{' '}
          before using this mode.
        </>
      ) : (
        'Ask an owner or manager to configure one under Settings before using this mode.'
      )}
    </p>
  );
}

export default function WarehousePage() {
  // Settings (where /dashboard/settings/warehouses is also linked from) is
  // an OWNER-only nav item (see nav.ts) — MANAGER can use the warehouse
  // management page but would otherwise have no way to discover it. This
  // link gives MANAGER (and OWNER) that path without loosening the
  // unrelated OWNER-only Settings nav gate.
  const currentUser = getStoredUser();
  const canManageWarehouses = !!currentUser && MANAGER_UP_ROLES.includes(currentUser.role);
  const canView = hasPermission(currentUser, 'warehouse.view');

  const [mode, setMode] = useState<WarehouseMode>('RECEIVE');
  /**
   * `null` = not yet fetched (show "Loading…"); `[]` = fetched, but this
   * tenant genuinely has no warehouses configured yet (show that
   * explicitly, never a permanent fake "Loading…" — a tenant with zero
   * warehouses was previously indistinguishable from one still loading).
   */
  const [warehouses, setWarehouses] = useState<WarehouseSummary[] | null>(null);
  /**
   * Warehouse Location Management follow-up (2026-09-29): Destination
   * Receive and Pickup/Delivery must only ever offer a warehouse actually
   * flagged isDestinationWarehouse — never every warehouse the tenant has.
   * An unfiltered list here is exactly what let an origin-only warehouse
   * (Gold Coast's Mansfield) be selected for a destination handoff in
   * production; the backend now independently rejects that too (see
   * WarehouseService.resolveEligibleDestinationWarehouseId), but this list
   * should never offer the wrong choice in the first place.
   */
  const destinationWarehouses = warehouses?.filter((warehouse) => warehouse.isDestinationWarehouse) ?? null;
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [inventory, setInventory] = useState<WarehouseItemDetail[] | null>(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [activity, setActivity] = useState<WarehouseActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    listWarehouseLocations()
      .then(setWarehouses)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load warehouses.'));
  }, [canView]);

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
   *
   * The DESTINATION side's `?? warehouses[0]` fallback was removed
   * (2026-09-29): falling back to "any warehouse" when none is flagged
   * isDestinationWarehouse is exactly how an origin-only warehouse
   * (Mansfield, for Gold Coast) ended up pre-selected for Destination
   * Receive/Pickup/Delivery. When no destination warehouse exists yet,
   * this now leaves selectedWarehouseId empty — the section below shows
   * an explicit "configure a destination warehouse" message instead of
   * silently offering the wrong one. The ORIGIN side keeps its own
   * `?? warehouses[0]` fallback unchanged; that side was never the bug.
   */
  const lastDefaultedSideRef = useRef<WarehouseSide | null>(null);
  useEffect(() => {
    if (!warehouses || warehouses.length === 0) return;
    const side = sideForMode(mode);
    if (lastDefaultedSideRef.current === side) return;
    lastDefaultedSideRef.current = side;
    if (side === 'DESTINATION') {
      // No `?? warehouses[0]` fallback here on purpose — see doc comment
      // above. An empty destinationWarehouses list clears the selection
      // entirely rather than leaving a stale origin-warehouse id selected
      // (which would otherwise keep filtering the inventory/activity
      // panels below by the wrong warehouse while this mode shows its own
      // "configure a destination warehouse" message instead of a workspace).
      setSelectedWarehouseId((destinationWarehouses ?? [])[0]?.id ?? '');
      return;
    }
    const preferred = warehouses.find((warehouse) => warehouse.isOriginWarehouse) ?? warehouses[0];
    if (preferred) setSelectedWarehouseId(preferred.id);
  }, [mode, warehouses, destinationWarehouses]);

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

  if (!canView) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Warehouse</h1>
        <Card className="mt-6">
          <p className="text-sm text-red-600">You don&apos;t have permission to view the warehouse.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Warehouse</h1>
          <p className="mt-1 text-sm text-slate-500">Choose an operation mode, then scan items to process them.</p>
        </div>
        {canManageWarehouses && (
          <LinkButton href="/dashboard/settings/warehouses" variant="secondary" size="sm">
            Manage Warehouses
          </LinkButton>
        )}
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
          <p className="mt-1">
            <AskAiLink question="How do I receive a package?" />
          </p>
          <Card className="mt-3">
            {warehouses === null ? (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            ) : warehouses.length > 0 ? (
              <ReceiveWorkspace
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                onReceived={reload}
              />
            ) : (
              <p className="text-sm text-slate-500">
                No warehouses are configured for this tenant yet. Contact support to set one up before using
                Warehouse operations.
              </p>
            )}
          </Card>
        </section>
      )}

      {mode === 'PROCESS' && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Process / Inspect Items</h2>
          <p className="mt-1 text-sm text-slate-500">
            Scan a received item to record its actual weight, dimensions, and condition. Damaged or flagged items are
            automatically held and never marked ready for container loading. This step is optional — a received item
            can also go straight to Container Loading without inspection.
          </p>
          <p className="mt-1">
            <AskAiLink question="How do I process and inspect an item?" />
          </p>
          <Card className="mt-3">
            {warehouses === null ? (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            ) : warehouses.length > 0 ? (
              <ProcessWorkspace
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                onProcessed={reload}
              />
            ) : (
              <p className="text-sm text-slate-500">
                No warehouses are configured for this tenant yet. Contact support to set one up before using
                Warehouse operations.
              </p>
            )}
          </Card>
        </section>
      )}

      {mode === 'LOAD' && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Load Container</h2>
          <p className="mt-1 text-sm text-slate-500">
            Open or book a container, then scan Received or Processed / Ready items into it — inspection is optional.
            Held or already-loaded items are rejected automatically.
          </p>
          <p className="mt-1">
            <AskAiLink question="How do I load items into a container?" />
          </p>
          <Card className="mt-3">
            {warehouses === null ? (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            ) : warehouses.length > 0 ? (
              <LoadContainerWorkspace
                warehouses={warehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
              />
            ) : (
              <p className="text-sm text-slate-500">
                No warehouses are configured for this tenant yet. Contact support to set one up before using
                Warehouse operations.
              </p>
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
            as received. This step is optional — Pickup / Delivery works even if it&apos;s skipped, but scanning here
            gives you an expected-vs-actually-received reconciliation for this cargo.
          </p>
          <p className="mt-1">
            <AskAiLink question="How do I receive items at the destination warehouse and reconcile against a container's manifest?" />
          </p>
          <Card className="mt-3">
            {destinationWarehouses === null ? (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            ) : destinationWarehouses.length > 0 ? (
              <DestinationReceiveWorkspace
                warehouses={destinationWarehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                onReceived={reload}
              />
            ) : (
              <NoDestinationWarehouseMessage canManageWarehouses={canManageWarehouses} />
            )}
          </Card>
        </section>
      )}

      {mode === 'PICKUP_DELIVERY' && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Pickup / Delivery</h2>
          <p className="mt-1 text-sm text-slate-500">
            Scan an item to see what it&apos;s eligible for: an item that has arrived (whether or not it was
            individually destination-received) can be picked up in person or dispatched for delivery; an item
            already out for delivery can be confirmed delivered or returned after a failed attempt.
          </p>
          <Card className="mt-3">
            {destinationWarehouses === null ? (
              <p className="text-sm text-slate-500">Loading warehouses…</p>
            ) : destinationWarehouses.length > 0 ? (
              <PickupWorkspace
                warehouses={destinationWarehouses}
                selectedWarehouseId={selectedWarehouseId}
                onWarehouseChange={setSelectedWarehouseId}
                onPickedUp={reload}
              />
            ) : (
              <NoDestinationWarehouseMessage canManageWarehouses={canManageWarehouses} />
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
