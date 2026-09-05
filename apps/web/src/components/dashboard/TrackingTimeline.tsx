import type { TrackingEventSummary } from '@transatlantic/shared';
import { Card } from '@/components/ui/Card';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';

/**
 * The single chronological tracking-event renderer, shared by the
 * shipment detail page (/dashboard/shipments/[id]) and the staff
 * Tracking page (/dashboard/tracking) — extracted so there is exactly
 * one place that renders TrackingEvent history, not two copies that can
 * drift. Both callers fetch the same `listTrackingEvents` data; this
 * component only renders it.
 */
export function TrackingTimeline({ events }: { events: TrackingEventSummary[] | null }) {
  if (!events || events.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500">No events yet.</p>
      </Card>
    );
  }

  return (
    <Card>
      <ol className="flex flex-col gap-4">
        {events.map((event) => (
          <li key={event.id} className="flex gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
            <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
            <div>
              <p className="text-sm font-medium text-slate-900">
                {humanizeEnumValue(event.eventType)}
                {event.shipmentItemId && (
                  <span className="ml-2 text-xs font-normal text-slate-400">(item-level)</span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {formatDateTime(event.occurredAt)}
                {event.createdByUser && ` · ${event.createdByUser.firstName} ${event.createdByUser.lastName}`}
                {event.source !== 'MANUAL' && ` · ${humanizeEnumValue(event.source)}`}
              </p>
              {event.notes && <p className="mt-1 text-sm text-slate-600">{event.notes}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
