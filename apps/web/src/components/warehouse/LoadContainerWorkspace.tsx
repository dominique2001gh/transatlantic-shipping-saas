'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContainerDetail, WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { ContainerType, UserRole } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { humanizeEnumValue } from '@/lib/format';
import {
  createContainer,
  finalizeContainer,
  getContainer,
  listContainers,
  loadItemIntoContainer,
  unloadItemFromContainer,
} from '@/lib/containers';
import { scanItem, searchWarehouseItems } from '@/lib/warehouse';
import { ContainerContentsList } from './ContainerContentsList';
import { ScanInput } from './ScanInput';

const CONTAINER_TYPES: ContainerType[] = Object.values(ContainerType);
const FINALIZE_ROLES = new Set<UserRole>([UserRole.TENANT_OWNER, UserRole.TENANT_ADMIN, UserRole.WAREHOUSE_MANAGER]);

/**
 * LOAD mode's full workflow: pick or book an open container at the
 * selected warehouse, then scan items into it. Item resolution reuses the
 * exact same `/warehouse/scan` lookup Receive/Process use — there is one
 * scanning implementation in this app, not a parallel one for containers.
 */
export function LoadContainerWorkspace({
  warehouses,
  selectedWarehouseId,
  onWarehouseChange,
}: {
  warehouses: WarehouseSummary[];
  selectedWarehouseId: string;
  onWarehouseChange: (id: string) => void;
}) {
  const [openContainers, setOpenContainers] = useState<ContainerDetail[] | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<ContainerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showNewContainerForm, setShowNewContainerForm] = useState(false);
  const [newContainerNumber, setNewContainerNumber] = useState('');
  const [newContainerType, setNewContainerType] = useState<ContainerType>(ContainerType.TWENTY_FT);
  const [creating, setCreating] = useState(false);

  const [lookupError, setLookupError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [refocusKey, setRefocusKey] = useState(0);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<WarehouseItemDetail[] | null>(null);
  const [manualSearching, setManualSearching] = useState(false);

  const currentUser = getStoredUser();
  const canFinalize = !!currentUser && FINALIZE_ROLES.has(currentUser.role);

  const reloadContainerList = useCallback(() => {
    if (!selectedWarehouseId) return;
    listContainers({ warehouseId: selectedWarehouseId })
      .then((containers) => setOpenContainers(containers.filter((c) => c.status === 'BOOKED' || c.status === 'LOADING')))
      .catch(() => setOpenContainers([]));
  }, [selectedWarehouseId]);

  useEffect(() => {
    setSelectedContainer(null);
    reloadContainerList();
  }, [reloadContainerList]);

  async function refreshSelectedContainer(id: string) {
    try {
      const container = await getContainer(id);
      setSelectedContainer(container);
    } catch {
      setSelectedContainer(null);
    }
  }

  async function handleCreateContainer() {
    if (!newContainerNumber.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const container = await createContainer({
        containerNumber: newContainerNumber.trim(),
        containerType: newContainerType,
        warehouseId: selectedWarehouseId,
      });
      setNewContainerNumber('');
      setShowNewContainerForm(false);
      setSelectedContainer(container);
      reloadContainerList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create container.');
    } finally {
      setCreating(false);
    }
  }

  async function loadResolvedItem(itemId: string, itemCode: string, scanned: boolean, scanIdentifier?: string) {
    if (!selectedContainer) return;
    setLookupError(null);
    setSuccessMessage(null);
    setLoadingItem(true);
    try {
      const updated = await loadItemIntoContainer(selectedContainer.id, itemId, { scanned, scanIdentifier });
      setSelectedContainer(updated);
      setSuccessMessage(
        updated.destinationWarning
          ? `${itemCode} loaded — ${updated.destinationWarning}`
          : `${itemCode} loaded into ${updated.containerNumber}`,
      );
      reloadContainerList();
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to load item.');
    } finally {
      setLoadingItem(false);
      setRefocusKey((key) => key + 1);
    }
  }

  async function handleScan(code: string) {
    setLookupError(null);
    try {
      const item = await scanItem(code);
      await loadResolvedItem(item.id, item.itemCode, true, code);
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Lookup failed.');
      setRefocusKey((key) => key + 1);
    }
  }

  async function handleManualSearch() {
    if (!manualQuery.trim()) return;
    setManualSearching(true);
    try {
      const results = await searchWarehouseItems(manualQuery);
      setManualResults(results);
    } catch {
      setManualResults([]);
    } finally {
      setManualSearching(false);
    }
  }

  async function selectManualItem(item: WarehouseItemDetail) {
    setManualOpen(false);
    setManualResults(null);
    setManualQuery('');
    await loadResolvedItem(item.id, item.itemCode, false);
  }

  async function handleRemove(itemId: string) {
    if (!selectedContainer) return;
    setRemovingItemId(itemId);
    setError(null);
    try {
      const updated = await unloadItemFromContainer(selectedContainer.id, itemId);
      setSelectedContainer(updated);
      reloadContainerList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove item.');
    } finally {
      setRemovingItemId(null);
    }
  }

  async function handleFinalize() {
    if (!selectedContainer) return;
    if (!window.confirm(`Finalize and seal container ${selectedContainer.containerNumber}? This cannot be undone.`)) {
      return;
    }
    setFinalizing(true);
    setError(null);
    try {
      const updated = await finalizeContainer(selectedContainer.id);
      setSelectedContainer(updated);
      reloadContainerList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to finalize container.');
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <div className="sm:w-64">
          <label htmlFor="loadWarehouse" className="sr-only">
            Loading warehouse
          </label>
          <select
            id="loadWarehouse"
            value={selectedWarehouseId}
            onChange={(event) => onWarehouseChange(event.target.value)}
            className="h-full w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name} ({warehouse.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Container picker */}
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Open containers at this warehouse</h3>
          <Button type="button" size="sm" variant="secondary" onClick={() => setShowNewContainerForm((open) => !open)}>
            {showNewContainerForm ? 'Cancel' : 'Book new container'}
          </Button>
        </div>

        {showNewContainerForm && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md bg-slate-50 p-3">
            <div>
              <label htmlFor="newContainerNumber" className="text-xs font-medium text-slate-600">
                Container number
              </label>
              <input
                id="newContainerNumber"
                value={newContainerNumber}
                onChange={(event) => setNewContainerNumber(event.target.value)}
                placeholder="e.g. MSCU1234567"
                className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="newContainerType" className="text-xs font-medium text-slate-600">
                Type
              </label>
              <select
                id="newContainerType"
                value={newContainerType}
                onChange={(event) => setNewContainerType(event.target.value as ContainerType)}
                className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {CONTAINER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" size="sm" onClick={handleCreateContainer} disabled={creating || !newContainerNumber.trim()}>
              {creating ? 'Booking…' : 'Book container'}
            </Button>
          </div>
        )}

        <ul className="mt-3 flex flex-col divide-y divide-slate-100">
          {openContainers === null && <li className="py-3 text-sm text-slate-500">Loading…</li>}
          {openContainers?.length === 0 && (
            <li className="py-3 text-sm text-slate-500">No open containers at this warehouse yet.</li>
          )}
          {openContainers?.map((container) => (
            <li key={container.id}>
              <button
                type="button"
                onClick={() => refreshSelectedContainer(container.id)}
                className={`flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:bg-slate-50 ${
                  selectedContainer?.id === container.id ? 'font-semibold text-primary-700' : ''
                }`}
              >
                <span>
                  {container.containerNumber} · {container.summary.itemCount} item
                  {container.summary.itemCount === 1 ? '' : 's'}
                </span>
                <StatusBadge status={container.status} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Selected container: scan-to-load + contents */}
      {selectedContainer && (
        <div className="rounded-xl border-2 border-primary-200 bg-primary-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-900">{selectedContainer.containerNumber}</p>
              <p className="text-sm text-slate-600">
                {selectedContainer.containerType.replace(/_/g, ' ')}
                {selectedContainer.sealNumber ? ` · Seal ${selectedContainer.sealNumber}` : ''}
              </p>
            </div>
            <StatusBadge status={selectedContainer.status} />
          </div>

          {(selectedContainer.status === 'BOOKED' || selectedContainer.status === 'LOADING') && (
            <div className="mt-4">
              <ScanInput
                onSubmit={handleScan}
                disabled={loadingItem}
                autoFocusKey={refocusKey}
                placeholder="Scan or type a Ready item's code, then press Enter"
              />
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setManualOpen((open) => !open)}
                  className="text-sm font-medium text-primary-700 hover:text-primary-800"
                >
                  {manualOpen ? 'Hide manual search' : "Can't scan? Search manually"}
                </button>
                {manualOpen && (
                  <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
                    <div className="flex gap-2">
                      <label htmlFor="loadManualSearchInput" className="sr-only">
                        Search by item code, tracking number, or customer
                      </label>
                      <input
                        id="loadManualSearchInput"
                        type="text"
                        placeholder="Item code, tracking number, or customer name…"
                        value={manualQuery}
                        onChange={(event) => setManualQuery(event.target.value)}
                        onKeyDown={(event) => event.key === 'Enter' && handleManualSearch()}
                        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                      <Button type="button" variant="secondary" onClick={handleManualSearch} disabled={manualSearching}>
                        {manualSearching ? 'Searching…' : 'Search'}
                      </Button>
                    </div>
                    {manualResults && (
                      <ul className="flex flex-col divide-y divide-slate-100">
                        {manualResults.length === 0 && <li className="py-3 text-sm text-slate-500">No matching items.</li>}
                        {manualResults.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => selectManualItem(item)}
                              className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:bg-slate-50"
                            >
                              <span>
                                <span className="font-mono font-medium text-slate-900">{item.itemCode}</span>{' '}
                                <span className="text-slate-500">
                                  — {item.shipment.trackingNumber} · {item.shipment.customer.firstName}{' '}
                                  {item.shipment.customer.lastName} · {humanizeEnumValue(item.status)}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs font-medium text-primary-700">Select</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {successMessage && (
            <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {successMessage}
            </p>
          )}
          {lookupError && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {lookupError}
            </p>
          )}

          <div className="mt-4">
            <ContainerContentsList container={selectedContainer} onRemove={handleRemove} removing={removingItemId} />
          </div>

          {selectedContainer.status === 'LOADING' && (
            <div className="mt-5">
              {canFinalize ? (
                <Button type="button" onClick={handleFinalize} disabled={finalizing}>
                  {finalizing ? 'Finalizing…' : 'Finalize / Seal Container'}
                </Button>
              ) : (
                <p className="text-sm text-slate-500">Only a warehouse manager or admin can finalize this container.</p>
              )}
            </div>
          )}

          {selectedContainer.status === 'LOADED' && (
            <p className="mt-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              This container is finalized and sealed — its contents are locked.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
