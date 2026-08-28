'use client';

import { useState, type FormEvent } from 'react';
import { ShipmentItemType, WeightUnit } from '@transatlantic/shared';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { humanizeEnumValue } from '@/lib/format';
import { addShipmentItem } from '@/lib/shipments';

export function AddItemForm({ shipmentId, onAdded }: { shipmentId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [itemType, setItemType] = useState<ShipmentItemType>(ShipmentItemType.BOX);
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(WeightUnit.LB);
  const [declaredValue, setDeclaredValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await addShipmentItem(shipmentId, {
        itemType,
        description: description || undefined,
        quantity: Number(quantity) || 1,
        weight: weight ? Number(weight) : undefined,
        weightUnit,
        declaredValue: declaredValue ? Number(declaredValue) : undefined,
      });
      setDescription('');
      setQuantity('1');
      setWeight('');
      setDeclaredValue('');
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add item.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
        Add Item
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectInput
          label="Item type"
          id="newItemType"
          value={itemType}
          onChange={(event) => setItemType(event.target.value as ShipmentItemType)}
        >
          {Object.values(ShipmentItemType).map((type) => (
            <option key={type} value={type}>
              {humanizeEnumValue(type)}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Description"
          id="newItemDescription"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <TextInput
          label="Quantity"
          id="newItemQuantity"
          type="number"
          min={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <TextInput
            label="Weight"
            id="newItemWeight"
            type="number"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
          <SelectInput
            label="Unit"
            id="newItemWeightUnit"
            value={weightUnit}
            onChange={(event) => setWeightUnit(event.target.value as WeightUnit)}
          >
            {Object.values(WeightUnit).map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </SelectInput>
        </div>
        <TextInput
          label="Declared value (USD)"
          id="newItemValue"
          type="number"
          value={declaredValue}
          onChange={(event) => setDeclaredValue(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add Item'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
