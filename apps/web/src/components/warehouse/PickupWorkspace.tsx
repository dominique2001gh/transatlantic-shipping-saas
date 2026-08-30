'use client';

import { useState } from 'react';
import type { WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { pickupItem, scanItem, searchWarehouseItems } from '@/lib/warehouse';
import { ScanInput } from './ScanInput';

/**
 * Customer Pickup (first half of the Pickup / Delivery mode — Delivery is
 * a later, separate milestone, see ModeSelector). Same scan-first /
 * manual-fallback shape every other warehouse mode already uses.
 *
 * Only eligible for items already RECEIVED_DESTINATION_WAREHOUSE — the
 * backend (WarehouseService.pickupItem) is the actual source of truth for
 * that and for the hard "must be at this exact warehouse" check; this
 * component just surfaces whatever it says, it does not re-implement the
 * eligibility rules client-side.
 *
 * The window.confirm before submitting mirrors the same pattern this
 * codebase already uses for other hard-to-reverse handoff actions
 * (LoadContainerWorkspace's finalize, ContainersPage's close-unloading) —
 * a deliberate pause so staff can't fat-finger the wrong recipient onto
 * the wrong package.
 */
export function PickupWorkspace({
  warehouses,
  selectedWarehouseId,
  onWarehouseChange,
  onPickedUp,
}: {
  warehouses: WarehouseSummary[];
  selectedWarehouseId: string;
  onWarehouseChange: (id: string) => void;
  onPickedUp: () => void;
}) {
  const [resolvedItem, setResolvedItem] = useState<WarehouseItemDetail | null>(null);
  const [scannedCode, setScannedCode] = useState<string | undefined>(undefined);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [refocusKey, setRefocusKey] = useState(0);

  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientIdReference, setRecipientIdReference] = useState('');
  const [notes, setNotes] = useState('');

  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<WarehouseItemDetail[] | null>(null);
  const [manualSearching, setManualSearching] = useState(false);

  const canSubmit = !!recipientName.trim() && !!selectedWarehouseId && !confirming;

  function resetForm() {
    setRecipientName('');
    setRecipientPhone('');
    setRecipientIdReference('');
    setNotes('');
  }

  async function handleScan(code: string) {
    setLookupError(null);
    setSuccessMessage(null);
    try {
      const item = await scanItem(code);
      setResolvedItem(item);
      setScannedCode(code);
      resetForm();
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
    resetForm();
  }

  async function handleConfirm() {
    if (!resolvedItem || !canSubmit) return;
    const warehouseName = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId)?.name ?? 'the selected warehouse';
    const confirmed = window.confirm(
      `Hand off ${resolvedItem.itemCode} (${resolvedItem.shipment.trackingNumber}) to ${recipientName.trim()} at ${warehouseName}?\n\n` +
        `This marks the item Picked Up and cannot be undone.`,
    );
    if (!confirmed) return;

    setConfirming(true);
    try {
      const updated = await pickupItem(resolvedItem.id, {
        warehouseId: selectedWarehouseId,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim() || undefined,
        recipientIdReference: recipientIdReference.trim() || undefined,
        notes: notes.trim() || undefined,
        scanned: !!scannedCode,
        scanIdentifier: scannedCode,
      });
      setSuccessMessage(`${resolvedItem.itemCode} picked up by ${recipientName.trim()} — ${updated.shipment.trackingNumber}`);
      setResolvedItem(null);
      setScannedCode(undefined);
      resetForm();
      setRefocusKey((key) => key + 1);
      onPickedUp();
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to record pickup.');
    } finally {
      setConfirming(false);
    }
  }

  function handleCancel() {
    setResolvedItem(null);
    setScannedCode(undefined);
    resetForm();
    setRefocusKey((key) => key + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <ScanInput
          onSubmit={handleScan}
          disabled={!selectedWarehouseId}
          autoFocusKey={refocusKey}
          placeholder="Scan or type a Received item's code, then press Enter"
        />
        <div className="sm:w-64">
          <label htmlFor="pickupWarehouse" className="sr-only">
            Pickup warehouse
          </label>
          <select
            id="pickupWarehouse"
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
        <div className="rounded-xl border-2 border-primary-200 bg-primary-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-lg font-semibold text-slate-900">{resolvedItem.itemCode}</p>
              <p className="mt-1 text-sm text-slate-600">
                Item {resolvedItem.sequenceNumber} · {resolvedItem.shipment.trackingNumber} ·{' '}
                {resolvedItem.shipment.customer.firstName} {resolvedItem.shipment.customer.lastName} (
                {resolvedItem.shipment.customer.customerNumber})
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Destination: {resolvedItem.shipment.destinationLocation ?? resolvedItem.shipment.destinationCountry}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {resolvedItem.status === 'PICKED_UP' ? 'Current custody: ' : 'Currently at: '}
                <span className="font-medium text-slate-900">
                  {resolvedItem.status === 'PICKED_UP'
                    ? 'Released to recipient'
                    : (resolvedItem.currentWarehouse?.name ?? 'Unknown')}
                </span>
              </p>
            </div>
            <StatusBadge status={resolvedItem.status} />
          </div>

          {resolvedItem.status === 'PICKED_UP' && (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This item has already been picked up and cannot be picked up again.
            </p>
          )}

          {resolvedItem.status !== 'RECEIVED_DESTINATION_WAREHOUSE' && resolvedItem.status !== 'PICKED_UP' && (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This item is not eligible for pickup — its current status is{' '}
              <span className="font-semibold">{resolvedItem.status}</span>. It must be received at the destination
              warehouse first.
            </p>
          )}

          {resolvedItem.status === 'RECEIVED_DESTINATION_WAREHOUSE' && (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="pu-recipient-name">
                    Recipient name
                  </label>
                  <input
                    id="pu-recipient-name"
                    type="text"
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="Who is picking this up?"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="pu-recipient-phone">
                    Recipient phone <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="pu-recipient-phone"
                    type="text"
                    value={recipientPhone}
                    onChange={(event) => setRecipientPhone(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="pu-recipient-id">
                    ID / reference <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="pu-recipient-id"
                    type="text"
                    value={recipientIdReference}
                    onChange={(event) => setRecipientIdReference(event.target.value)}
                    placeholder="e.g. driver's license number shown"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="pu-notes">
                  Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="pu-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div className="mt-5 flex gap-3">
                <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
                  {confirming ? 'Saving…' : 'Confirm Pickup'}
                </Button>
                <Button type="button" variant="ghost" onClick={handleCancel} disabled={confirming}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {resolvedItem.status !== 'RECEIVED_DESTINATION_WAREHOUSE' && (
            <div className="mt-5">
              <Button type="button" variant="ghost" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          )}
        </div>
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
              <label htmlFor="pickupManualSearchInput" className="sr-only">
                Search by item code, tracking number, or customer
              </label>
              <input
                id="pickupManualSearchInput"
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
                          {item.shipment.customer.lastName}
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
