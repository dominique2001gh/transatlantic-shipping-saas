'use client';

import { useState, type FormEvent } from 'react';
import type { PreRegistrationFormFields } from '@transatlantic/shared';
import { ShipmentItemType, ShipmentMode } from '@transatlantic/shared';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { humanizeEnumValue } from '@/lib/format';

const SHIPMENT_MODES = Object.values(ShipmentMode);
const ITEM_TYPES = Object.values(ShipmentItemType);

/**
 * Customer Self-Service Pre-Registration, Stage 2: the "Prepare a Drop-Off"
 * form, shared by the new-record page and the DRAFT-editing view on the
 * detail page — same field list as CreatePreRegistrationDto/
 * UpdatePreRegistrationDto on the API, so there is exactly one place that
 * knows the shape of this form. Deliberately collects only recipient and
 * shipment details — the sender is whoever is logged in, already shown
 * read-only above this form by the page that renders it, never re-asked
 * here.
 */
export function PreRegistrationForm({
  initialValues,
  onSaveDraft,
  onSubmit,
  saving,
  submitting,
  saveLabel = 'Save as Draft',
}: {
  initialValues?: PreRegistrationFormFields;
  onSaveDraft?: (values: PreRegistrationFormFields) => void;
  onSubmit: (values: PreRegistrationFormFields) => void;
  saving?: boolean;
  submitting?: boolean;
  saveLabel?: string;
}) {
  const [values, setValues] = useState<PreRegistrationFormFields>({
    shipmentMode: initialValues?.shipmentMode,
    destinationCountry: initialValues?.destinationCountry ?? '',
    destinationLocation: initialValues?.destinationLocation ?? '',
    itemType: initialValues?.itemType,
    description: initialValues?.description ?? '',
    packageCount: initialValues?.packageCount,
    notes: initialValues?.notes ?? '',
    recipientName: initialValues?.recipientName ?? '',
    recipientPhone: initialValues?.recipientPhone ?? '',
    recipientEmail: initialValues?.recipientEmail ?? '',
    recipientAddressLine1: initialValues?.recipientAddressLine1 ?? '',
    recipientAddressLine2: initialValues?.recipientAddressLine2 ?? '',
    recipientCity: initialValues?.recipientCity ?? '',
    recipientState: initialValues?.recipientState ?? '',
    recipientCountry: initialValues?.recipientCountry ?? '',
    recipientPostalCode: initialValues?.recipientPostalCode ?? '',
  });

  function set<K extends keyof PreRegistrationFormFields>(key: K, value: PreRegistrationFormFields[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  /** Strips blank strings/undefined so the API never receives e.g. destinationCountry: "" and treats it as a meaningful value. */
  function cleanedValues(): PreRegistrationFormFields {
    const entries = Object.entries(values).filter(([, v]) => v !== '' && v !== undefined);
    return Object.fromEntries(entries) as PreRegistrationFormFields;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(cleanedValues());
  }

  function handleSaveDraft() {
    onSaveDraft?.(cleanedValues());
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold text-slate-900">Who is receiving this drop-off?</legend>
        <TextInput
          label="Recipient name"
          id="recipientName"
          value={values.recipientName}
          onChange={(e) => set('recipientName', e.target.value)}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="Recipient phone"
            id="recipientPhone"
            type="tel"
            value={values.recipientPhone}
            onChange={(e) => set('recipientPhone', e.target.value)}
          />
          <TextInput
            label="Recipient email (optional)"
            id="recipientEmail"
            type="email"
            value={values.recipientEmail}
            onChange={(e) => set('recipientEmail', e.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold text-slate-900">Where is it going?</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="Destination country"
            id="destinationCountry"
            placeholder="e.g. Ghana"
            value={values.destinationCountry}
            onChange={(e) => set('destinationCountry', e.target.value)}
          />
          <TextInput
            label="Destination city (optional)"
            id="destinationLocation"
            placeholder="e.g. Accra"
            value={values.destinationLocation}
            onChange={(e) => set('destinationLocation', e.target.value)}
          />
        </div>
        <details className="text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-primary-700">Add recipient address (optional)</summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput
              label="Address line 1"
              id="recipientAddressLine1"
              value={values.recipientAddressLine1}
              onChange={(e) => set('recipientAddressLine1', e.target.value)}
            />
            <TextInput
              label="Address line 2"
              id="recipientAddressLine2"
              value={values.recipientAddressLine2}
              onChange={(e) => set('recipientAddressLine2', e.target.value)}
            />
            <TextInput label="City" id="recipientCity" value={values.recipientCity} onChange={(e) => set('recipientCity', e.target.value)} />
            <TextInput
              label="State / Region"
              id="recipientState"
              value={values.recipientState}
              onChange={(e) => set('recipientState', e.target.value)}
            />
            <TextInput
              label="Country"
              id="recipientCountry"
              value={values.recipientCountry}
              onChange={(e) => set('recipientCountry', e.target.value)}
            />
            <TextInput
              label="Postal code"
              id="recipientPostalCode"
              value={values.recipientPostalCode}
              onChange={(e) => set('recipientPostalCode', e.target.value)}
            />
          </div>
        </details>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold text-slate-900">What are you dropping off?</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectInput
            label="Shipping mode (optional)"
            id="shipmentMode"
            value={values.shipmentMode ?? ''}
            onChange={(e) => set('shipmentMode', (e.target.value || undefined) as ShipmentMode | undefined)}
          >
            <option value="">Not sure yet</option>
            {SHIPMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {humanizeEnumValue(mode)}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Package type (optional)"
            id="itemType"
            value={values.itemType ?? ''}
            onChange={(e) => set('itemType', (e.target.value || undefined) as ShipmentItemType | undefined)}
          >
            <option value="">Not sure yet</option>
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanizeEnumValue(type)}
              </option>
            ))}
          </SelectInput>
          <TextInput
            label="Number of pieces (optional)"
            id="packageCount"
            type="number"
            min={1}
            max={50}
            value={values.packageCount ?? ''}
            onChange={(e) => set('packageCount', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
        <TextArea
          label="Description (optional)"
          id="description"
          rows={2}
          placeholder="e.g. Household goods, mixed boxes"
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
        />
        <TextArea
          label="Notes for the warehouse (optional)"
          id="notes"
          rows={2}
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </fieldset>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onSaveDraft && (
          <Button type="button" variant="secondary" onClick={handleSaveDraft} disabled={saving || submitting}>
            {saving ? 'Saving…' : saveLabel}
          </Button>
        )}
        <Button type="submit" disabled={saving || submitting}>
          {submitting ? 'Submitting…' : 'Submit Drop-Off'}
        </Button>
      </div>
    </form>
  );
}
