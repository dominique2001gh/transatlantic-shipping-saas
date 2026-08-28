'use client';

import { useState } from 'react';
import type { WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { humanizeEnumValue } from '@/lib/format';
import { receiveItem, scanItem, searchWarehouseItems } from '@/lib/warehouse';
import { ItemConfirmPanel } from './ItemConfirmPanel';
import { ScanInput } from './ScanInput';

/**
 * RECEIVE mode's full workflow: scan (fast path) or manual search
 * (fallback) both resolve to the same ItemConfirmPanel and the same
 * `receiveItem` call — there is exactly one receiving implementation.
 */
export function ReceiveWorkspace({
  warehouses,
  selectedWarehouseId,
  onWarehouseChange,
  onReceived,
}: {
  warehouses: WarehouseSummary[];
  selectedWarehouseId: string;
  onWarehouseChange: (id: string) => void;
  onReceived: () => void;
}) {
  const [resolvedItem, setResolvedItem] = useState<WarehouseItemDetail | null>(null);
  const [scannedCode, setScannedCode] = useState<string | undefined>(undefined);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [refocusKey, setRefocusKey] = useState(0);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<WarehouseItemDetail[] | null>(null);
  const [manualSearching, setManualSearching] = useState(false);

  async function handleScan(code: string) {
    setLookupError(null);
    setSuccessMessage(null);
    try {
      const item = await scanItem(code);
      setResolvedItem(item);
      setScannedCode(code);
    } catch (err) {
      setResolvedItem(null);
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

  function selectManualItem(item: WarehouseItemDetail) {
    setResolvedItem(item);
    setScannedCode(undefined);
    setManualOpen(false);
    setManualResults(null);
    setManualQuery('');
    setLookupError(null);
    setSuccessMessage(null);
  }

  async function handleConfirm() {
    if (!resolvedItem || !selectedWarehouseId) return;
    setConfirming(true);
    try {
      await receiveItem(resolvedItem.id, {
        warehouseId: selectedWarehouseId,
        scanned: !!scannedCode,
        scanIdentifier: scannedCode,
      });
      setSuccessMessage(`Received ${resolvedItem.itemCode} — ${resolvedItem.shipment.trackingNumber}`);
      setResolvedItem(null);
      setScannedCode(undefined);
      setRefocusKey((key) => key + 1);
      onReceived();
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to receive item.');
    } finally {
      setConfirming(false);
    }
  }

  function handleCancel() {
    setResolvedItem(null);
    setScannedCode(undefined);
    setRefocusKey((key) => key + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <ScanInput onSubmit={handleScan} disabled={!selectedWarehouseId} autoFocusKey={refocusKey} />
        <div className="sm:w-64">
          <label htmlFor="receiveWarehouse" className="sr-only">
            Receiving warehouse
          </label>
          <select
            id="receiveWarehouse"
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

      {successMessage && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}
      {lookupError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {lookupError}
        </p>
      )}

      {resolvedItem && (
        <ItemConfirmPanel
          item={resolvedItem}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          confirming={confirming}
        />
      )}

      <div>
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
              <label htmlFor="manualSearchInput" className="sr-only">
                Search by item code, tracking number, or customer
              </label>
              <input
                id="manualSearchInput"
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
                          {item.shipment.customer.lastName} · {humanizeEnumValue(item.itemType)}
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
  );
}
