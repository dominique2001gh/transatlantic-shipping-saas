'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ManifestDetail, WarehouseSummary } from '@transatlantic/shared';
import { ManifestStatus, ShipmentMode, UserRole } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { CreateManifestForm } from '@/components/manifests/CreateManifestForm';
import { ManifestContainerAssignment } from '@/components/manifests/ManifestContainerAssignment';
import { ManifestItemAssignment } from '@/components/manifests/ManifestItemAssignment';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';
import { arriveManifest, departManifest, finalizeManifest, getManifest, listManifests } from '@/lib/manifests';
import { listWarehouseLocations } from '@/lib/warehouse';

/** Same role sets ManifestsController enforces server-side — see manifests.controller.ts. */
const OPERATIONS_ROLES = new Set<UserRole>([
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
  UserRole.CUSTOMER_SERVICE,
]);
const VIEW_ROLES = new Set<UserRole>([...OPERATIONS_ROLES, UserRole.ACCOUNTANT, UserRole.DESTINATION_AGENT]);
const WAREHOUSE_ROLES = new Set<UserRole>([
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
]);
const FINALIZE_ROLES = new Set<UserRole>([UserRole.TENANT_OWNER, UserRole.TENANT_ADMIN, UserRole.WAREHOUSE_MANAGER]);
const DEPART_ROLES = FINALIZE_ROLES;
/** Milestone 3F: marking a movement arrived is exactly the action DESTINATION_AGENT exists for — additive only. */
const ARRIVE_ROLES = new Set<UserRole>([...FINALIZE_ROLES, UserRole.DESTINATION_AGENT]);

const OCEAN_MODES = new Set<ShipmentMode>([ShipmentMode.OCEAN_LCL, ShipmentMode.OCEAN_FCL, ShipmentMode.RORO]);

const STATUS_FILTERS = ['ALL', ...Object.values(ManifestStatus)] as const;

export default function ManifestsPage() {
  const currentUser = getStoredUser();
  const canView = !!currentUser && VIEW_ROLES.has(currentUser.role);
  const canCreate = !!currentUser && OPERATIONS_ROLES.has(currentUser.role);
  const canAssignContainer = !!currentUser && OPERATIONS_ROLES.has(currentUser.role);
  const canAssignItem = !!currentUser && WAREHOUSE_ROLES.has(currentUser.role);
  const canFinalize = !!currentUser && FINALIZE_ROLES.has(currentUser.role);
  const canDepart = !!currentUser && DEPART_ROLES.has(currentUser.role);
  const canArrive = !!currentUser && ARRIVE_ROLES.has(currentUser.role);

  const [manifests, setManifests] = useState<ManifestDetail[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [arriving, setArriving] = useState(false);

  const reload = useCallback(() => {
    if (!canView) return;
    listManifests(statusFilter === 'ALL' ? undefined : { status: statusFilter })
      .then(setManifests)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load manifests.'));
  }, [statusFilter, canView]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!canView) return;
    listWarehouseLocations()
      .then(setWarehouses)
      .catch(() => setWarehouses([]));
  }, [canView]);

  const selected = manifests?.find((m) => m.id === selectedId) ?? null;

  function applyUpdate(updated: ManifestDetail) {
    setManifests((prev) => (prev ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev));
  }

  async function refreshSelected() {
    if (!selectedId) return;
    try {
      const fresh = await getManifest(selectedId);
      applyUpdate(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to refresh manifest.');
    }
  }

  async function handleFinalize() {
    if (!selected) return;
    if (
      !window.confirm(
        `Finalize manifest ${selected.manifestNumber}? Assignments will be locked and can no longer be changed.`,
      )
    ) {
      return;
    }
    setFinalizing(true);
    setError(null);
    try {
      await finalizeManifest(selected.id);
      await refreshSelected();
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to finalize manifest.');
    } finally {
      setFinalizing(false);
    }
  }

  async function handleDepart() {
    if (!selected) return;
    if (
      !window.confirm(
        `Mark manifest ${selected.manifestNumber} as departed? This reflects real, physical movement and cannot be undone.`,
      )
    ) {
      return;
    }
    setDeparting(true);
    setError(null);
    try {
      await departManifest(selected.id);
      await refreshSelected();
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to depart manifest.');
    } finally {
      setDeparting(false);
    }
  }

  async function handleArrive() {
    if (!selected) return;
    if (
      !window.confirm(
        `Mark manifest ${selected.manifestNumber} as arrived? This means the cargo has physically landed at ` +
          `destination — it does NOT mark individual items as received. Staff will still scan each package in ` +
          `separately under Warehouse → Destination Receive.`,
      )
    ) {
      return;
    }
    setArriving(true);
    setError(null);
    try {
      await arriveManifest(selected.id);
      await refreshSelected();
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark manifest arrived.');
    } finally {
      setArriving(false);
    }
  }

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Manifests</h1>
        </div>
        <Card>
          <p className="text-sm text-slate-600">Your role does not have access to manifests.</p>
        </Card>
      </div>
    );
  }

  const isOcean = selected ? OCEAN_MODES.has(selected.shipmentMode) : false;
  const isDraft = selected?.status === ManifestStatus.DRAFT;
  const weightSummary = selected
    ? Object.entries(selected.summary.weightByUnit)
        .map(([unit, total]) => `${total} ${unit}`)
        .join(' + ')
    : '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Manifests</h1>
          <p className="mt-1 text-sm text-slate-500">
            Build Ocean/RoRo manifests from sealed containers, or Air manifests from Processed items. Finalize to lock,
            then depart once cargo has physically left.
          </p>
        </div>
        {canCreate && !showCreateForm && (
          <Button type="button" onClick={() => setShowCreateForm(true)}>
            New manifest
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showCreateForm && (
        <CreateManifestForm
          warehouses={warehouses}
          onCreated={(manifest) => {
            setShowCreateForm(false);
            reload();
            setSelectedId(manifest.id);
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === status
                ? 'bg-primary-700 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {status === 'ALL' ? 'All' : humanizeEnumValue(status)}
          </button>
        ))}
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Manifest #</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Origin Warehouse</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Containers</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Weight</th>
                <th className="px-4 py-3 font-medium">Movement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {manifests === null && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {manifests?.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">
                    No manifests yet.
                  </td>
                </tr>
              )}
              {manifests?.map((manifest) => {
                const rowWeight = Object.entries(manifest.summary.weightByUnit)
                  .map(([unit, total]) => `${total} ${unit}`)
                  .join(' + ');
                return (
                  <tr
                    key={manifest.id}
                    onClick={() => setSelectedId(manifest.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${selectedId === manifest.id ? 'bg-primary-50/60' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">{manifest.manifestNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{humanizeEnumValue(manifest.shipmentMode)}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {manifest.route
                        ? manifest.route.name
                        : manifest.destinationLocation
                          ? `${manifest.originLocation ?? '—'} → ${manifest.destinationLocation}`
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{manifest.originWarehouse?.code ?? '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={manifest.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{manifest.summary.containerCount}</td>
                    <td className="px-4 py-3 text-slate-600">{manifest.summary.itemCount}</td>
                    <td className="px-4 py-3 text-slate-500">{rowWeight || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {manifest.arrivedAt
                        ? `Arrived ${formatDateTime(manifest.arrivedAt)}`
                        : manifest.departedAt
                          ? `Departed ${formatDateTime(manifest.departedAt)}`
                          : manifest.plannedDepartureAt
                            ? `Planned ${formatDateTime(manifest.plannedDepartureAt)}`
                            : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-900">{selected.manifestNumber}</p>
              <p className="text-sm text-slate-600">
                {humanizeEnumValue(selected.shipmentMode)}
                {selected.carrierName ? ` · ${selected.carrierName}` : ''}
                {isOcean && selected.vesselName ? ` · ${selected.vesselName}${selected.voyageNumber ? ` (${selected.voyageNumber})` : ''}` : ''}
                {!isOcean && selected.flightNumber ? ` · Flight ${selected.flightNumber}` : ''}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {selected.originWarehouse ? `${selected.originWarehouse.name} (${selected.originWarehouse.code})` : selected.originLocation ?? '—'}
                {' → '}
                {selected.destinationLocation ?? selected.route?.name ?? '—'}
              </p>
            </div>
            <StatusBadge status={selected.status} />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <span>
              <strong className="text-slate-900">{selected.summary.containerCount}</strong> container
              {selected.summary.containerCount === 1 ? '' : 's'}
            </span>
            <span>
              <strong className="text-slate-900">{selected.summary.itemCount}</strong> item
              {selected.summary.itemCount === 1 ? '' : 's'}
            </span>
            <span>
              <strong className="text-slate-900">{selected.summary.customerCount}</strong> customer
              {selected.summary.customerCount === 1 ? '' : 's'}
            </span>
            {weightSummary && (
              <span>
                <strong className="text-slate-900">{weightSummary}</strong> total weight
              </span>
            )}
            {selected.plannedDepartureAt && <span>Planned departure: {formatDateTime(selected.plannedDepartureAt)}</span>}
            {selected.estimatedArrivalAt && <span>Estimated arrival: {formatDateTime(selected.estimatedArrivalAt)}</span>}
          </div>

          {selected.status === ManifestStatus.FINALIZED && (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              This manifest is finalized — assignments are locked. Finalized{' '}
              {selected.finalizedAt ? formatDateTime(selected.finalizedAt) : ''}
              {selected.finalizedByUser ? ` by ${selected.finalizedByUser.firstName} ${selected.finalizedByUser.lastName}` : ''}.
            </p>
          )}
          {selected.status === ManifestStatus.DEPARTED && (
            <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              This manifest has departed. Departed {selected.departedAt ? formatDateTime(selected.departedAt) : ''}
              {selected.departedByUser ? ` by ${selected.departedByUser.firstName} ${selected.departedByUser.lastName}` : ''}.
            </p>
          )}
          {selected.status === ManifestStatus.ARRIVED && (
            <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              This manifest has arrived at destination. Arrived {selected.arrivedAt ? formatDateTime(selected.arrivedAt) : ''}
              {selected.arrivedByUser ? ` by ${selected.arrivedByUser.firstName} ${selected.arrivedByUser.lastName}` : ''}.
              Individual packages still need to be scanned in under Warehouse → Destination Receive — arriving the
              manifest does not mark any item as received.
            </p>
          )}

          <div className="mt-5">
            {isOcean ? (
              <ManifestContainerAssignment manifest={selected} onUpdated={applyUpdate} canModify={canAssignContainer && isDraft} />
            ) : (
              <ManifestItemAssignment manifest={selected} onUpdated={applyUpdate} canModify={canAssignItem && isDraft} />
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {selected.status === ManifestStatus.DRAFT &&
              (canFinalize ? (
                <Button type="button" onClick={handleFinalize} disabled={finalizing}>
                  {finalizing ? 'Finalizing…' : 'Finalize manifest'}
                </Button>
              ) : (
                <p className="text-sm text-slate-500">Only a warehouse manager or admin can finalize this manifest.</p>
              ))}
            {selected.status === ManifestStatus.FINALIZED &&
              (canDepart ? (
                <Button type="button" onClick={handleDepart} disabled={departing}>
                  {departing ? 'Departing…' : 'Mark as departed'}
                </Button>
              ) : (
                <p className="text-sm text-slate-500">Only a warehouse manager or admin can depart this manifest.</p>
              ))}
            {selected.status === ManifestStatus.DEPARTED &&
              (canArrive ? (
                <Button type="button" onClick={handleArrive} disabled={arriving}>
                  {arriving ? 'Marking arrived…' : 'Mark as arrived'}
                </Button>
              ) : (
                <p className="text-sm text-slate-500">
                  Only a warehouse manager, admin, or destination agent can mark this manifest arrived.
                </p>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
