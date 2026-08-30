'use client';

import { useState } from 'react';
import type { WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { deliverItem, dispatchItem, pickupItem, returnItem, scanItem, searchWarehouseItems } from '@/lib/warehouse';
import { ScanInput } from './ScanInput';

type ActionMode = 'PICKUP' | 'DISPATCH' | 'DELIVER' | 'RETURN' | null;

/**
 * The Warehouse -> Pickup / Delivery mode's unified handoff workspace —
 * Customer Pickup (Milestone: Pickup) and Delivery/Driver Dispatch
 * (Milestone: Delivery). One scan resolves the item; the available next
 * actions depend entirely on its current status, read straight off the
 * backend response, never re-derived client-side:
 *   - RECEIVED_DESTINATION_WAREHOUSE -> choose Customer Pickup or
 *     Dispatch for Delivery.
 *   - OUT_FOR_DELIVERY -> choose Confirm Delivered or Record Failed
 *     Attempt / Return to Warehouse.
 *   - anything else (PICKED_UP, DELIVERED, EXCEPTION, not yet received,
 *     ...) -> no actions, just an explanatory message.
 * Staff never scans the same package through two separate screens to
 * pick its fulfillment method — this is deliberately one workspace, not
 * PickupWorkspace + a parallel DeliveryWorkspace.
 *
 * Component name/file kept as PickupWorkspace (not renamed) to minimize
 * risk to the already-approved, already-tested Customer Pickup wiring in
 * ModeSelector/warehouse/page.tsx — a pure rename is safe follow-up work
 * if a more accurate name is wanted later, not bundled into this change.
 *
 * All four backend calls are the actual source of truth for eligibility
 * and the hard warehouse-match checks; this component only surfaces
 * whatever they say, never re-implements the business rules client-side.
 * Every confirm goes through window.confirm first, same hard-to-reverse-
 * action pattern already used elsewhere in this app (LoadContainerWorkspace's
 * finalize, ContainersPage's close-unloading, this component's own
 * Customer Pickup confirm).
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

  const [actionMode, setActionMode] = useState<ActionMode>(null);

  // Shared across Pickup/Dispatch/Deliver.
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientIdReference, setRecipientIdReference] = useState(''); // Pickup + Deliver only
  const [notes, setNotes] = useState('');

  // Dispatch + Deliver only. Free-text courier identification, not a
  // driver picker — see DispatchItemDto's own doc comment: the backend
  // also accepts a driverUserId (a real employee User), but this UI
  // deliberately only exposes the free-text path so it works identically
  // whether this tenant uses employee drivers, independent drivers, or a
  // third-party courier company with no application account at all.
  const [deliveryAddress, setDeliveryAddress] = useState(''); // Dispatch only
  const [courierName, setCourierName] = useState('');
  const [courierPhone, setCourierPhone] = useState('');
  const [courierReference, setCourierReference] = useState('');

  // Return only.
  const [failureReason, setFailureReason] = useState('');
  const [hasException, setHasException] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<WarehouseItemDetail[] | null>(null);
  const [manualSearching, setManualSearching] = useState(false);

  const canSubmitPickup = !!recipientName.trim() && !!selectedWarehouseId && !confirming;
  const canSubmitDispatch = !!recipientName.trim() && !!courierName.trim() && !!selectedWarehouseId && !confirming;
  const canSubmitDeliver = !!recipientName.trim() && !!selectedWarehouseId && !confirming;
  const canSubmitReturn = !!failureReason.trim() && !!selectedWarehouseId && !confirming;

  function resetForm() {
    setActionMode(null);
    setRecipientName('');
    setRecipientPhone('');
    setRecipientIdReference('');
    setNotes('');
    setDeliveryAddress('');
    setCourierName('');
    setCourierPhone('');
    setCourierReference('');
    setFailureReason('');
    setHasException(false);
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

  function handleCancel() {
    setResolvedItem(null);
    setScannedCode(undefined);
    resetForm();
    setRefocusKey((key) => key + 1);
  }

  function warehouseName(): string {
    return warehouses.find((warehouse) => warehouse.id === selectedWarehouseId)?.name ?? 'the selected warehouse';
  }

  async function handleConfirmPickup() {
    if (!resolvedItem || !canSubmitPickup) return;
    const confirmed = window.confirm(
      `Hand off ${resolvedItem.itemCode} (${resolvedItem.shipment.trackingNumber}) to ${recipientName.trim()} at ${warehouseName()}?\n\n` +
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
      handleCancel();
      onPickedUp();
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to record pickup.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleConfirmDispatch() {
    if (!resolvedItem || !canSubmitDispatch) return;
    const confirmed = window.confirm(
      `Dispatch ${resolvedItem.itemCode} (${resolvedItem.shipment.trackingNumber}) from ${warehouseName()} ` +
        `with ${courierName.trim()} for delivery to ${recipientName.trim()}?\n\n` +
        `This marks the item Out for Delivery and removes it from this warehouse's inventory.`,
    );
    if (!confirmed) return;

    setConfirming(true);
    try {
      await dispatchItem(resolvedItem.id, {
        warehouseId: selectedWarehouseId,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        courierName: courierName.trim() || undefined,
        courierPhone: courierPhone.trim() || undefined,
        courierReference: courierReference.trim() || undefined,
        notes: notes.trim() || undefined,
        scanned: !!scannedCode,
        scanIdentifier: scannedCode,
      });
      setSuccessMessage(`${resolvedItem.itemCode} dispatched with ${courierName.trim()} — ${resolvedItem.shipment.trackingNumber}`);
      handleCancel();
      onPickedUp();
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to dispatch item.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleConfirmDeliver() {
    if (!resolvedItem || !canSubmitDeliver) return;
    const confirmed = window.confirm(
      `Confirm ${resolvedItem.itemCode} (${resolvedItem.shipment.trackingNumber}) was delivered to ${recipientName.trim()}?\n\n` +
        `This marks the item Delivered and cannot be undone.`,
    );
    if (!confirmed) return;

    setConfirming(true);
    try {
      const updated = await deliverItem(resolvedItem.id, {
        warehouseId: selectedWarehouseId,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim() || undefined,
        recipientIdReference: recipientIdReference.trim() || undefined,
        courierName: courierName.trim() || undefined,
        courierPhone: courierPhone.trim() || undefined,
        courierReference: courierReference.trim() || undefined,
        notes: notes.trim() || undefined,
        scanned: !!scannedCode,
        scanIdentifier: scannedCode,
      });
      setSuccessMessage(`${resolvedItem.itemCode} delivered to ${recipientName.trim()} — ${updated.shipment.trackingNumber}`);
      handleCancel();
      onPickedUp();
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to confirm delivery.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleConfirmReturn() {
    if (!resolvedItem || !canSubmitReturn) return;
    const outcome = hasException ? 'held for staff review (exception)' : 'returned and eligible for a fresh dispatch or pickup';
    const confirmed = window.confirm(
      `Record a failed delivery attempt for ${resolvedItem.itemCode} (${resolvedItem.shipment.trackingNumber})?\n\n` +
        `Reason: ${failureReason.trim()}\nOutcome: this item will be ${outcome}.`,
    );
    if (!confirmed) return;

    setConfirming(true);
    try {
      const updated = await returnItem(resolvedItem.id, {
        warehouseId: selectedWarehouseId,
        failureReason: failureReason.trim(),
        hasException,
        notes: notes.trim() || undefined,
        scanned: !!scannedCode,
        scanIdentifier: scannedCode,
      });
      setSuccessMessage(
        hasException
          ? `${resolvedItem.itemCode} held for review — ${updated.shipment.trackingNumber}`
          : `${resolvedItem.itemCode} returned to ${warehouseName()} — eligible for a fresh dispatch or pickup`,
      );
      handleCancel();
      onPickedUp();
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to record the failed delivery attempt.');
    } finally {
      setConfirming(false);
    }
  }

  const isEligibleForPickupOrDispatch = resolvedItem?.status === 'RECEIVED_DESTINATION_WAREHOUSE';
  const isEligibleForDeliverOrReturn = resolvedItem?.status === 'OUT_FOR_DELIVERY';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <ScanInput
          onSubmit={handleScan}
          disabled={!selectedWarehouseId}
          autoFocusKey={refocusKey}
          placeholder="Scan or type a Received or Out-for-Delivery item's code, then press Enter"
        />
        <div className="sm:w-64">
          <label htmlFor="pickupWarehouse" className="sr-only">
            Pickup / Delivery warehouse
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
                {resolvedItem.currentWarehouse ? 'Currently at: ' : 'Current custody: '}
                <span className="font-medium text-slate-900">
                  {resolvedItem.currentWarehouse?.name ??
                    (resolvedItem.status === 'PICKED_UP'
                      ? 'Released to recipient'
                      : resolvedItem.status === 'DELIVERED'
                        ? 'Delivered to recipient'
                        : resolvedItem.status === 'OUT_FOR_DELIVERY'
                          ? 'Out for delivery'
                          : 'Unknown')}
                </span>
              </p>
            </div>
            <StatusBadge status={resolvedItem.status} />
          </div>

          {!isEligibleForPickupOrDispatch && !isEligibleForDeliverOrReturn && (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {resolvedItem.status === 'PICKED_UP' ? (
                'This item has already been picked up and cannot be picked up again.'
              ) : resolvedItem.status === 'DELIVERED' ? (
                'This item has already been delivered.'
              ) : (
                <>
                  This item is not eligible for pickup or delivery — its current status is{' '}
                  <span className="font-semibold">{resolvedItem.status}</span>. It must be received at the
                  destination warehouse first.
                </>
              )}
            </p>
          )}

          {/* Choice step: nothing picked yet. */}
          {actionMode === null && (isEligibleForPickupOrDispatch || isEligibleForDeliverOrReturn) && (
            <div className="mt-4 flex flex-wrap gap-3">
              {isEligibleForPickupOrDispatch && (
                <>
                  <Button type="button" onClick={() => setActionMode('PICKUP')}>
                    Customer Pickup
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setActionMode('DISPATCH')}>
                    Dispatch for Delivery
                  </Button>
                </>
              )}
              {isEligibleForDeliverOrReturn && (
                <>
                  <Button type="button" onClick={() => setActionMode('DELIVER')}>
                    Confirm Delivered
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setActionMode('RETURN')}>
                    Record Failed Attempt / Return to Warehouse
                  </Button>
                </>
              )}
            </div>
          )}

          {actionMode === 'PICKUP' && (
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
                <Button type="button" onClick={handleConfirmPickup} disabled={!canSubmitPickup}>
                  {confirming ? 'Saving…' : 'Confirm Pickup'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setActionMode(null)} disabled={confirming}>
                  Change action
                </Button>
                <Button type="button" variant="ghost" onClick={handleCancel} disabled={confirming}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {actionMode === 'DISPATCH' && (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="di-recipient-name">
                    Recipient name
                  </label>
                  <input
                    id="di-recipient-name"
                    type="text"
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="Who is this being delivered to?"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="di-recipient-phone">
                    Recipient phone <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="di-recipient-phone"
                    type="text"
                    value={recipientPhone}
                    onChange={(event) => setRecipientPhone(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="di-address">
                    Delivery address <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="di-address"
                    type="text"
                    value={deliveryAddress}
                    onChange={(event) => setDeliveryAddress(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="di-courier-name">
                    Driver / courier
                  </label>
                  <input
                    id="di-courier-name"
                    type="text"
                    value={courierName}
                    onChange={(event) => setCourierName(event.target.value)}
                    placeholder="Employee, independent driver, or courier company"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="di-courier-phone">
                    Driver / courier phone <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="di-courier-phone"
                    type="text"
                    value={courierPhone}
                    onChange={(event) => setCourierPhone(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="di-courier-ref">
                    Vehicle / waybill reference <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="di-courier-ref"
                    type="text"
                    value={courierReference}
                    onChange={(event) => setCourierReference(event.target.value)}
                    placeholder="e.g. plate number, third-party waybill number"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="di-notes">
                  Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="di-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div className="mt-5 flex gap-3">
                <Button type="button" onClick={handleConfirmDispatch} disabled={!canSubmitDispatch}>
                  {confirming ? 'Saving…' : 'Confirm Dispatch'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setActionMode(null)} disabled={confirming}>
                  Change action
                </Button>
                <Button type="button" variant="ghost" onClick={handleCancel} disabled={confirming}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {actionMode === 'DELIVER' && (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="dl-recipient-name">
                    Recipient name
                  </label>
                  <input
                    id="dl-recipient-name"
                    type="text"
                    value={recipientName}
                    onChange={(event) => setRecipientName(event.target.value)}
                    placeholder="Who actually received it?"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="dl-recipient-phone">
                    Recipient phone <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="dl-recipient-phone"
                    type="text"
                    value={recipientPhone}
                    onChange={(event) => setRecipientPhone(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="dl-recipient-id">
                    ID / reference <span className="font-normal normal-case text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="dl-recipient-id"
                    type="text"
                    value={recipientIdReference}
                    onChange={(event) => setRecipientIdReference(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="dl-courier-name">
                    Driver / courier <span className="font-normal normal-case text-slate-400">(optional — defaults to dispatch record)</span>
                  </label>
                  <input
                    id="dl-courier-name"
                    type="text"
                    value={courierName}
                    onChange={(event) => setCourierName(event.target.value)}
                    placeholder="Leave blank to use who it was dispatched with"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="dl-notes">
                  Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="dl-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div className="mt-5 flex gap-3">
                <Button type="button" onClick={handleConfirmDeliver} disabled={!canSubmitDeliver}>
                  {confirming ? 'Saving…' : 'Confirm Delivered'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setActionMode(null)} disabled={confirming}>
                  Change action
                </Button>
                <Button type="button" variant="ghost" onClick={handleCancel} disabled={confirming}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {actionMode === 'RETURN' && (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="rt-reason">
                    Failure reason
                  </label>
                  <input
                    id="rt-reason"
                    type="text"
                    value={failureReason}
                    onChange={(event) => setFailureReason(event.target.value)}
                    placeholder="e.g. recipient unavailable, wrong address, refused"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={hasException}
                    onChange={(event) => setHasException(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
                  />
                  Needs staff review (refused permanently, damaged, lost) — otherwise this item becomes eligible for
                  a fresh dispatch or a walk-in pickup immediately.
                </label>
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="rt-notes">
                  Notes <span className="font-normal normal-case text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="rt-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div className="mt-5 flex gap-3">
                <Button type="button" onClick={handleConfirmReturn} disabled={!canSubmitReturn}>
                  {confirming ? 'Saving…' : 'Confirm Return'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setActionMode(null)} disabled={confirming}>
                  Change action
                </Button>
                <Button type="button" variant="ghost" onClick={handleCancel} disabled={confirming}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {actionMode === null && !isEligibleForPickupOrDispatch && !isEligibleForDeliverOrReturn && (
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
