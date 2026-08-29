'use client';

import { useState } from 'react';
import type { ManifestDetail, WarehouseItemDetail } from '@transatlantic/shared';
import { IconClose } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { ScanInput } from '@/components/warehouse/ScanInput';
import { ApiError } from '@/lib/api';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';
import { assignItemToManifest, unassignItemFromManifest } from '@/lib/manifests';
import { scanItem, searchWarehouseItems } from '@/lib/warehouse';

/**
 * Air assignment workspace: scan-first, same interaction as
 * LoadContainerWorkspace's item resolution (one scanning implementation,
 * reused here rather than duplicated) — but items attach directly to the
 * manifest, no container involved.
 */
export function ManifestItemAssignment({
  manifest,
  onUpdated,
  canModify,
}: {
  manifest: ManifestDetail;
  onUpdated: (manifest: ManifestDetail) => void;
  canModify: boolean;
}) {
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [refocusKey, setRefocusKey] = useState(0);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<WarehouseItemDetail[] | null>(null);
  const [manualSearching, setManualSearching] = useState(false);

  async function assignResolvedItem(itemId: string, itemCode: string, scanned: boolean, scanIdentifier?: string) {
    setLookupError(null);
    setSuccessMessage(null);
    setAssigning(true);
    try {
      const updated = await assignItemToManifest(manifest.id, itemId, { scanned, scanIdentifier });
      onUpdated(updated);
      setSuccessMessage(`${itemCode} assigned to ${updated.manifestNumber}`);
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to assign item.');
    } finally {
      setAssigning(false);
      setRefocusKey((key) => key + 1);
    }
  }

  async function handleScan(code: string) {
    setLookupError(null);
    try {
      const item = await scanItem(code);
      await assignResolvedItem(item.id, item.itemCode, true, code);
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
    await assignResolvedItem(item.id, item.itemCode, false);
  }

  async function handleRemove(itemId: string) {
    setRemovingId(itemId);
    setLookupError(null);
    try {
      const updated = await unassignItemFromManifest(manifest.id, itemId);
      onUpdated(updated);
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Failed to remove item.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canModify && (
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Assign items</h3>
          <p className="mt-0.5 text-xs text-slate-500">Scan a Processed / Ready item&apos;s code, or search manually.</p>
          <div className="mt-3">
            <ScanInput
              onSubmit={handleScan}
              disabled={assigning}
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
                    <label htmlFor="manifestManualSearchInput" className="sr-only">
                      Search by item code, tracking number, or customer
                    </label>
                    <input
                      id="manifestManualSearchInput"
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
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Item Code</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Shipment</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Assigned</th>
              <th className="px-3 py-2 font-medium">By</th>
              {canModify && <th className="px-3 py-2 font-medium">&nbsp;</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {manifest.items.map((manifestItem) => (
              <tr key={manifestItem.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs font-medium text-slate-900">
                  {manifestItem.shipmentItem.itemCode}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {manifestItem.shipment.customer.firstName} {manifestItem.shipment.customer.lastName}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{manifestItem.shipment.trackingNumber}</td>
                <td className="px-3 py-2 text-slate-600">{humanizeEnumValue(manifestItem.shipmentItem.itemType)}</td>
                <td className="px-3 py-2 text-slate-500">{formatDateTime(manifestItem.addedAt)}</td>
                <td className="px-3 py-2 text-slate-500">
                  {manifestItem.addedByUser ? `${manifestItem.addedByUser.firstName} ${manifestItem.addedByUser.lastName}` : '—'}
                </td>
                {canModify && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleRemove(manifestItem.shipmentItem.id)}
                      disabled={removingId === manifestItem.shipmentItem.id}
                      title="Remove from manifest"
                      aria-label={`Remove ${manifestItem.shipmentItem.itemCode} from manifest`}
                      className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <IconClose className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {manifest.items.length === 0 && (
              <tr>
                <td colSpan={canModify ? 7 : 6} className="px-3 py-6 text-center text-sm text-slate-500">
                  No items assigned yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
