'use client';

import { useState, type FormEvent } from 'react';
import { ShipmentItemType, ShipmentMode } from '@transatlantic/shared';
import { Button } from '@/components/ui/Button';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import {
  ITEM_TYPE_LABELS,
  SHIPMENT_MODE_LABELS,
  submitQuoteRequest,
  type QuoteRequestInput,
} from '@/lib/quote';

const initialValues: QuoteRequestInput = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  originCountry: '',
  originCity: '',
  destinationCountry: '',
  destinationCity: '',
  shipmentMode: ShipmentMode.OCEAN_LCL,
  itemType: ShipmentItemType.BOX,
  approximateWeight: '',
  length: '',
  width: '',
  height: '',
  description: '',
  additionalNotes: '',
};

export function QuoteForm() {
  const [values, setValues] = useState<QuoteRequestInput>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof QuoteRequestInput>(key: K, value: QuoteRequestInput[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitQuoteRequest(values);
      setSubmitted(true);
    } catch {
      setError('Something went wrong submitting your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8">
        <p className="font-display text-lg font-semibold text-emerald-800">Quote request received</p>
        <p className="mt-2 text-sm text-emerald-700">
          Thanks{values.firstName ? `, ${values.firstName}` : ''} — our team will review your shipment
          details and follow up by email or phone.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-10" noValidate>
      <fieldset className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <legend className="mb-1 font-display text-lg font-semibold text-slate-900 sm:col-span-2">
          Contact information
        </legend>
        <TextInput
          label="First name"
          id="firstName"
          required
          value={values.firstName}
          onChange={(event) => update('firstName', event.target.value)}
        />
        <TextInput
          label="Last name"
          id="lastName"
          required
          value={values.lastName}
          onChange={(event) => update('lastName', event.target.value)}
        />
        <TextInput
          label="Email"
          id="email"
          type="email"
          required
          value={values.email}
          onChange={(event) => update('email', event.target.value)}
        />
        <TextInput
          label="Phone"
          id="phone"
          type="tel"
          required
          value={values.phone}
          onChange={(event) => update('phone', event.target.value)}
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <legend className="mb-1 font-display text-lg font-semibold text-slate-900 sm:col-span-2">
          Shipment route
        </legend>
        <TextInput
          label="Origin country"
          id="originCountry"
          required
          value={values.originCountry}
          onChange={(event) => update('originCountry', event.target.value)}
        />
        <TextInput
          label="Origin city / state"
          id="originCity"
          required
          value={values.originCity}
          onChange={(event) => update('originCity', event.target.value)}
        />
        <TextInput
          label="Destination country"
          id="destinationCountry"
          required
          value={values.destinationCountry}
          onChange={(event) => update('destinationCountry', event.target.value)}
        />
        <TextInput
          label="Destination city / region"
          id="destinationCity"
          required
          value={values.destinationCity}
          onChange={(event) => update('destinationCity', event.target.value)}
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <legend className="mb-1 font-display text-lg font-semibold text-slate-900 sm:col-span-2">
          Shipment details
        </legend>
        <SelectInput
          label="Shipping method"
          id="shipmentMode"
          required
          value={values.shipmentMode}
          onChange={(event) => update('shipmentMode', event.target.value as ShipmentMode)}
        >
          {Object.entries(SHIPMENT_MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          label="Item type"
          id="itemType"
          required
          value={values.itemType}
          onChange={(event) => update('itemType', event.target.value as ShipmentItemType)}
        >
          {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Approximate weight (lb or kg)"
          id="approximateWeight"
          value={values.approximateWeight}
          onChange={(event) => update('approximateWeight', event.target.value)}
        />
        <div className="grid grid-cols-3 gap-3">
          <TextInput
            label="Length"
            id="length"
            value={values.length}
            onChange={(event) => update('length', event.target.value)}
          />
          <TextInput
            label="Width"
            id="width"
            value={values.width}
            onChange={(event) => update('width', event.target.value)}
          />
          <TextInput
            label="Height"
            id="height"
            value={values.height}
            onChange={(event) => update('height', event.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-5">
        <legend className="mb-1 font-display text-lg font-semibold text-slate-900">Cargo description</legend>
        <TextArea
          label="Description of goods"
          id="description"
          rows={3}
          required
          value={values.description}
          onChange={(event) => update('description', event.target.value)}
        />
        <TextArea
          label="Additional notes"
          id="additionalNotes"
          rows={3}
          value={values.additionalNotes}
          onChange={(event) => update('additionalNotes', event.target.value)}
        />
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Request Quote'}
        </Button>
        <p className="mt-3 text-xs text-slate-500">
          This is a quote request, not an instant rate calculator. Our team will follow up with pricing
          based on your shipment details.
        </p>
      </div>
    </form>
  );
}
