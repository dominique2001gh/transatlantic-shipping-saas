'use client';

import { useState } from 'react';
import { ShipmentItemStatus } from '@transatlantic/shared';
import type { WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { humanizeEnumValue } from '@/lib/format';
import { processItem, scanItem, searchWarehouseItems, type ProcessItemInput } from '@/lib/warehouse';
import { AlreadyProcessedSummary } from './AlreadyProcessedSummary';
import { InspectionForm } from './InspectionForm';
import { ScanInput } from './ScanInput';

/**
 * PROCESS mode's full workflow. Reuses the exact same scan/manual-search
 * resolution path as ReceiveWorkspace (same ScanInput, same
 * scanItem/searchWarehouseItems calls) — there is exactly one barcode/QR
 * scanning implementation in this app, RECEIVE and PROCESS both sit on
 * top of it.
 */
export function ProcessWorkspace({
  warehouses,
  selectedWarehouseId,
  onWarehouseChange,
  onProcessed,
}: {
  warehouses: WarehouseSummary[];
  selectedWarehouseId: string;
  onWarehouseChange: (id: string) => void;
  onProcessed: () => void;
}) {
  const [resolvedItem, setResolvedItem] = useState<WarehouseItemDetail | null>(null);
  const [scannedCode, setScannedCode] = useState<string | undefined>(undefined);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reinspecting, setReinspecting] = useState(false);
  const [refocusKey, setRefocusKey] = useState(0);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<WarehouseItemDetail[] | null>(null);
  const [manualSearching, setManualSearching] = useState(false);

  function resetResolution() {
    setResolvedItem(null);
    setScannedCode(undefined);
    setReinspecting(false);
    setSubmitError(null);
    setRefocusKey((key) => key + 1);
  }

  async function handleScan(code: string) {
    setLookupError(null);
    setSuccessMessage(null);
    try {
      const item = await scanItem(code);
      setResolvedItem(item);
      setScannedCode(code);
      setReinspecting(false);
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
    setReinspecting(false);
    setManualOpen(false);
    setManualResults(null);
    setManualQuery('');
    setLookupError(null);
    setSuccessMessage(null);
  }

  async function handleSubmit(input: ProcessItemInput) {
    if (!resolvedItem) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const processed = await processItem(resolvedItem.id, input);
      setSuccessMessage(
        `${processed.itemCode} — ${processed.status === ShipmentItemStatus.PROCESSED ? 'marked ready' : 'placed on hold'} (${processed.shipment.trackingNumber})`,
      );
      resetResolution();
      onProcessed();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Failed to save inspection.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <ScanInput onSubmit={handleScan} disabled={!selectedWarehouseId} autoFocusKey={refocusKey} />
        <div className="sm:w-64">
          <label htmlFor="processWarehouse" className="sr-only">
            Processing warehouse
          </label>
          <select
            id="processWarehouse"
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

      {resolvedItem && resolvedItem.status === ShipmentItemStatus.REGISTERED && (
        <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-5">
          <p className="text-sm font-medium text-slate-700">
            <span className="font-mono">{resolvedItem.itemCode}</span> hasn&apos;t been received at a warehouse yet.
            Receive it first, then it will be eligible for processing.
          </p>
          <Button type="button" variant="ghost" className="mt-3" onClick={resetResolution}>
            Dismiss
          </Button>
        </div>
      )}

      {resolvedItem && resolvedItem.status === ShipmentItemStatus.RECEIVED_ORIGIN_WAREHOUSE && (
        <InspectionForm
          item={resolvedItem}
          warehouseId={selectedWarehouseId}
          scannedCode={scannedCode}
          reinspection={false}
          onSubmit={handleSubmit}
          onCancel={resetResolution}
          submitting={submitting}
          errorMessage={submitError}
        />
      )}

      {resolvedItem &&
        (resolvedItem.status === ShipmentItemStatus.PROCESSED || resolvedItem.status === ShipmentItemStatus.EXCEPTION) &&
        !reinspecting && (
          <AlreadyProcessedSummary item={resolvedItem} onReinspect={() => setReinspecting(true)} />
        )}

      {resolvedItem &&
        (resolvedItem.status === ShipmentItemStatus.PROCESSED || resolvedItem.status === ShipmentItemStatus.EXCEPTION) &&
        reinspecting && (
          <InspectionForm
            item={resolvedItem}
            warehouseId={selectedWarehouseId}
            scannedCode={scannedCode}
            reinspection={true}
            onSubmit={handleSubmit}
            onCancel={() => setReinspecting(false)}
            submitting={submitting}
            errorMessage={submitError}
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
              <label htmlFor="processManualSearchInput" className="sr-only">
                Search by item code, tracking number, or customer
              </label>
              <input
                id="processManualSearchInput"
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
                          {item.shipment.customer.lastName} · {humanizeEnumValue(item.itemType)} ·{' '}
                          {humanizeEnumValue(item.status)}
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
