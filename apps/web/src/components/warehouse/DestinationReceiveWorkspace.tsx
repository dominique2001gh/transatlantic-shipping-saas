'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContainerDetail, WarehouseItemDetail, WarehouseSummary } from '@transatlantic/shared';
import { ShipmentItemCondition } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { getContainer, listContainers } from '@/lib/containers';
import { humanizeEnumValue } from '@/lib/format';
import { destinationReceiveItem, scanItem, searchWarehouseItems } from '@/lib/warehouse';
import { ScanInput } from './ScanInput';
import { ScanSessionStats } from './ScanSessionStats';

const CONDITION_OPTIONS = Object.values(ShipmentItemCondition);
/** A container is destination-floor-relevant once it has physically arrived and until it's closed out — matches the status filter options on /dashboard/containers. */
const RECONCILABLE_STATUSES = ['ARRIVED', 'UNLOADING'];

/**
 * DESTINATION_RECEIVE mode's full workflow (Milestone 3F): scan (fast
 * path) or manual search (fallback), same lookup mechanism every other
 * mode already uses, resolving to a lightweight condition/exception
 * confirm step — deliberately no weight/dimension remeasurement, unlike
 * InspectionForm. A damaged or flagged item is locked to "Flag Exception"
 * the same way InspectionForm locks a damaged item to Hold: it can never
 * be marked received in the same action that flags it.
 *
 * CRITICAL: this only ever sets RECEIVED_DESTINATION_WAREHOUSE — it
 * never implies Ready for Pickup/Delivery, which is a separate, later
 * milestone with its own reconciliation/hold/business-rule gate.
 *
 * Phase 3 (hardware acceptance testing) adds two things on top, both
 * additive:
 *   - An opt-in "Rapid Scan" toggle (same shape as ReceiveWorkspace's) for
 *     the common no-exception case — commits GOOD/no-exception instantly
 *     on scan, no confirm click, so a real 2D scanner can run continuously.
 *   - An optional "reconcile against a container" picker. Container.items
 *     (loaded on that container) plus each ShipmentItem's live `status`
 *     already fully describe "expected vs received vs outstanding" — see
 *     ContainerDestinationSummary, already computed server-side and
 *     already surfaced on /dashboard/containers — so this reuses that
 *     exact data (GET /containers/:id) rather than adding a parallel
 *     reconciliation model. Picking a container just adds a client-side
 *     manifest-membership check (warn, never hard-block — the container
 *     might legitimately be the wrong pick) and re-fetches that
 *     container's live counts after each destination-receive.
 */
export function DestinationReceiveWorkspace({
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
  const [manifestWarning, setManifestWarning] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [refocusKey, setRefocusKey] = useState(0);

  const [condition, setCondition] = useState<ShipmentItemCondition>(ShipmentItemCondition.GOOD);
  const [hasException, setHasException] = useState(false);
  const [exceptionDescription, setExceptionDescription] = useState('');
  const [notes, setNotes] = useState('');

  const [rapidMode, setRapidMode] = useState(false);
  const [stats, setStats] = useState({ succeeded: 0, duplicates: 0, errors: 0 });
  const receivedCodesRef = useRef<Set<string>>(new Set());

  const [reconcileContainers, setReconcileContainers] = useState<ContainerDetail[] | null>(null);
  const [reconcileContainerId, setReconcileContainerId] = useState('');
  const [reconcileContainer, setReconcileContainer] = useState<ContainerDetail | null>(null);
  const expectedCodesRef = useRef<Set<string>>(new Set());

  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<WarehouseItemDetail[] | null>(null);
  const [manualSearching, setManualSearching] = useState(false);

  // CRITICAL STATUS RULE: mirrors InspectionForm — a damaged or flagged
  // item can never be marked received in the same action that flags it.
  const isException = hasException || condition === ShipmentItemCondition.DAMAGED;
  const exceptionDescriptionMissing = hasException && !exceptionDescription.trim();
  const canSubmit = !exceptionDescriptionMissing && !!selectedWarehouseId && !confirming;

  useEffect(() => {
    Promise.all(RECONCILABLE_STATUSES.map((status) => listContainers({ status })))
      .then((results) => setReconcileContainers(results.flat()))
      .catch(() => setReconcileContainers([]));
  }, []);

  useEffect(() => {
    if (!reconcileContainerId) {
      setReconcileContainer(null);
      expectedCodesRef.current = new Set();
      return;
    }
    getContainer(reconcileContainerId)
      .then((container) => {
        setReconcileContainer(container);
        expectedCodesRef.current = new Set(container.items.map((item) => item.shipmentItem.itemCode));
      })
      .catch(() => setReconcileContainer(null));
  }, [reconcileContainerId]);

  function refreshReconcileContainer() {
    if (!reconcileContainerId) return;
    getContainer(reconcileContainerId)
      .then(setReconcileContainer)
      .catch(() => undefined);
  }

  function resetForm() {
    setCondition(ShipmentItemCondition.GOOD);
    setHasException(false);
    setExceptionDescription('');
    setNotes('');
  }

  /** Shared by Rapid Scan's auto-commit and the manual "Confirm Received"/"Flag Exception" click — one destination-receiving implementation, two ways to trigger it. */
  async function commitDestinationReceive(
    item: WarehouseItemDetail,
    code: string | undefined,
    input: { condition: ShipmentItemCondition; hasException: boolean; exceptionDescription?: string; notes?: string },
  ) {
    const updated = await destinationReceiveItem(item.id, {
      warehouseId: selectedWarehouseId,
      condition: input.condition,
      hasException: input.hasException,
      exceptionDescription: input.hasException ? input.exceptionDescription?.trim() : undefined,
      notes: input.notes?.trim() || undefined,
      scanned: !!code,
      scanIdentifier: code,
    });
    if (code) receivedCodesRef.current.add(code);
    setSuccessMessage(
      updated.destinationWarning
        ? `${item.itemCode} — ${updated.status === 'EXCEPTION' ? 'flagged' : 'received'} — ${updated.destinationWarning}`
        : updated.status === 'EXCEPTION'
          ? `${item.itemCode} flagged — held for review, not marked received.`
          : `${item.itemCode} received at destination — ${item.shipment.trackingNumber}`,
    );
    setStats((s) => ({ ...s, succeeded: s.succeeded + 1 }));
    refreshReconcileContainer();
    onReceived();
  }

  function checkManifestMembership(itemCode: string): string | null {
    if (!reconcileContainerId || expectedCodesRef.current.size === 0) return null;
    if (expectedCodesRef.current.has(itemCode)) return null;
    return `${itemCode} is not on the manifest for ${reconcileContainer?.containerNumber ?? 'this container'} — check you picked the right container.`;
  }

  async function handleScan(code: string) {
    setLookupError(null);
    setSuccessMessage(null);
    setManifestWarning(null);
    try {
      const item = await scanItem(code);
      setManifestWarning(checkManifestMembership(item.itemCode));

      if (rapidMode) {
        try {
          await commitDestinationReceive(item, code, { condition: ShipmentItemCondition.GOOD, hasException: false });
        } catch (err) {
          setLookupError(err instanceof ApiError ? err.message : 'Failed to receive item.');
          setStats((s) => ({ ...s, errors: s.errors + 1 }));
        } finally {
          setRefocusKey((key) => key + 1);
        }
        return;
      }

      setResolvedItem(item);
      setScannedCode(code);
      resetForm();
    } catch (err) {
      setResolvedItem(null);
      setLookupError(err instanceof ApiError ? err.message : 'Lookup failed.');
      setStats((s) => ({ ...s, errors: s.errors + 1 }));
      setRefocusKey((key) => key + 1);
    }
  }

  function checkDuplicate(code: string): string | undefined {
    if (rapidMode && receivedCodesRef.current.has(code)) {
      setStats((s) => ({ ...s, duplicates: s.duplicates + 1 }));
      return `${code} was already received this session.`;
    }
    return undefined;
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
    setManifestWarning(checkManifestMembership(item.itemCode));
    resetForm();
  }

  async function handleConfirm() {
    if (!resolvedItem || !canSubmit) return;
    setConfirming(true);
    try {
      await commitDestinationReceive(resolvedItem, scannedCode, { condition, hasException, exceptionDescription, notes });
      setResolvedItem(null);
      setScannedCode(undefined);
      setManifestWarning(null);
      setRefocusKey((key) => key + 1);
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to receive item.');
      setStats((s) => ({ ...s, errors: s.errors + 1 }));
    } finally {
      setConfirming(false);
    }
  }

  function handleCancel() {
    setResolvedItem(null);
    setScannedCode(undefined);
    setManifestWarning(null);
    setRefocusKey((key) => key + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <ScanInput
          onSubmit={handleScan}
          onDuplicate={checkDuplicate}
          disabled={!selectedWarehouseId}
          autoFocusKey={refocusKey}
          placeholder="Scan or type an arrived item's code, then press Enter"
        />
        <div className="sm:w-64">
          <label htmlFor="destReceiveWarehouse" className="sr-only">
            Destination warehouse
          </label>
          <select
            id="destReceiveWarehouse"
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={rapidMode}
            onChange={(event) => {
              setRapidMode(event.target.checked);
              setResolvedItem(null);
              setRefocusKey((key) => key + 1);
            }}
            className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
          />
          Rapid Scan Mode
        </label>
        <span className="text-xs text-slate-500">
          {rapidMode
            ? 'Each scan receives immediately as Good condition, no exception — no confirm click.'
            : 'Each scan lets you record condition or flag an exception before it counts as received.'}
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 p-3">
        <label htmlFor="reconcileContainer" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Reconcile against a container&apos;s manifest (optional)
        </label>
        <select
          id="reconcileContainer"
          value={reconcileContainerId}
          onChange={(event) => setReconcileContainerId(event.target.value)}
          className="mt-1.5 w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          <option value="">No container selected — receive any item</option>
          {reconcileContainers?.map((container) => (
            <option key={container.id} value={container.id}>
              {container.containerNumber} · {container.summary.itemCount} item{container.summary.itemCount === 1 ? '' : 's'} manifested
            </option>
          ))}
        </select>

        {reconcileContainer?.destinationSummary && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <span>
              <strong className="text-emerald-700">{reconcileContainer.destinationSummary.receivedCount}</strong> received
            </span>
            <span>
              <strong className={reconcileContainer.destinationSummary.outstandingCount > 0 ? 'text-amber-700' : 'text-slate-900'}>
                {reconcileContainer.destinationSummary.outstandingCount}
              </strong>{' '}
              still outstanding
            </span>
            <span>
              <strong className={reconcileContainer.destinationSummary.exceptionCount > 0 ? 'text-red-700' : 'text-slate-900'}>
                {reconcileContainer.destinationSummary.exceptionCount}
              </strong>{' '}
              flagged / exception
            </span>
          </div>
        )}
      </div>

      {rapidMode && <ScanSessionStats succeeded={stats.succeeded} duplicates={stats.duplicates} errors={stats.errors} />}

      {successMessage && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}
      {manifestWarning && (
        <p role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {manifestWarning}
        </p>
      )}
      {lookupError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {lookupError}
        </p>
      )}

      {resolvedItem && !rapidMode && (
        <div className="rounded-xl border-2 border-primary-200 bg-primary-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-lg font-semibold text-slate-900">{resolvedItem.itemCode}</p>
              <p className="mt-1 text-sm text-slate-600">
                Item {resolvedItem.sequenceNumber} · {resolvedItem.shipment.trackingNumber} ·{' '}
                {resolvedItem.shipment.customer.firstName} {resolvedItem.shipment.customer.lastName} (
                {resolvedItem.shipment.customer.customerNumber})
              </p>
            </div>
            <StatusBadge status={resolvedItem.status} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="dr-condition">
                Condition
              </label>
              <select
                id="dr-condition"
                value={condition}
                onChange={(event) => setCondition(event.target.value as ShipmentItemCondition)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {humanizeEnumValue(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outcome</span>
              <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium">
                {isException ? (
                  <span className="text-amber-700">Will be flagged — held for review, not received</span>
                ) : (
                  <span className="text-emerald-700">Will be marked received at destination</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={hasException}
                onChange={(event) => setHasException(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
              />
              Damaged, missing, or discrepant — flag exception
            </label>
            {hasException && (
              <div className="mt-2">
                <label className="sr-only" htmlFor="dr-exception-desc">
                  Exception description
                </label>
                <textarea
                  id="dr-exception-desc"
                  value={exceptionDescription}
                  onChange={(event) => setExceptionDescription(event.target.value)}
                  placeholder="Describe the damage, or note it was not present in the container/shipment…"
                  rows={2}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                {exceptionDescriptionMissing && (
                  <p className="mt-1 text-xs text-red-600">A description is required when flagging an exception.</p>
                )}
              </div>
            )}
          </div>

          <div className="mt-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="dr-notes">
              Notes
            </label>
            <textarea
              id="dr-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              placeholder="Optional notes…"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
              {confirming ? 'Saving…' : isException ? 'Flag Exception' : 'Confirm Received'}
            </Button>
            <Button type="button" variant="ghost" onClick={handleCancel} disabled={confirming}>
              Cancel
            </Button>
          </div>
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
              <label htmlFor="destReceiveManualSearchInput" className="sr-only">
                Search by item code, tracking number, or customer
              </label>
              <input
                id="destReceiveManualSearchInput"
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
  );
}
