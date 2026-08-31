import type { PortalShipmentSummary } from '@transatlantic/shared';

/**
 * Groups a portal shipment by its curated milestone label (see
 * packages/shared/tracking-milestones.ts) for the customer dashboard's
 * summary tiles. Matches on label *text* — never a raw status enum — the
 * same "the curated label is the only signal available, and the only one
 * that should be" approach TrackingResult.tsx already uses for public
 * tracking. Stage 2C-4 is where that heuristic and this one get
 * consolidated into one shared place; kept local/duplicated here for now
 * rather than reaching into a component not otherwise part of this stage.
 */
const IN_TRANSIT_LABELS = new Set(['Departed origin', 'In transit']);
const ARRIVED_OR_READY_LABELS = new Set([
  'Arrived at destination',
  'In customs clearance',
  'Customs cleared',
  'Ready for pickup',
  'Out for delivery',
]);
const TERMINAL_LABELS = new Set(['Completed', 'Cancelled']);

export type ShipmentBucket = 'inTransit' | 'arrivedOrReady' | 'completed' | 'other';

export function bucketForShipment(shipment: PortalShipmentSummary): ShipmentBucket {
  const label = shipment.overallMilestone.label;
  if (shipment.isCompleted || label === 'Completed') return 'completed';
  if (IN_TRANSIT_LABELS.has(label)) return 'inTransit';
  if (ARRIVED_OR_READY_LABELS.has(label)) return 'arrivedOrReady';
  return 'other';
}

/** "Active" = not completed and not cancelled — everything still in progress. */
export function isActiveShipment(shipment: PortalShipmentSummary): boolean {
  return !shipment.isCompleted && !TERMINAL_LABELS.has(shipment.overallMilestone.label);
}

const POSITIVE_LABELS = new Set(['Delivered', 'Picked up', 'Completed', 'Ready for pickup']);
const ATTENTION_LABELS = new Set(['On hold — contact us', 'Cancelled']);

/** Maps a milestone label to one of the existing Badge component's variants — same label-based heuristic as TrackingResult.tsx's MilestoneBadge. */
export function milestoneBadgeVariant(label: string, isCompleted?: boolean): 'success' | 'warning' | 'primary' {
  if (ATTENTION_LABELS.has(label)) return 'warning';
  if (isCompleted || POSITIVE_LABELS.has(label)) return 'success';
  return 'primary';
}
