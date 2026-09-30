'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { MANAGER_UP_ROLES } from '@transatlantic/shared';
import type { WarehouseManagementSummary } from '@transatlantic/shared';
import { TextInput } from '@/components/forms/FormField';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { createWarehouse, listWarehousesForManagement, updateWarehouse } from '@/lib/warehouse';

const EMPTY_FORM = {
  name: '',
  code: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  country: '',
  postalCode: '',
  phone: '',
  isOriginWarehouse: false,
  isDestinationWarehouse: false,
};

/**
 * Warehouse Location Management. Page-level useRequireAuth(MANAGER_UP_ROLES)
 * tightens beyond the dashboard layout's own broader DASHBOARD_ROLES gate
 * (same pattern quick-receive/page.tsx already uses) — STAFF/FINANCE can
 * still reach every other /dashboard/settings-adjacent page, just not this
 * one. This is UX only; the real enforcement is WarehouseController's
 * method-level @Roles(...MANAGER_UP_ROLES) on the /warehouse/manage* routes.
 *
 * Reachable both from Settings (OWNER-only nav item) and from a "Manage
 * Warehouses" link on /dashboard/warehouse itself, since MANAGER doesn't
 * see the Settings nav item at all (see nav.ts) but is still allowed here.
 */
export default function WarehouseManagementPage() {
  const { user, loading: authLoading } = useRequireAuth(MANAGER_UP_ROLES);
  const [warehouses, setWarehouses] = useState<WarehouseManagementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    listWarehousesForManagement()
      .then(setWarehouses)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Failed to load warehouses'))
      .finally(() => setLoading(false));
  }, [user]);

  function updateField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createWarehouse({
        name: form.name,
        code: form.code,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2 || undefined,
        city: form.city,
        state: form.state || undefined,
        country: form.country,
        postalCode: form.postalCode || undefined,
        phone: form.phone || undefined,
        isOriginWarehouse: form.isOriginWarehouse,
        isDestinationWarehouse: form.isDestinationWarehouse,
      });
      setWarehouses((current) => [...current, created]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create warehouse');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(
    warehouse: WarehouseManagementSummary,
    field: 'isOriginWarehouse' | 'isDestinationWarehouse' | 'isActive',
  ) {
    setSavingId(warehouse.id);
    setRowError(null);
    try {
      const updated = await updateWarehouse(warehouse.id, { [field]: !warehouse[field] });
      setWarehouses((current) => current.map((w) => (w.id === warehouse.id ? updated : w)));
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to update warehouse');
    } finally {
      setSavingId(null);
    }
  }

  if (authLoading || !user) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Warehouse Locations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your organization&apos;s warehouses and mark each as an origin, a destination, or both.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Existing warehouses</h2>
        {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
        {loadError && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {loadError}
          </p>
        )}
        {rowError && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {rowError}
          </p>
        )}

        {!loading && warehouses.length === 0 && !loadError && (
          <p className="mt-4 text-sm text-slate-500">No warehouses configured yet.</p>
        )}

        {!loading && warehouses.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">City / Country</th>
                  <th className="py-2 pr-4 font-medium">Origin</th>
                  <th className="py-2 pr-4 font-medium">Destination</th>
                  <th className="py-2 pr-4 font-medium">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {warehouses.map((warehouse) => (
                  <tr key={warehouse.id}>
                    <td className="py-2 pr-4 text-slate-900">{warehouse.name}</td>
                    <td className="py-2 pr-4 text-slate-600">{warehouse.code}</td>
                    <td className="py-2 pr-4 text-slate-600">
                      {warehouse.city}, {warehouse.country}
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="checkbox"
                        checked={warehouse.isOriginWarehouse}
                        disabled={savingId === warehouse.id}
                        onChange={() => handleToggle(warehouse, 'isOriginWarehouse')}
                        aria-label={`${warehouse.name} is an origin warehouse`}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="checkbox"
                        checked={warehouse.isDestinationWarehouse}
                        disabled={savingId === warehouse.id}
                        onChange={() => handleToggle(warehouse, 'isDestinationWarehouse')}
                        aria-label={`${warehouse.name} is a destination warehouse`}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="checkbox"
                        checked={warehouse.isActive}
                        disabled={savingId === warehouse.id}
                        onChange={() => handleToggle(warehouse, 'isActive')}
                        aria-label={`${warehouse.name} is active`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Add a warehouse</h2>
        <Card className="mt-3 max-w-2xl">
          <form onSubmit={handleCreate} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <TextInput
                label="Name"
                id="warehouse-name"
                required
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                maxLength={200}
              />
              <TextInput
                label="Code"
                id="warehouse-code"
                required
                value={form.code}
                onChange={(e) => updateField('code', e.target.value)}
                maxLength={20}
              />
            </div>

            <TextInput
              label="Address line 1"
              id="warehouse-address1"
              required
              value={form.addressLine1}
              onChange={(e) => updateField('addressLine1', e.target.value)}
              maxLength={200}
            />
            <TextInput
              label="Address line 2"
              id="warehouse-address2"
              value={form.addressLine2}
              onChange={(e) => updateField('addressLine2', e.target.value)}
              maxLength={200}
            />

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <TextInput
                label="City"
                id="warehouse-city"
                required
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                maxLength={100}
              />
              <TextInput
                label="State / Province"
                id="warehouse-state"
                value={form.state}
                onChange={(e) => updateField('state', e.target.value)}
                maxLength={100}
              />
              <TextInput
                label="Postal code"
                id="warehouse-postal"
                value={form.postalCode}
                onChange={(e) => updateField('postalCode', e.target.value)}
                maxLength={20}
              />
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <TextInput
                label="Country"
                id="warehouse-country"
                required
                value={form.country}
                onChange={(e) => updateField('country', e.target.value)}
                maxLength={100}
              />
              <TextInput
                label="Phone"
                id="warehouse-phone"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                maxLength={30}
              />
            </div>

            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isOriginWarehouse}
                  onChange={(e) => updateField('isOriginWarehouse', e.target.checked)}
                />
                Origin warehouse
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isDestinationWarehouse}
                  onChange={(e) => updateField('isDestinationWarehouse', e.target.checked)}
                />
                Destination warehouse
              </label>
            </div>

            {createError && (
              <p role="alert" className="text-sm text-red-600">
                {createError}
              </p>
            )}

            <div>
              <Button type="submit" disabled={creating}>
                {creating ? 'Adding…' : 'Add Warehouse'}
              </Button>
            </div>
          </form>
        </Card>
      </section>
    </div>
  );
}
