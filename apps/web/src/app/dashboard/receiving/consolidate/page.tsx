'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CustomerSummary, ReceivingRecordSummary, WarehouseSummary } from '@transatlantic/shared';
import { ShipmentMode } from '@transatlantic/shared';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { SearchableSelect } from '@/components/forms/SearchableSelect';
import { ConsolidationBoxCard, emptyBox } from '@/components/receiving/ConsolidationBoxCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { consolidate, type ConsolidationBoxInput } from '@/lib/consolidation';
import { listCustomers } from '@/lib/customers';
import { humanizeEnumValue } from '@/lib/format';
import { listReceivingRecords } from '@/lib/receiving';
import { listWarehouseLocations } from '@/lib/warehouse';

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

export default function ConsolidationBuilderPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [records, setRecords] = useState<ReceivingRecordSummary[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const [warehouses, setWarehouses] = useState<WarehouseSummary[] | null>(null);
  const [originWarehouseId, setOriginWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [shipmentMode, setShipmentMode] = useState<ShipmentMode>(ShipmentMode.OCEAN_LCL);
  const [destinationCountry, setDestinationCountry] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');
  const [recipient, setRecipient] = useState(emptyRecipient());

  const [boxes, setBoxes] = useState<ConsolidationBoxInput[]>([emptyBox()]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listCustomers().then(setCustomers).catch(() => setCustomers([]));
    listWarehouseLocations()
      .then((list) => {
        setWarehouses(list);
        const preferred = list.find((warehouse) => warehouse.isOriginWarehouse) ?? list[0];
        if (preferred) setOriginWarehouseId(preferred.id);
      })
      .catch(() => setWarehouses([]));
  }, []);

  useEffect(() => {
    if (!customerId) {
      setRecords([]);
      return;
    }
    setRecordsLoading(true);
    listReceivingRecords({ customerId, awaitingConsolidation: true })
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setRecordsLoading(false));
  }, [customerId]);

  const destinationWarehouseOptions = warehouses?.filter((warehouse) => warehouse.isDestinationWarehouse) ?? [];

  /** Remaining quantity for a record, after subtracting everything staged in every box EXCEPT the one asking (so that box's own slider doesn't lock itself out). */
  function remainingFor(recordId: string, excludingBoxIndex: number): number {
    const record = records.find((r) => r.id === recordId);
    if (!record) return 0;
    const stagedElsewhere = boxes.reduce((sum, box, index) => {
      if (index === excludingBoxIndex) return sum;
      return sum + (box.allocations.find((a) => a.receivingRecordId === recordId)?.quantity ?? 0);
    }, 0);
    return Math.max(0, record.quantity - record.allocatedQuantity - stagedElsewhere);
  }

  function updateBox(index: number, patch: Partial<ConsolidationBoxInput>) {
    setBoxes((prev) => prev.map((box, i) => (i === index ? { ...box, ...patch } : box)));
  }
  function addBox() {
    setBoxes((prev) => [...prev, emptyBox()]);
  }
  function removeBox(index: number) {
    setBoxes((prev) => prev.filter((_, i) => i !== index));
  }

  function setRecipientField(field: keyof ReturnType<typeof emptyRecipient>, value: string) {
    setRecipient((prev) => ({ ...prev, [field]: value }));
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!customerId) errors.customerId = 'Select a customer.';
    if (!originWarehouseId) errors.originWarehouseId = 'Select the origin warehouse.';
    if (!destinationCountry.trim()) errors.destinationCountry = 'Destination country is required.';
    if (!recipient.recipientName.trim()) errors.recipientName = "Enter the recipient's full name.";
    if (!recipient.recipientPhone.trim()) errors.recipientPhone = "Enter the recipient's phone number.";
    if (boxes.every((box) => box.allocations.length === 0)) {
      errors.boxes = 'Allocate at least one received delivery into at least one box.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!validate()) {
      setError('Fix the highlighted fields before consolidating.');
      return;
    }
    const boxesWithAllocations = boxes.filter((box) => box.allocations.length > 0);
    setSubmitting(true);
    try {
      const shipment = await consolidate({
        customerId,
        shipmentMode,
        destinationCountry: destinationCountry.trim(),
        destinationLocation: destinationLocation.trim() || undefined,
        originWarehouseId,
        destinationWarehouseId: destinationWarehouseId || undefined,
        recipientName: recipient.recipientName.trim(),
        recipientPhone: recipient.recipientPhone.trim(),
        recipientEmail: recipient.recipientEmail.trim() || undefined,
        recipientAddressLine1: recipient.recipientAddressLine1.trim() || undefined,
        recipientAddressLine2: recipient.recipientAddressLine2.trim() || undefined,
        recipientCity: recipient.recipientCity.trim() || undefined,
        recipientState: recipient.recipientState.trim() || undefined,
        recipientCountry: recipient.recipientCountry.trim() || undefined,
        recipientPostalCode: recipient.recipientPostalCode.trim() || undefined,
        boxes: boxesWithAllocations,
      });
      router.push(`/dashboard/shipments/${shipment.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to consolidate. Nothing was created — you can retry.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Consolidate Received Deliveries</h1>
      <p className="mt-1 text-sm text-slate-500">
        Combine a customer&apos;s received deliveries into one or more final shipping boxes. This creates a normal
        shipment — labels print the same way as any other shipment afterward.
      </p>

      <Card className="mt-6">
        <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
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
            {customerId && recordsLoading && <p className="mt-1 text-xs text-slate-500">Loading received deliveries…</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            {warehouses !== null && (
              <div>
                <SelectInput
                  label="Origin warehouse"
                  id="originWarehouseId"
                  required
                  value={originWarehouseId}
                  onChange={(event) => setOriginWarehouseId(event.target.value)}
                >
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.code})
                    </option>
                  ))}
                </SelectInput>
                {fieldErrors.originWarehouseId && <p className="mt-1 text-xs text-red-600">{fieldErrors.originWarehouseId}</p>}
              </div>
            )}
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
              label="Destination location"
              id="destinationLocation"
              value={destinationLocation}
              onChange={(event) => setDestinationLocation(event.target.value)}
            />
            {destinationWarehouseOptions.length > 0 && (
              <SelectInput
                label="Destination warehouse (optional)"
                id="destinationWarehouseId"
                value={destinationWarehouseId}
                onChange={(event) => setDestinationWarehouseId(event.target.value)}
              >
                <option value="">Not yet known</option>
                {destinationWarehouseOptions.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} ({warehouse.code})
                  </option>
                ))}
              </SelectInput>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Recipient (who is receiving this at destination)</h2>
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
                  value={recipient.recipientPhone}
                  onChange={(event) => setRecipientField('recipientPhone', event.target.value)}
                />
                {fieldErrors.recipientPhone && <p className="mt-1 text-xs text-red-600">{fieldErrors.recipientPhone}</p>}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Boxes</h2>
              <Button type="button" variant="secondary" size="sm" onClick={addBox}>
                + Add Box
              </Button>
            </div>
            {fieldErrors.boxes && <p className="mt-1 text-xs text-red-600">{fieldErrors.boxes}</p>}
            <div className="mt-3 flex flex-col gap-4">
              {boxes.map((box, index) => (
                <ConsolidationBoxCard
                  key={index}
                  index={index}
                  box={box}
                  records={records}
                  remainingFor={remainingFor}
                  onChange={(patch) => updateBox(index, patch)}
                  onRemove={() => removeBox(index)}
                  canRemove={boxes.length > 1}
                />
              ))}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? 'Consolidating…' : 'Consolidate'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
