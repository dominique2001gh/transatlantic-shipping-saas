'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CustomerSummary, WarehouseSummary } from '@transatlantic/shared';
import { ShipmentItemType, ShipmentMode, WeightUnit } from '@transatlantic/shared';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { SearchableSelect } from '@/components/forms/SearchableSelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { createCustomer, listCustomers } from '@/lib/customers';
import { humanizeEnumValue } from '@/lib/format';
import { createQuickReceive } from '@/lib/shipments';
import { listWarehouseLocations } from '@/lib/warehouse';

/**
 * Quick Receive (Phase 1): one screen that replaces "create a shipment,
 * then walk N packages to a scanner" with one confirmation. Reuses the
 * exact same customer search/create, warehouse list, and label-printing
 * pages as the rest of the app — see ShipmentsService.createQuickReceive
 * for what happens server-side (one transaction: shipment + N items, all
 * already RECEIVED_ORIGIN_WAREHOUSE, no scan required).
 *
 * Deliberately does NOT replace New Shipment (`/dashboard/shipments/new`)
 * or Warehouse -> Receive — both are unchanged and still the right tool
 * when items need individual descriptions/weights up front, or when
 * packages already exist and are only now physically arriving to be
 * scanned one at a time.
 */
export default function QuickReceivePage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [warehouses, setWarehouses] = useState<WarehouseSummary[] | null>(null);
  const [originWarehouseId, setOriginWarehouseId] = useState('');

  const [shipmentMode, setShipmentMode] = useState<ShipmentMode>(ShipmentMode.OCEAN_LCL);
  const [originCountry, setOriginCountry] = useState('United States');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [originLocation, setOriginLocation] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');
  const [description, setDescription] = useState('');

  const [packageCount, setPackageCount] = useState(1);
  const [itemType, setItemType] = useState<ShipmentItemType>(ShipmentItemType.BOX);
  const [itemDescription, setItemDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(WeightUnit.LB);

  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
    listWarehouseLocations()
      .then((list) => {
        setWarehouses(list);
        const preferred = list.find((warehouse) => warehouse.isOriginWarehouse) ?? list[0];
        if (preferred) setOriginWarehouseId(preferred.id);
      })
      .catch(() => setWarehouses([]));
  }, []);

  async function handleCreateCustomer(event: FormEvent) {
    event.preventDefault();
    setCustomerError(null);
    if (!newFirstName.trim() || !newLastName.trim() || !newEmail.trim()) {
      setCustomerError('First name, last name, and email are required.');
      return;
    }
    setCreatingCustomer(true);
    try {
      const customer = await createCustomer({
        firstName: newFirstName.trim(),
        lastName: newLastName.trim(),
        email: newEmail.trim(),
        phone: newPhone.trim() || undefined,
      });
      // Newly created customer is added to the same list SearchableSelect
      // already renders, and immediately selected — no page navigation,
      // no re-fetch, no leaving Quick Receive.
      setCustomers((prev) => [customer, ...prev]);
      setCustomerId(customer.id);
      setShowNewCustomer(false);
      setNewFirstName('');
      setNewLastName('');
      setNewEmail('');
      setNewPhone('');
    } catch (err) {
      setCustomerError(err instanceof ApiError ? err.message : 'Failed to create customer.');
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!customerId) {
      setError('Search for an existing customer or create a new one.');
      return;
    }
    if (!originWarehouseId) {
      setError('Select the origin warehouse these packages are physically at.');
      return;
    }
    setSubmitting(true);
    try {
      const shipment = await createQuickReceive({
        customerId,
        shipmentMode,
        originCountry,
        destinationCountry,
        originLocation: originLocation || undefined,
        destinationLocation: destinationLocation || undefined,
        originWarehouseId,
        description: description || undefined,
        packageCount,
        itemType,
        itemDescription: itemDescription || undefined,
        weight: weight ? Number(weight) : undefined,
        weightUnit,
      });
      // Straight to the existing batch-print labels page — Print All
      // Labels there is unchanged, and is the batch-printing step for
      // this whole intake.
      router.push(`/dashboard/shipments/${shipment.id}/labels`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to receive packages.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Quick Receive</h1>
      <p className="mt-1 text-sm text-slate-500">
        Create a shipment and receive all its packages in one step — no scanning required. Tracking numbers and item
        codes are assigned automatically, and every package is marked received at the warehouse you select below.
      </p>

      <Card className="mt-6">
        <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
          <div>
            <div className="flex items-end justify-between gap-3">
              <div className="flex-1">
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
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowNewCustomer((open) => !open)}
                className="shrink-0"
              >
                {showNewCustomer ? 'Cancel' : '+ New Customer'}
              </Button>
            </div>

            {showNewCustomer && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextInput
                    label="First name"
                    id="newFirstName"
                    required
                    value={newFirstName}
                    onChange={(event) => setNewFirstName(event.target.value)}
                  />
                  <TextInput
                    label="Last name"
                    id="newLastName"
                    required
                    value={newLastName}
                    onChange={(event) => setNewLastName(event.target.value)}
                  />
                  <TextInput
                    label="Email"
                    id="newEmail"
                    type="email"
                    required
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                  />
                  <TextInput
                    label="Phone"
                    id="newPhone"
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                  />
                </div>
                {customerError && (
                  <p role="alert" className="text-sm text-red-600">
                    {customerError}
                  </p>
                )}
                <Button type="button" onClick={handleCreateCustomer} disabled={creatingCustomer} className="self-start">
                  {creatingCustomer ? 'Creating…' : 'Create & Select Customer'}
                </Button>
              </div>
            )}
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
            {warehouses === null ? (
              <p className="self-end pb-2.5 text-sm text-slate-500">Loading warehouses…</p>
            ) : (
              <SelectInput
                label="Origin warehouse (where these packages are now)"
                id="originWarehouseId"
                required
                value={originWarehouseId}
                onChange={(event) => setOriginWarehouseId(event.target.value)}
              >
                {warehouses.length === 0 && <option value="">No warehouses configured</option>}
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} ({warehouse.code})
                  </option>
                ))}
              </SelectInput>
            )}
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
            label="Shipment description"
            id="description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Packages</h2>
            <p className="mt-1 text-xs text-slate-500">
              Applies to every package in this intake. A single odd-one-out package can be edited individually
              afterward from the shipment detail page.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                label="Number of pieces/packages"
                id="packageCount"
                type="number"
                min={1}
                max={50}
                required
                value={String(packageCount)}
                onChange={(event) => setPackageCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
              />
              <SelectInput
                label="Package type"
                id="itemType"
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
                label="Package description"
                id="itemDescription"
                value={itemDescription}
                onChange={(event) => setItemDescription(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <TextInput
                  label="Weight (each)"
                  id="weight"
                  type="number"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                />
                <SelectInput
                  label="Unit"
                  id="weightUnit"
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
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? 'Receiving…' : `Receive ${packageCount} Package${packageCount === 1 ? '' : 's'}`}
          </Button>
        </form>
      </Card>
    </div>
  );
}
