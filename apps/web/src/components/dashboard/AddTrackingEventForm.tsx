'use client';

import { useState, type FormEvent } from 'react';
import type { ShipmentItemSummary } from '@transatlantic/shared';
import { ShipmentItemStatus, ShipmentStatus, TrackingEventType } from '@transatlantic/shared';
import { SelectInput, TextArea } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { humanizeEnumValue } from '@/lib/format';
import { createTrackingEvent } from '@/lib/shipments';

/** SHIPMENT_CREATED/ITEM_REGISTERED are system-generated only — matches the API's own guard. */
const MANUAL_EVENT_TYPES = Object.values(TrackingEventType).filter(
  (type) => type !== TrackingEventType.SHIPMENT_CREATED && type !== TrackingEventType.ITEM_REGISTERED,
);

export function AddTrackingEventForm({
  shipmentId,
  items,
  onAdded,
}: {
  shipmentId: string;
  items: ShipmentItemSummary[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'shipment' | 'item'>('shipment');
  const [eventType, setEventType] = useState<TrackingEventType>(TrackingEventType.NOTE_ADDED);
  const [shipmentItemId, setShipmentItemId] = useState('');
  const [status, setStatus] = useState<ShipmentStatus | ''>('');
  const [itemStatus, setItemStatus] = useState<ShipmentItemStatus | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (scope === 'item' && !shipmentItemId) {
      setError('Select an item.');
      return;
    }
    setSubmitting(true);
    try {
      await createTrackingEvent(shipmentId, {
        eventType,
        shipmentItemId: scope === 'item' ? shipmentItemId : undefined,
        status: scope === 'shipment' && status ? status : undefined,
        itemStatus: scope === 'item' && itemStatus ? itemStatus : undefined,
        notes: notes || undefined,
      });
      setNotes('');
      setStatus('');
      setItemStatus('');
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add tracking event.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
        Add Tracking Event
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectInput
          label="Scope"
          id="eventScope"
          value={scope}
          onChange={(event) => setScope(event.target.value as 'shipment' | 'item')}
        >
          <option value="shipment">Whole shipment</option>
          <option value="item">Specific item</option>
        </SelectInput>
        <SelectInput
          label="Event type"
          id="eventType"
          value={eventType}
          onChange={(event) => setEventType(event.target.value as TrackingEventType)}
        >
          {MANUAL_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {humanizeEnumValue(type)}
            </option>
          ))}
        </SelectInput>
        {scope === 'item' && (
          <SelectInput
            label="Item"
            id="eventItem"
            value={shipmentItemId}
            onChange={(event) => setShipmentItemId(event.target.value)}
          >
            <option value="">Select an item…</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.itemCode} — {humanizeEnumValue(item.itemType)}
              </option>
            ))}
          </SelectInput>
        )}
        {scope === 'shipment' && (
          <SelectInput
            label="Update shipment status to"
            id="eventStatus"
            value={status}
            onChange={(event) => setStatus(event.target.value as ShipmentStatus | '')}
          >
            <option value="">No change</option>
            {Object.values(ShipmentStatus).map((value) => (
              <option key={value} value={value}>
                {humanizeEnumValue(value)}
              </option>
            ))}
          </SelectInput>
        )}
        {scope === 'item' && (
          <SelectInput
            label="Update item status to"
            id="eventItemStatus"
            value={itemStatus}
            onChange={(event) => setItemStatus(event.target.value as ShipmentItemStatus | '')}
          >
            <option value="">No change</option>
            {Object.values(ShipmentItemStatus).map((value) => (
              <option key={value} value={value}>
                {humanizeEnumValue(value)}
              </option>
            ))}
          </SelectInput>
        )}
      </div>
      <TextArea label="Notes" id="eventNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Add Event'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
