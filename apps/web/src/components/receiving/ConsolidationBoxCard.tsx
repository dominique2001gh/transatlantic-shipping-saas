'use client';

import type { ReceivingRecordSummary } from '@transatlantic/shared';
import { DimensionUnit, ShipmentItemType, WeightUnit } from '@transatlantic/shared';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { humanizeEnumValue } from '@/lib/format';
import type { ConsolidationBoxInput } from '@/lib/consolidation';

/** One final shipping box in the consolidation builder — see ConsolidateDto's own doc comment for why a box starts already-received, not REGISTERED. */
export function ConsolidationBoxCard({
  index,
  box,
  records,
  remainingFor,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  box: ConsolidationBoxInput;
  records: ReceivingRecordSummary[];
  /** Remaining quantity for a record, accounting for everything already staged in every OTHER box (never this one — this box's own current allocation for that record is still editable). */
  remainingFor: (recordId: string, excludingBoxIndex: number) => number;
  onChange: (patch: Partial<ConsolidationBoxInput>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  function setAllocation(recordId: string, quantity: number) {
    const allocations = box.allocations.filter((a) => a.receivingRecordId !== recordId);
    if (quantity > 0) allocations.push({ receivingRecordId: recordId, quantity });
    onChange({ allocations });
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Box {index + 1}</h3>
        {canRemove && (
          <button type="button" onClick={onRemove} className="text-xs font-medium text-red-600 hover:text-red-700">
            Remove box
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectInput
          label="Box type"
          id={`box-${index}-itemType`}
          value={box.itemType}
          onChange={(event) => onChange({ itemType: event.target.value as ShipmentItemType })}
        >
          {Object.values(ShipmentItemType).map((type) => (
            <option key={type} value={type}>
              {humanizeEnumValue(type)}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Description"
          id={`box-${index}-description`}
          value={box.description ?? ''}
          onChange={(event) => onChange({ description: event.target.value })}
        />
        <div className="grid grid-cols-2 gap-2">
          <TextInput
            label="Weight"
            id={`box-${index}-weight`}
            type="number"
            value={box.weight ?? ''}
            onChange={(event) => onChange({ weight: event.target.value ? Number(event.target.value) : undefined })}
          />
          <SelectInput
            label="Unit"
            id={`box-${index}-weightUnit`}
            value={box.weightUnit ?? WeightUnit.LB}
            onChange={(event) => onChange({ weightUnit: event.target.value as WeightUnit })}
          >
            {Object.values(WeightUnit).map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </SelectInput>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <TextInput
            label="L"
            id={`box-${index}-length`}
            type="number"
            value={box.length ?? ''}
            onChange={(event) => onChange({ length: event.target.value ? Number(event.target.value) : undefined })}
          />
          <TextInput
            label="W"
            id={`box-${index}-width`}
            type="number"
            value={box.width ?? ''}
            onChange={(event) => onChange({ width: event.target.value ? Number(event.target.value) : undefined })}
          />
          <TextInput
            label="H"
            id={`box-${index}-height`}
            type="number"
            value={box.height ?? ''}
            onChange={(event) => onChange({ height: event.target.value ? Number(event.target.value) : undefined })}
          />
        </div>
        <SelectInput
          label="Dimension unit"
          id={`box-${index}-dimensionUnit`}
          value={box.dimensionUnit ?? DimensionUnit.IN}
          onChange={(event) => onChange({ dimensionUnit: event.target.value as DimensionUnit })}
        >
          {Object.values(DimensionUnit).map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Declared value"
          id={`box-${index}-declaredValue`}
          type="number"
          value={box.declaredValue ?? ''}
          onChange={(event) => onChange({ declaredValue: event.target.value ? Number(event.target.value) : undefined })}
        />
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pack into this box</p>
        <div className="mt-2 flex flex-col gap-2">
          {records.map((record) => {
            const staged = box.allocations.find((a) => a.receivingRecordId === record.id)?.quantity ?? 0;
            const remaining = remainingFor(record.id, index);
            return (
              <div key={record.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm">
                <span className="text-slate-700">
                  {record.internalReference} — {record.carrier === 'OTHER' ? record.carrierOther : record.carrier}
                  {record.description ? ` (${record.description})` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{remaining} left</span>
                  <input
                    type="number"
                    min={0}
                    max={remaining + staged}
                    value={staged}
                    onChange={(event) => setAllocation(record.id, Math.max(0, Number(event.target.value) || 0))}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              </div>
            );
          })}
          {records.length === 0 && <p className="text-sm text-slate-500">No awaiting-consolidation deliveries for this customer.</p>}
        </div>
      </div>
    </div>
  );
}

export function emptyBox(): ConsolidationBoxInput {
  return { itemType: ShipmentItemType.BOX, quantity: 1, allocations: [] };
}
