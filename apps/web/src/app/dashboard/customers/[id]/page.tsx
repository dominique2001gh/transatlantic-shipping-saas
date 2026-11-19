'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CustomerDetail } from '@transatlantic/shared';
import { hasPermission } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { TextInput } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import {
  archiveCustomer,
  deleteCustomer,
  getCustomer,
  restoreCustomer,
  updateCustomer,
  type CustomerDeleteGuardErrorBody,
  type UpdateCustomerInput,
} from '@/lib/customers';
import { humanizeEnumValue } from '@/lib/format';

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const currentUser = getStoredUser();
  const canEdit = hasPermission(currentUser, 'customers.manage');
  const canArchive = hasPermission(currentUser, 'customers.archive');

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<UpdateCustomerInput>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  useEffect(() => {
    getCustomer(params.id)
      .then(setCustomer)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load customer.'));
  }, [params.id]);

  function openEditor() {
    if (!customer) return;
    setEditDraft({ firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone ?? '' });
    setEditError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!customer) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await updateCustomer(customer.id, editDraft);
      setCustomer((prev) => (prev ? { ...prev, ...updated } : prev));
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to save these changes.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleArchiveToggle() {
    if (!customer) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = customer.archivedAt ? await restoreCustomer(customer.id) : await archiveCustomer(customer.id);
      setCustomer((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update this customer.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete() {
    if (!customer) return;
    if (!deleteConfirming) {
      setDeleteConfirming(true);
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      await deleteCustomer(customer.id);
      router.push('/dashboard/customers');
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        const body = err.details as CustomerDeleteGuardErrorBody | undefined;
        setActionError(body?.message ?? 'This customer has existing history and cannot be deleted. Archive instead.');
      } else {
        setActionError(err instanceof ApiError ? err.message : 'Failed to delete this customer.');
      }
      setDeleteConfirming(false);
    } finally {
      setActionBusy(false);
    }
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!customer) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Customer {customer.customerNumber}
            </p>
            {customer.archivedAt && <Badge variant="warning">Archived</Badge>}
          </div>
          {!editing ? (
            <>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">
                {customer.firstName} {customer.lastName}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {customer.email}
                {customer.phone ? ` · ${customer.phone}` : ''}
              </p>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                label="First name"
                id="editFirstName"
                value={editDraft.firstName ?? ''}
                onChange={(event) => setEditDraft((prev) => ({ ...prev, firstName: event.target.value }))}
              />
              <TextInput
                label="Last name"
                id="editLastName"
                value={editDraft.lastName ?? ''}
                onChange={(event) => setEditDraft((prev) => ({ ...prev, lastName: event.target.value }))}
              />
              <TextInput
                label="Email"
                id="editEmail"
                type="email"
                value={editDraft.email ?? ''}
                onChange={(event) => setEditDraft((prev) => ({ ...prev, email: event.target.value }))}
              />
              <TextInput
                label="Phone"
                id="editPhone"
                value={editDraft.phone ?? ''}
                onChange={(event) => setEditDraft((prev) => ({ ...prev, phone: event.target.value }))}
              />
              {editError && <p className="text-sm text-red-600 sm:col-span-2">{editError}</p>}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="button" size="sm" disabled={editSaving} onClick={saveEdit}>
                  {editSaving ? 'Saving…' : 'Save'}
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={editSaving} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
        {!editing && (
          <div className="flex flex-wrap items-start gap-2">
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={openEditor}>
                Edit
              </Button>
            )}
            {canArchive && (
              <Button variant="secondary" size="sm" disabled={actionBusy} onClick={handleArchiveToggle}>
                {customer.archivedAt ? 'Restore' : 'Archive'}
              </Button>
            )}
            {canArchive && !customer.archivedAt && (
              <Button
                variant="secondary"
                size="sm"
                disabled={actionBusy}
                className="border-red-200 text-red-600 hover:bg-red-50"
                onClick={handleDelete}
              >
                {deleteConfirming ? 'Click again to confirm delete' : 'Delete'}
              </Button>
            )}
          </div>
        )}
      </div>
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Shipments</h2>
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Tracking #</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customer.shipments.map((shipment) => (
                <tr key={shipment.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">
                    <Link href={`/dashboard/shipments/${shipment.id}`} className="hover:text-primary-700">
                      {shipment.trackingNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(shipment.shipmentMode)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {shipment.itemCounts?.received ?? 0} / {shipment.itemCounts?.total ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={shipment.status} />
                  </td>
                </tr>
              ))}
              {customer.shipments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                    No shipments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {customer.addresses.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Addresses</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {customer.addresses.map((address) => (
              <Card key={address.id}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900">
                    {address.label ?? humanizeEnumValue(address.type)}
                  </p>
                  {address.isDefault && <Badge variant="primary">Default</Badge>}
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                  <br />
                  {address.city}
                  {address.state ? `, ${address.state}` : ''} {address.postalCode ?? ''}
                  <br />
                  {address.country}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
