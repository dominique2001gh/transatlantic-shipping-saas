'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CustomerSummary, WarehouseSummary } from '@transatlantic/shared';
import { ReceivingCarrier } from '@transatlantic/shared';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { SearchableSelect } from '@/components/forms/SearchableSelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { listCustomers } from '@/lib/customers';
import { listWarehouseLocations } from '@/lib/warehouse';
import {
  createReceivingRecord,
  type DuplicateReceivingErrorBody,
} from '@/lib/receiving';

export default function NewReceivingRecordPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [warehouses, setWarehouses] = useState<WarehouseSummary[] | null>(null);
  const [warehouseId, setWarehouseId] = useState('');

  const [carrier, setCarrier] = useState<ReceivingCarrier>(ReceivingCarrier.UPS);
  const [carrierOther, setCarrierOther] = useState('');
  const [carrierTrackingNumber, setCarrierTrackingNumber] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  const [duplicates, setDuplicates] = useState<DuplicateReceivingErrorBody['duplicates'] | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listCustomers().then(setCustomers).catch(() => setCustomers([]));
    listWarehouseLocations()
      .then((list) => {
        setWarehouses(list);
        const preferred = list.find((warehouse) => warehouse.isOriginWarehouse) ?? list[0];
        if (preferred) setWarehouseId(preferred.id);
      })
      .catch(() => setWarehouses([]));
  }, []);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!customerId) errors.customerId = 'Select the customer this delivery is for.';
    if (!warehouseId) errors.warehouseId = 'Select which warehouse received this delivery.';
    if (carrier === ReceivingCarrier.OTHER && !carrierOther.trim()) errors.carrierOther = 'Enter the carrier name.';
    if (!Number.isInteger(quantity) || quantity < 1) errors.quantity = 'Quantity must be at least 1.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(allowDuplicate: boolean) {
    setError(null);
    if (!validate()) {
      setError('Fix the highlighted fields before saving.');
      return;
    }
    setSubmitting(true);
    try {
      const record = await createReceivingRecord({
        customerId,
        warehouseId,
        carrier,
        carrierOther: carrier === ReceivingCarrier.OTHER ? carrierOther.trim() : undefined,
        carrierTrackingNumber: carrierTrackingNumber.trim() || undefined,
        description: description.trim() || undefined,
        quantity,
        notes: notes.trim() || undefined,
        allowDuplicate,
        duplicateOverrideReason: allowDuplicate ? duplicateOverrideReason.trim() || undefined : undefined,
      });
      router.push(`/dashboard/receiving/${record.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        const body = err.details as DuplicateReceivingErrorBody | undefined;
        setDuplicates(body?.duplicates ?? []);
        setError(body?.message ?? 'A matching receiving record may already exist.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to save this receiving record. Nothing was created.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Receive a Delivery</h1>
      <p className="mt-1 text-sm text-slate-500">
        Logs one incoming delivery for a customer. This does not create a shipment or shipping label — combine
        received deliveries into a final box later from the Consolidate screen.
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
          </div>

          {warehouses === null ? (
            <p className="text-sm text-slate-500">Loading warehouses…</p>
          ) : (
            <div>
              <SelectInput
                label="Received at warehouse"
                id="warehouseId"
                required
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                {warehouses.length === 0 && <option value="">No warehouses configured</option>}
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} ({warehouse.code})
                  </option>
                ))}
              </SelectInput>
              {fieldErrors.warehouseId && <p className="mt-1 text-xs text-red-600">{fieldErrors.warehouseId}</p>}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectInput
              label="Carrier"
              id="carrier"
              required
              value={carrier}
              onChange={(event) => setCarrier(event.target.value as ReceivingCarrier)}
            >
              {Object.values(ReceivingCarrier).map((value) => (
                <option key={value} value={value}>
                  {value === ReceivingCarrier.OTHER ? 'Other / Custom' : value}
                </option>
              ))}
            </SelectInput>
            {carrier === ReceivingCarrier.OTHER && (
              <div>
                <TextInput
                  label="Carrier name"
                  id="carrierOther"
                  required
                  value={carrierOther}
                  onChange={(event) => setCarrierOther(event.target.value)}
                />
                {fieldErrors.carrierOther && <p className="mt-1 text-xs text-red-600">{fieldErrors.carrierOther}</p>}
              </div>
            )}
            <TextInput
              label="Carrier tracking number (if available)"
              id="carrierTrackingNumber"
              value={carrierTrackingNumber}
              onChange={(event) => setCarrierTrackingNumber(event.target.value)}
            />
            <div>
              <TextInput
                label="Quantity / number of packages"
                id="quantity"
                type="number"
                min={1}
                required
                value={String(quantity)}
                onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
              />
              {fieldErrors.quantity && <p className="mt-1 text-xs text-red-600">{fieldErrors.quantity}</p>}
            </div>
          </div>

          <TextInput
            label="Item / package description"
            id="description"
            placeholder="e.g. Shoes, laptop, household goods"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <TextArea label="Notes (optional)" id="notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />

          {error && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">{error}</p>
              {duplicates && duplicates.length > 0 && (
                <>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
                    {duplicates.map((d) => (
                      <li key={d.id}>
                        {d.internalReference} — received {new Date(d.receivedAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    <TextInput
                      label="Reason this is a genuinely different delivery"
                      id="duplicateOverrideReason"
                      value={duplicateOverrideReason}
                      onChange={(event) => setDuplicateOverrideReason(event.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-3"
                    disabled={submitting || !duplicateOverrideReason.trim()}
                    onClick={() => submit(true)}
                  >
                    {submitting ? 'Saving…' : 'This is a different delivery — save anyway'}
                  </Button>
                </>
              )}
            </div>
          )}

          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? 'Saving…' : 'Save Receiving Record'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
