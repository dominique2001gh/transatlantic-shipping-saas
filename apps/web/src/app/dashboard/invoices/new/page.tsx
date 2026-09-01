'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CustomerSummary, ShipmentSummary } from '@transatlantic/shared';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { listCustomers } from '@/lib/customers';
import { createInvoice, type InvoiceItemInput } from '@/lib/invoices';
import { listShipments } from '@/lib/shipments';
import { useTenant } from '@/lib/useTenant';

/**
 * Preset charge descriptions for office staff — not a rate/pricing engine
 * (Stage 3D explicitly excludes one). Selecting a preset just fills in a
 * clear, consistent description; "Other" leaves the field free-text.
 * Amounts are always entered manually.
 */
const CHARGE_PRESETS = [
  'Freight / Shipping Charge',
  'Handling Fee',
  'Customs Duty / Clearance',
  'Storage Fee',
  'Delivery Fee',
  'Other',
];

interface ItemRow extends InvoiceItemInput {
  chargeType: string;
}

function emptyItem(): ItemRow {
  return { chargeType: CHARGE_PRESETS[0], description: CHARGE_PRESETS[0], quantity: 1, unitPrice: 0 };
}

export default function NewInvoicePage() {
  const router = useRouter();
  const { tenantCurrency } = useTenant(true);

  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  const [shipmentId, setShipmentId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [dueDate, setDueDate] = useState('');
  const [tax, setTax] = useState('');
  const [items, setItems] = useState<ItemRow[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (tenantCurrency) setCurrency(tenantCurrency);
  }, [tenantCurrency]);

  // The UI prevents an obvious customer/shipment mismatch by only ever
  // offering shipments that belong to the selected customer — the backend
  // independently re-validates this regardless (InvoicesService.create).
  useEffect(() => {
    setShipmentId('');
    if (!customerId) {
      setShipments([]);
      return;
    }
    listShipments({ customerId })
      .then(setShipments)
      .catch(() => setShipments([]));
  }, [customerId]);

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function setChargeType(index: number, chargeType: string) {
    updateItem(index, {
      chargeType,
      description: chargeType === 'Other' ? '' : chargeType,
    });
  }
  function addItemRow() {
    setItems((prev) => [...prev, emptyItem()]);
  }
  function removeItemRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, item) => sum + (item.quantity ?? 1) * (item.unitPrice || 0), 0);
  const taxValue = Number(tax) || 0;
  const total = subtotal + taxValue;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!customerId) {
      setError('Select a customer.');
      return;
    }
    if (!shipmentId) {
      setError('Select a shipment for this customer.');
      return;
    }
    if (items.some((item) => !item.description.trim() || !item.unitPrice || item.unitPrice <= 0)) {
      setError('Every line item needs a description and a rate greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      const invoice = await createInvoice({
        customerId,
        shipmentId,
        currency,
        dueDate: dueDate || undefined,
        tax: tax ? Number(tax) : undefined,
        items: items.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
      });
      router.push(`/dashboard/invoices/${invoice.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create invoice.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">New Invoice</h1>
      <p className="mt-1 text-sm text-slate-500">
        Invoice numbers are assigned automatically. Rates are entered manually — there is no automatic pricing.
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
              label="Shipment"
              id="shipmentId"
              required
              disabled={!customerId}
              value={shipmentId}
              onChange={(event) => setShipmentId(event.target.value)}
            >
              <option value="">{customerId ? 'Select a shipment…' : 'Select a customer first'}</option>
              {shipments.map((shipment) => (
                <option key={shipment.id} value={shipment.id}>
                  {shipment.trackingNumber}
                </option>
              ))}
            </SelectInput>
            {customerId && shipments.length === 0 && (
              <p className="sm:col-span-2 text-sm text-amber-700">
                This customer has no shipments yet — an invoice needs an existing shipment.
              </p>
            )}
            <TextInput
              label="Currency"
              id="currency"
              required
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              maxLength={3}
            />
            <TextInput
              label="Due date"
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Line Items</h2>
              <Button type="button" variant="secondary" onClick={addItemRow}>
                Add Line Item
              </Button>
            </div>
            <div className="mt-3 flex flex-col gap-4">
              {items.map((item, index) => (
                <div key={index} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Line item {index + 1}
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
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div className="sm:col-span-2">
                      <SelectInput
                        label="Charge type"
                        id={`chargeType-${index}`}
                        value={item.chargeType}
                        onChange={(event) => setChargeType(index, event.target.value)}
                      >
                        {CHARGE_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {preset}
                          </option>
                        ))}
                      </SelectInput>
                    </div>
                    <TextInput
                      label="Quantity"
                      id={`quantity-${index}`}
                      type="number"
                      min={1}
                      value={String(item.quantity ?? 1)}
                      onChange={(event) => updateItem(index, { quantity: Number(event.target.value) || 1 })}
                    />
                    <TextInput
                      label={`Rate (${currency || '—'})`}
                      id={`unitPrice-${index}`}
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={item.unitPrice ? String(item.unitPrice) : ''}
                      onChange={(event) => updateItem(index, { unitPrice: Number(event.target.value) || 0 })}
                    />
                    {item.chargeType === 'Other' && (
                      <div className="sm:col-span-4">
                        <TextArea
                          label="Description"
                          id={`description-${index}`}
                          rows={2}
                          required
                          value={item.description}
                          onChange={(event) => updateItem(index, { description: event.target.value })}
                        />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-right text-xs text-slate-500">
                    Amount: {formatCurrency(String((item.quantity ?? 1) * (item.unitPrice || 0)), currency || 'USD')}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <TextInput
            label="Tax (optional, flat amount)"
            id="tax"
            type="number"
            min={0}
            step="0.01"
            value={tax}
            onChange={(event) => setTax(event.target.value)}
          />

          <div className="rounded-lg bg-slate-50 p-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatCurrency(String(subtotal), currency || 'USD')}</span>
            </div>
            <div className="mt-1 flex justify-between text-slate-600">
              <span>Tax</span>
              <span>{formatCurrency(String(taxValue), currency || 'USD')}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
              <span>Total</span>
              <span>{formatCurrency(String(total), currency || 'USD')}</span>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? 'Creating…' : 'Create Invoice'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
