'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ReceivingRecordSummary } from '@transatlantic/shared';
import { ReceivingCarrier, hasPermission } from '@transatlantic/shared';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { formatDateTime, humanizeEnumValue, statusBadgeVariant } from '@/lib/format';
import {
  cancelReceivingRecord,
  getReceivingRecord,
  updateReceivingRecord,
  uploadReceivingPhoto,
  type UpdateReceivingRecordInput,
} from '@/lib/receiving';

export default function ReceivingRecordDetailPage() {
  const params = useParams<{ id: string }>();
  const currentUser = getStoredUser();
  const canManage = hasPermission(currentUser, 'receiving.manage');

  const [record, setRecord] = useState<ReceivingRecordSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<UpdateReceivingRecordInput>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirming, setCancelConfirming] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    getReceivingRecord(params.id)
      .then(setRecord)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load this receiving record.'));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params.id is the only real dependency; load() is defined fresh each render
  }, [params.id]);

  function openEditor() {
    if (!record) return;
    setEditDraft({
      carrier: record.carrier,
      carrierOther: record.carrierOther ?? '',
      carrierTrackingNumber: record.carrierTrackingNumber ?? '',
      description: record.description ?? '',
      quantity: record.quantity,
      notes: record.notes ?? '',
    });
    setEditError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!record) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await updateReceivingRecord(record.id, editDraft);
      setRecord(updated);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to save this correction.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCancel() {
    if (!record) return;
    if (!cancelConfirming) {
      setCancelConfirming(true);
      return;
    }
    setCancelling(true);
    try {
      const updated = await cancelReceivingRecord(record.id);
      setRecord(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel this receiving record.');
    } finally {
      setCancelling(false);
      setCancelConfirming(false);
    }
  }

  async function handlePhotoSelected(file: File) {
    if (!record) return;
    setUploading(true);
    setUploadError(null);
    try {
      await uploadReceivingPhoto(record.id, file);
      load();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Failed to upload this photo.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!record) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const remaining = record.quantity - record.allocatedQuantity;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-slate-400">
            {record.internalReference}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{record.customerName ?? 'Unknown customer'}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={statusBadgeVariant(record.status)}>{humanizeEnumValue(record.status)}</Badge>
            <span className="text-sm text-slate-500">
              {record.allocatedQuantity} / {record.quantity} allocated{remaining > 0 ? ` (${remaining} remaining)` : ''}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/dashboard/receiving/${record.id}/label`} target="_blank">
            <Button variant="secondary">Print Internal Label</Button>
          </Link>
          {canManage && record.status !== 'CANCELLED' && !editing && (
            <Button variant="secondary" onClick={openEditor}>
              Correct Details
            </Button>
          )}
        </div>
      </div>

      {!editing ? (
        <Card>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-400">Carrier</dt>
              <dd className="mt-0.5 text-slate-900">
                {record.carrier === 'OTHER' ? record.carrierOther ?? 'Other' : record.carrier}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Carrier tracking #</dt>
              <dd className="mt-0.5 text-slate-900">{record.carrierTrackingNumber ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Description</dt>
              <dd className="mt-0.5 text-slate-900">{record.description ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Warehouse</dt>
              <dd className="mt-0.5 text-slate-900">{record.warehouseName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Received</dt>
              <dd className="mt-0.5 text-slate-900">
                {formatDateTime(record.receivedAt)}
                {record.receivedByName ? ` — ${record.receivedByName}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Notes</dt>
              <dd className="mt-0.5 text-slate-900">{record.notes ?? '—'}</dd>
            </div>
          </dl>

          {canManage && record.status !== 'CANCELLED' && (
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <label htmlFor="receivingPhoto" className="text-sm font-medium text-slate-700">
                Package photo
              </label>
              <input
                ref={fileInputRef}
                id="receivingPhoto"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handlePhotoSelected(file);
                }}
                className="text-sm"
              />
              {uploading && <span className="text-xs text-slate-500">Uploading…</span>}
              {record.allocatedQuantity === 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto border-red-200 text-red-600 hover:bg-red-50"
                  disabled={cancelling}
                  onClick={handleCancel}
                >
                  {cancelling ? 'Cancelling…' : cancelConfirming ? 'Click again to confirm cancel' : 'Cancel this record'}
                </Button>
              )}
            </div>
          )}
          {uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}
        </Card>
      ) : (
        <Card>
          <h2 className="text-sm font-semibold text-slate-900">Correct Receiving Details</h2>
          <p className="mt-1 text-xs text-slate-500">Every change here is recorded in the audit log.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectInput
              label="Carrier"
              id="editCarrier"
              value={editDraft.carrier}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, carrier: event.target.value as ReceivingCarrier }))}
            >
              {Object.values(ReceivingCarrier).map((value) => (
                <option key={value} value={value}>
                  {value === ReceivingCarrier.OTHER ? 'Other / Custom' : value}
                </option>
              ))}
            </SelectInput>
            {editDraft.carrier === ReceivingCarrier.OTHER && (
              <TextInput
                label="Carrier name"
                id="editCarrierOther"
                value={editDraft.carrierOther ?? ''}
                onChange={(event) => setEditDraft((prev) => ({ ...prev, carrierOther: event.target.value }))}
              />
            )}
            <TextInput
              label="Carrier tracking number"
              id="editCarrierTrackingNumber"
              value={editDraft.carrierTrackingNumber ?? ''}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, carrierTrackingNumber: event.target.value }))}
            />
            <TextInput
              label="Quantity"
              id="editQuantity"
              type="number"
              min={record.allocatedQuantity || 1}
              value={String(editDraft.quantity ?? record.quantity)}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, quantity: Number(event.target.value) || 1 }))}
            />
            <TextInput
              label="Description"
              id="editDescription"
              value={editDraft.description ?? ''}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, description: event.target.value }))}
            />
          </div>
          <TextArea
            label="Notes"
            id="editNotes"
            rows={2}
            className="mt-4"
            value={editDraft.notes ?? ''}
            onChange={(event) => setEditDraft((prev) => ({ ...prev, notes: event.target.value }))}
          />
          {editError && <p className="mt-2 text-sm text-red-600">{editError}</p>}
          <div className="mt-4 flex gap-2">
            <Button type="button" disabled={editSaving} onClick={saveEdit}>
              {editSaving ? 'Saving…' : 'Save Correction'}
            </Button>
            <Button type="button" variant="secondary" disabled={editSaving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
