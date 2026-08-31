import type { PublicTrackingResult } from '@transatlantic/shared';
import { IconBox, IconCheckCircle, IconClock, IconMapPin } from '@/components/icons';
import { humanizeEnumValue, formatDateTime } from '@/lib/format';

/**
 * Renders Stage 2A's curated public tracking projection — purely
 * presentational, every field it reads (labels, dates, city/country
 * strings, item codes/descriptions) already came out of
 * TrackingService's customer-safe response. This component makes no
 * further decisions about what's safe to show; it just lays out what the
 * API already decided to include.
 */

/** Label-text-based color heuristic — these are curated customer labels (see packages/shared/tracking-milestones.ts), never raw internal enum values, so matching on the label string is the only signal available here (and the only one that should be). */
const POSITIVE_LABELS = new Set(['Delivered', 'Picked up', 'Completed', 'Ready for pickup']);
const ATTENTION_LABELS = new Set(['On hold — contact us', 'Cancelled']);

function milestoneBadgeClass(label: string, isCompleted?: boolean): string {
  if (ATTENTION_LABELS.has(label)) return 'bg-amber-50 text-amber-800 border-amber-200';
  if (isCompleted || POSITIVE_LABELS.has(label)) return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  return 'bg-primary-50 text-primary-800 border-primary-200';
}

function MilestoneBadge({ label, isCompleted }: { label: string; isCompleted?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-semibold ${milestoneBadgeClass(label, isCompleted)}`}
    >
      {label}
    </span>
  );
}

export function TrackingResult({ result }: { result: PublicTrackingResult }) {
  const hasMultipleItems = result.items.length > 1;

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tracking Number</p>
            <p className="mt-1 font-display text-xl font-semibold text-slate-900">{result.trackingNumber}</p>
          </div>
          <MilestoneBadge label={result.overallMilestone.label} isCompleted={result.isCompleted} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex items-start gap-3">
            <IconMapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Route</p>
              <p className="mt-0.5 text-sm text-slate-700">
                {result.originCountry} → {result.destinationCountry}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <IconBox className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items</p>
              <p className="mt-0.5 text-sm text-slate-700">
                {result.itemSummary.completed} of {result.itemSummary.total} item
                {result.itemSummary.total === 1 ? '' : 's'} {result.isCompleted ? 'complete' : 'in progress'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {hasMultipleItems && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
          <h2 className="font-display text-base font-semibold text-slate-900">Item status</h2>
          <p className="mt-1 text-sm text-slate-500">
            This shipment has {result.items.length} items — each can reach its final stage independently, so the
            shipment above only shows complete once every item does.
          </p>
          <ul className="mt-4 flex flex-col divide-y divide-slate-100">
            {result.items.map((item) => (
              <li key={item.itemCode} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-mono text-xs text-slate-500">{item.itemCode}</p>
                  <p className="text-sm text-slate-700">{item.description ?? humanizeEnumValue(item.itemType)}</p>
                </div>
                <MilestoneBadge label={item.milestone.label} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <h2 className="font-display text-base font-semibold text-slate-900">Tracking history</h2>
        {result.timeline.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No tracking history yet — check back soon.</p>
        ) : (
          <ol className="mt-5 flex flex-col">
            {result.timeline.map((milestone, index) => {
              const isLast = index === result.timeline.length - 1;
              return (
                <li key={`${milestone.label}-${milestone.occurredAt}`} className="relative flex gap-4 pb-6 last:pb-0">
                  {!isLast && (
                    <span className="absolute left-[9px] top-5 h-full w-px bg-slate-200" aria-hidden="true" />
                  )}
                  <span className="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-700">
                    <IconCheckCircle className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{milestone.label}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                      <IconClock className="h-3.5 w-3.5 shrink-0" />
                      {formatDateTime(milestone.occurredAt)}
                      {milestone.location && <span>· {milestone.location}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
