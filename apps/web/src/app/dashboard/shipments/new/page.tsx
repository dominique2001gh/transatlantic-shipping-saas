'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CustomerSummary } from '@transatlantic/shared';
import { ShipmentItemType, ShipmentMode, WeightUnit } from '@transatlantic/shared';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { listCustomers } from '@/lib/customers';
import { humanizeEnumValue } from '@/lib/format';
import { createShipment, type ShipmentItemInput } from '@/lib/shipments';

function emptyItem(): ShipmentItemInput {
  return { itemType: ShipmentItemType.BOX, quantity: 1 };
}

export default function NewShipmentPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [shipmentMode, setShipmentMode] = useState<ShipmentMode>(ShipmentMode.OCEAN_LCL);
  const [originCountry, setOriginCountry] = useState('United States');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [originLocation, setOriginLocation] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<ShipmentItemInput[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);

  function updateItem(index: number, patch: Partial<ShipmentItemInput>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function addItemRow() {
    setItems((prev) => [...prev, emptyItem()]);
  }
  function removeItemRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!customerId) {
      setError('Select a customer.');
      return;
    }
    setSubmitting(true);
    try {
      const shipment = await createShipment({
        customerId,
        shipmentMode,
        originCountry,
        destinationCountry,
        originLocation: originLocation || undefined,
        destinationLocation: destinationLocation || undefined,
        description: description || undefined,
        items,
      });
      router.push(`/dashboard/shipments/${shipment.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create shipment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">New Shipment</h1>
      <p className="mt-1 text-sm text-slate-500">
        Tracking numbers and item codes are assigned automatically.
      </p>

      <Card className="mt-6">
        <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectInput
              label="Customer"
              id="customerId"
              required
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Select a customer…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.customerNumber} — {customer.firstName} {customer.lastName}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Shipping method"
              id="shipmentMode"
              required
              value={shipmentMode}
              onChange={(event) => setShipmentMode(event.target.value as ShipmentMode)}
            >
              {Object.values(ShipmentMode).map((mode) => (
                <option key={mode} value={mode}>
                  {humanizeEnumValue(mode)}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Origin country"
              id="originCountry"
              required
              value={originCountry}
              onChange={(event) => setOriginCountry(event.target.value)}
            />
            <TextInput
              label="Destination country"
              id="destinationCountry"
              required
              value={destinationCountry}
              onChange={(event) => setDestinationCountry(event.target.value)}
            />
            <TextInput
              label="Origin location"
              id="originLocation"
              value={originLocation}
              onChange={(event) => setOriginLocation(event.target.value)}
            />
            <TextInput
              label="Destination location"
              id="destinationLocation"
              value={destinationLocation}
              onChange={(event) => setDestinationLocation(event.target.value)}
            />
          </div>
          <TextArea
            label="Description"
            id="description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Items</h2>
              <Button type="button" variant="secondary" onClick={addItemRow}>
                Add Item
              </Button>
            </div>
            <div className="mt-3 flex flex-col gap-4">
              {items.map((item, index) => (
                <div key={index} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Item {index + 1}
                    </p>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItemRow(index)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <SelectInput
                      label="Item type"
                      id={`itemType-${index}`}
                      value={item.itemType}
                      onChange={(event) => updateItem(index, { itemType: event.target.value as ShipmentItemType })}
                    >
                      {Object.values(ShipmentItemType).map((type) => (
                        <option key={type} value={type}>
                          {humanizeEnumValue(type)}
                        </option>
                      ))}
                    </SelectInput>
                    <TextInput
                      label="Description"
                      id={`itemDescription-${index}`}
                      value={item.description ?? ''}
                      onChange={(event) => updateItem(index, { description: event.target.value })}
                    />
                    <TextInput
                      label="Quantity"
                      id={`itemQuantity-${index}`}
                      type="number"
                      min={1}
                      value={String(item.quantity ?? 1)}
                      onChange={(event) => updateItem(index, { quantity: Number(event.target.value) || 1 })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <TextInput
                        label="Weight"
                        id={`itemWeight-${index}`}
                        type="number"
                        value={item.weight != null ? String(item.weight) : ''}
                        onChange={(event) =>
                          updateItem(index, { weight: event.target.value ? Number(event.target.value) : undefined })
                        }
                      />
                      <SelectInput
                        label="Unit"
                        id={`itemWeightUnit-${index}`}
                        value={item.weightUnit ?? WeightUnit.LB}
                        onChange={(event) => updateItem(index, { weightUnit: event.target.value as WeightUnit })}
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
                      id={`itemValue-${index}`}
                      type="number"
                      value={item.declaredValue != null ? String(item.declaredValue) : ''}
                      onChange={(event) =>
                        updateItem(index, {
                          declaredValue: event.target.value ? Number(event.target.value) : undefined,
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? 'Creating…' : 'Create Shipment'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
