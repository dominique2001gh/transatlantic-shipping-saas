'use client';

import { useState } from 'react';
import type { ShipmentSummary } from '@transatlantic/shared';
import { TextArea, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { updateShipment, type UpdateShipmentInput } from '@/lib/shipments';

type FieldKey = keyof UpdateShipmentInput;

function draftFrom(shipment: ShipmentSummary): Record<FieldKey, string> {
  return {
    originLocation: shipment.originLocation ?? '',
    destinationCountry: shipment.destinationCountry ?? '',
    destinationLocation: shipment.destinationLocation ?? '',
    originWarehouseId: '',
    destinationWarehouseId: '',
    routeId: '',
    description: shipment.description ?? '',
    declaredValue: shipment.declaredValue ?? '',
    currency: shipment.currency ?? '',
    recipientName: shipment.recipientName ?? '',
    recipientPhone: shipment.recipientPhone ?? '',
    recipientEmail: shipment.recipientEmail ?? '',
    recipientAddressLine1: shipment.recipientAddressLine1 ?? '',
    recipientAddressLine2: shipment.recipientAddressLine2 ?? '',
    recipientCity: shipment.recipientCity ?? '',
    recipientState: shipment.recipientState ?? '',
    recipientCountry: shipment.recipientCountry ?? '',
    recipientPostalCode: shipment.recipientPostalCode ?? '',
    confirmLabelRegeneration: '',
    reason: '',
  };
}

const ORIGINAL_VALUE: Partial<Record<FieldKey, (shipment: ShipmentSummary) => string>> = {
  originLocation: (s) => s.originLocation ?? '',
  destinationCountry: (s) => s.destinationCountry ?? '',
  destinationLocation: (s) => s.destinationLocation ?? '',
  description: (s) => s.description ?? '',
  declaredValue: (s) => s.declaredValue ?? '',
  currency: (s) => s.currency ?? '',
  recipientName: (s) => s.recipientName ?? '',
  recipientPhone: (s) => s.recipientPhone ?? '',
  recipientEmail: (s) => s.recipientEmail ?? '',
  recipientAddressLine1: (s) => s.recipientAddressLine1 ?? '',
  recipientAddressLine2: (s) => s.recipientAddressLine2 ?? '',
  recipientCity: (s) => s.recipientCity ?? '',
  recipientState: (s) => s.recipientState ?? '',
  recipientCountry: (s) => s.recipientCountry ?? '',
  recipientPostalCode: (s) => s.recipientPostalCode ?? '',
};

/**
 * Shipment Editing Phase 4: deliberately builds the PATCH body from only
 * the fields the user actually changed (diffed against the loaded
 * shipment), rather than always sending every field. The server's
 * editable-field allowlist is keyed on which keys are PRESENT in the
 * request body (see ShipmentsService.resolveEditTier), not on whether a
 * value differs — sending an untouched field on a narrow lifecycle tier
 * (e.g. DEPARTED, which only allows `description`) would otherwise 400 as
 * a disallowed field even though nothing about it actually changed. This
 * form also deliberately does NOT re-implement the server's lifecycle-
 * tier table — it reacts to the server's own 409 (label-regeneration
 * confirmation) and 400 (reason required) responses instead, so the one
 * real tier table never has to be kept in sync in two places.
 */
export function ShipmentEditForm({
  shipment,
  onSaved,
  onCancel,
}: {
  shipment: ShipmentSummary;
  onSaved: (updated: ShipmentSummary) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(shipment));
  const [needsLabelConfirmation, setNeedsLabelConfirmation] = useState(false);
  const [needsReason, setNeedsReason] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(field: FieldKey, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function buildChangedPatch(): UpdateShipmentInput {
    const patch: UpdateShipmentInput = {};
    for (const [key, getOriginal] of Object.entries(ORIGINAL_VALUE) as [FieldKey, (s: ShipmentSummary) => string][]) {
      const current = draft[key].trim();
      const original = getOriginal(shipment).trim();
      if (current === original) continue;
      if (key === 'declaredValue') {
        patch.declaredValue = current ? Number(current) : undefined;
      } else {
        (patch as Record<string, string | undefined>)[key] = current || undefined;
      }
    }
    return patch;
  }

  async function handleSave(confirmLabelRegeneration?: boolean) {
    const patch = buildChangedPatch();
    if (Object.keys(patch).length === 0 && !confirmLabelRegeneration) {
      onCancel();
      return;
    }
    if (confirmLabelRegeneration) patch.confirmLabelRegeneration = true;
    if (needsReason) {
      if (!reason.trim()) {
        setError('A reason is required to edit a shipment in this status.');
        return;
      }
      patch.reason = reason.trim();
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await updateShipment(shipment.id, patch);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409 && err.message.toLowerCase().includes('label')) {
        setNeedsLabelConfirmation(true);
        setError(err.message);
      } else if (err instanceof ApiError && err.statusCode === 400 && err.message.toLowerCase().includes('reason')) {
        setNeedsReason(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to save these changes.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900">Edit Shipment</h2>
      <p className="mt-1 text-xs text-slate-500">
        Only the fields you change are submitted. Whether a field can be edited right now depends on this shipment&apos;s
        current status — the server will explain if something isn&apos;t allowed.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Destination country" id="editDestinationCountry" value={draft.destinationCountry} onChange={(e) => setField('destinationCountry', e.target.value)} />
        <TextInput label="Destination location" id="editDestinationLocation" value={draft.destinationLocation} onChange={(e) => setField('destinationLocation', e.target.value)} />
        <TextInput label="Declared value" id="editDeclaredValue" type="number" value={draft.declaredValue} onChange={(e) => setField('declaredValue', e.target.value)} />
        <TextInput label="Currency" id="editCurrency" value={draft.currency} onChange={(e) => setField('currency', e.target.value)} />
      </div>
      <TextArea label="Description" id="editDescription" rows={2} className="mt-4" value={draft.description} onChange={(e) => setField('description', e.target.value)} />

      <div className="mt-4 rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Recipient at destination</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput label="Recipient name" id="editRecipientName" value={draft.recipientName} onChange={(e) => setField('recipientName', e.target.value)} />
          <TextInput label="Recipient phone" id="editRecipientPhone" value={draft.recipientPhone} onChange={(e) => setField('recipientPhone', e.target.value)} />
          <TextInput label="Recipient email" id="editRecipientEmail" value={draft.recipientEmail} onChange={(e) => setField('recipientEmail', e.target.value)} />
        </div>
      </div>

      {needsReason && (
        <div className="mt-4">
          <TextInput
            label="Reason for this correction"
            id="editReason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
          {needsLabelConfirmation && (
            <div className="mt-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => handleSave(true)}>
                {saving ? 'Saving…' : 'Yes, update the printed label too'}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" disabled={saving} onClick={() => handleSave()}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
