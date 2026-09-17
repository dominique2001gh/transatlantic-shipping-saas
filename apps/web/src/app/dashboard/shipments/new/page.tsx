'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CustomerSummary } from '@transatlantic/shared';
import { ShipmentItemType, ShipmentMode, WeightUnit } from '@transatlantic/shared';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { SearchableSelect } from '@/components/forms/SearchableSelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { listCustomers } from '@/lib/customers';
import { humanizeEnumValue } from '@/lib/format';
import { createShipment, type ShipmentItemInput } from '@/lib/shipments';

function emptyItem(): ShipmentItemInput {
  return { itemType: ShipmentItemType.BOX, quantity: 1 };
}

function emptyRecipient() {
  return {
    recipientName: '',
    recipientPhone: '',
    recipientEmail: '',
    recipientAddressLine1: '',
    recipientAddressLine2: '',
    recipientCity: '',
    recipientState: '',
    recipientCountry: '',
    recipientPostalCode: '',
  };
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
  // Consignee at destination — required (see Shipment.recipient* in schema.prisma
  // and QuickReceiveDto's own doc comment for why this is required at intake on
  // both New Shipment and Quick Receive rather than just one of them).
  const [recipient, setRecipient] = useState(emptyRecipient());
  const [showRecipientAddress, setShowRecipientAddress] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setRecipientField(field: keyof ReturnType<typeof emptyRecipient>, value: string) {
    setRecipient((prev) => ({ ...prev, [field]: value }));
  }

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

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!customerId) errors.customerId = 'Select a customer.';
    if (!originCountry.trim()) errors.originCountry = 'Origin country is required.';
    if (!destinationCountry.trim()) errors.destinationCountry = 'Destination country is required.';
    if (!recipient.recipientName.trim()) errors.recipientName = "Enter the recipient's full name.";
    if (!recipient.recipientPhone.trim()) errors.recipientPhone = "Enter the recipient's phone number.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!validate()) {
      setError('Fix the highlighted fields before creating this shipment.');
      return;
    }
    if (submitting) return;
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
        recipientName: recipient.recipientName.trim(),
        recipientPhone: recipient.recipientPhone.trim(),
        recipientEmail: recipient.recipientEmail.trim() || undefined,
        recipientAddressLine1: recipient.recipientAddressLine1.trim() || undefined,
        recipientAddressLine2: recipient.recipientAddressLine2.trim() || undefined,
        recipientCity: recipient.recipientCity.trim() || undefined,
        recipientState: recipient.recipientState.trim() || undefined,
        recipientCountry: recipient.recipientCountry.trim() || undefined,
        recipientPostalCode: recipient.recipientPostalCode.trim() || undefined,
        items,
      });
      router.push(`/dashboard/shipments/${shipment.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create shipment. Nothing was created — you can retry.');
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
            <div>
              <SearchableSelect
                label="Customer"
                id="customerId"
                required
                placeholder="Search by name, customer number, email, or phone…"
                items={customers}
                value={customerId}
                onChange={(id) => setCustomerId(id)}
                getOptionId={(customer) => customer.id}
                getOptionLabel={(customer) => `${customer.customerNumber} — ${customer.firstName} ${customer.lastName}`}
                getOptionSearchText={(customer) =>
                  `${customer.customerNumber} ${customer.firstName} ${customer.lastName} ${customer.email} ${customer.phone ?? ''}`
                }
                emptyMessage="No customers match your search."
              />
              {fieldErrors.customerId && <p className="mt-1 text-xs text-red-600">{fieldErrors.customerId}</p>}
            </div>
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
            <div>
              <TextInput
                label="Origin country"
                id="originCountry"
                required
                value={originCountry}
                onChange={(event) => setOriginCountry(event.target.value)}
              />
              {fieldErrors.originCountry && <p className="mt-1 text-xs text-red-600">{fieldErrors.originCountry}</p>}
            </div>
            <div>
              <TextInput
                label="Destination country"
                id="destinationCountry"
                required
                value={destinationCountry}
                onChange={(event) => setDestinationCountry(event.target.value)}
              />
              {fieldErrors.destinationCountry && <p className="mt-1 text-xs text-red-600">{fieldErrors.destinationCountry}</p>}
            </div>
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

          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Recipient (who is receiving this at destination)</h2>
            <p className="mt-1 text-xs text-slate-500">
              May be different from the customer shipping these packages. Captured once per shipment.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <TextInput
                  label="Recipient full name"
                  id="recipientName"
                  required
                  value={recipient.recipientName}
                  onChange={(event) => setRecipientField('recipientName', event.target.value)}
                />
                {fieldErrors.recipientName && <p className="mt-1 text-xs text-red-600">{fieldErrors.recipientName}</p>}
              </div>
              <div>
                <TextInput
                  label="Recipient phone"
                  id="recipientPhone"
                  required
                  placeholder="Include country code, e.g. +233…"
                  value={recipient.recipientPhone}
                  onChange={(event) => setRecipientField('recipientPhone', event.target.value)}
                />
                {fieldErrors.recipientPhone && <p className="mt-1 text-xs text-red-600">{fieldErrors.recipientPhone}</p>}
              </div>
              <TextInput
                label="Recipient email (optional)"
                id="recipientEmail"
                type="email"
                value={recipient.recipientEmail}
                onChange={(event) => setRecipientField('recipientEmail', event.target.value)}
              />
            </div>
            {!showRecipientAddress ? (
              <button
                type="button"
                className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700"
                onClick={() => setShowRecipientAddress(true)}
              >
                + Add recipient address (optional)
              </button>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInput
                  label="Address line 1"
                  id="recipientAddressLine1"
                  value={recipient.recipientAddressLine1}
                  onChange={(event) => setRecipientField('recipientAddressLine1', event.target.value)}
                />
                <TextInput
                  label="Address line 2"
                  id="recipientAddressLine2"
                  value={recipient.recipientAddressLine2}
                  onChange={(event) => setRecipientField('recipientAddressLine2', event.target.value)}
                />
                <TextInput
                  label="City"
                  id="recipientCity"
                  value={recipient.recipientCity}
                  onChange={(event) => setRecipientField('recipientCity', event.target.value)}
                />
                <TextInput
                  label="State / province / region"
                  id="recipientState"
                  value={recipient.recipientState}
                  onChange={(event) => setRecipientField('recipientState', event.target.value)}
                />
                <TextInput
                  label="Country"
                  id="recipientCountry"
                  value={recipient.recipientCountry}
                  onChange={(event) => setRecipientField('recipientCountry', event.target.value)}
                />
                <TextInput
                  label="Postal code"
                  id="recipientPostalCode"
                  value={recipient.recipientPostalCode}
                  onChange={(event) => setRecipientField('recipientPostalCode', event.target.value)}
                />
              </div>
            )}
          </div>

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
