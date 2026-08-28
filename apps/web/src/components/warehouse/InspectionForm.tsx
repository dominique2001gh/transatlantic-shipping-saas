'use client';

import { useMemo, useState } from 'react';
import type { WarehouseItemDetail } from '@transatlantic/shared';
import { DimensionUnit, ItemProcessingResult, ShipmentItemCondition, WeightUnit } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { humanizeEnumValue } from '@/lib/format';
import type { ProcessItemInput } from '@/lib/warehouse';

const CONDITION_OPTIONS = Object.values(ShipmentItemCondition);

/**
 * The single Process/Inspect action: captures actual weight/dimensions,
 * condition, and a READY/HOLD result in one screen. `reinspection` is
 * passed straight through from the caller — this form doesn't decide
 * whether a reinspection is happening, it only renders differently
 * (heading, submit label) once it's been told.
 */
export function InspectionForm({
  item,
  warehouseId,
  scannedCode,
  reinspection,
  onSubmit,
  onCancel,
  submitting,
  errorMessage,
}: {
  item: WarehouseItemDetail;
  warehouseId: string;
  scannedCode?: string;
  reinspection: boolean;
  onSubmit: (input: ProcessItemInput) => void;
  onCancel: () => void;
  submitting: boolean;
  errorMessage: string | null;
}) {
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(item.weightUnit);
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [dimensionUnit, setDimensionUnit] = useState<DimensionUnit>(item.dimensionUnit);
  const [condition, setCondition] = useState<ShipmentItemCondition>(ShipmentItemCondition.GOOD);
  const [hasException, setHasException] = useState(false);
  const [exceptionDescription, setExceptionDescription] = useState('');
  const [notes, setNotes] = useState('');

  // CRITICAL STATUS RULE: a damaged or flagged item can never be READY —
  // enforced again on the server, but locking it here means staff never
  // even see a submission that would be rejected.
  const resultLocked = hasException || condition === ShipmentItemCondition.DAMAGED;
  const [manualResult, setManualResult] = useState<ItemProcessingResult>(ItemProcessingResult.READY);
  const result = resultLocked ? ItemProcessingResult.HOLD : manualResult;

  const exceptionDescriptionMissing = hasException && !exceptionDescription.trim();
  const canSubmit = !exceptionDescriptionMissing && !submitting;

  const destination = useMemo(
    () => [item.shipment.destinationLocation, item.shipment.destinationCountry].filter(Boolean).join(', '),
    [item.shipment.destinationLocation, item.shipment.destinationCountry],
  );

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      warehouseId,
      weight: weight ? Number(weight) : undefined,
      weightUnit: weight ? weightUnit : undefined,
      length: length ? Number(length) : undefined,
      width: width ? Number(width) : undefined,
      height: height ? Number(height) : undefined,
      dimensionUnit: length || width || height ? dimensionUnit : undefined,
      condition,
      result,
      hasException,
      exceptionDescription: hasException ? exceptionDescription.trim() : undefined,
      notes: notes.trim() || undefined,
      scanned: !!scannedCode,
      scanIdentifier: scannedCode,
      reinspection,
    });
  }

  return (
    <div className="rounded-xl border-2 border-primary-200 bg-primary-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-lg font-semibold text-slate-900">{item.itemCode}</p>
          <p className="mt-1 text-sm text-slate-600">
            Item {item.sequenceNumber} · {item.shipment.trackingNumber} · {item.shipment.customer.firstName}{' '}
            {item.shipment.customer.lastName} ({item.shipment.customer.customerNumber})
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {humanizeEnumValue(item.itemType)}
            {item.description ? ` — ${item.description}` : ''} · Destination: {destination || '—'}
          </p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      {reinspection && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          Reinspection — this will add a new inspection record without erasing the previous one.
        </p>
      )}

      {(item.weight || item.length || item.width || item.height) && (
        <p className="mt-3 text-xs text-slate-500">
          On file: {item.weight ? `${item.weight} ${item.weightUnit}` : '—'} ·{' '}
          {item.length || item.width || item.height
            ? `${item.length ?? '—'} × ${item.width ?? '—'} × ${item.height ?? '—'} ${item.dimensionUnit}`
            : '—'}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="insp-weight">
            Actual weight
          </label>
          <div className="mt-1 flex gap-1">
            <input
              id="insp-weight"
              type="number"
              min="0"
              step="0.01"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <select
              value={weightUnit}
              onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
              className="rounded-md border border-slate-300 px-1 text-sm"
              aria-label="Weight unit"
            >
              {Object.values(WeightUnit).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="insp-length">
            Length
          </label>
          <input
            id="insp-length"
            type="number"
            min="0"
            step="0.01"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="insp-width">
            Width
          </label>
          <input
            id="insp-width"
            type="number"
            min="0"
            step="0.01"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="insp-height">
            Height
          </label>
          <div className="mt-1 flex gap-1">
            <input
              id="insp-height"
              type="number"
              min="0"
              step="0.01"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <select
              value={dimensionUnit}
              onChange={(e) => setDimensionUnit(e.target.value as DimensionUnit)}
              className="rounded-md border border-slate-300 px-1 text-sm"
              aria-label="Dimension unit"
            >
              {Object.values(DimensionUnit).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="insp-condition">
            Condition
          </label>
          <select
            id="insp-condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value as ShipmentItemCondition)}
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
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Result</span>
          <div className="mt-1 flex gap-2" role="radiogroup" aria-label="Processing result">
            <button
              type="button"
              disabled={resultLocked}
              onClick={() => setManualResult(ItemProcessingResult.READY)}
              aria-pressed={result === ItemProcessingResult.READY}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                result === ItemProcessingResult.READY
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Ready
            </button>
            <button
              type="button"
              onClick={() => setManualResult(ItemProcessingResult.HOLD)}
              aria-pressed={result === ItemProcessingResult.HOLD}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                result === ItemProcessingResult.HOLD
                  ? 'border-amber-500 bg-amber-50 text-amber-800'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Hold
            </button>
          </div>
          {resultLocked && (
            <p className="mt-1 text-xs text-amber-700">
              Locked to Hold — a damaged or flagged item can&apos;t be marked Ready.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={hasException}
            onChange={(e) => setHasException(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
          />
          Damage / exception found
        </label>
        {hasException && (
          <div className="mt-2">
            <label className="sr-only" htmlFor="insp-exception-desc">
              Damage / exception description
            </label>
            <textarea
              id="insp-exception-desc"
              value={exceptionDescription}
              onChange={(e) => setExceptionDescription(e.target.value)}
              placeholder="Describe the damage or exception…"
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
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="insp-notes">
          Notes
        </label>
        <textarea
          id="insp-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional inspection notes…"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      <div className="mt-5 flex gap-3">
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
          {submitting
            ? 'Saving…'
            : result === ItemProcessingResult.READY
              ? 'Mark Ready'
              : 'Place On Hold'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
