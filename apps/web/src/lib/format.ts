/** Converts a SCREAMING_SNAKE_CASE enum value into "Title Case" for display. */
export function humanizeEnumValue(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const SUCCESS_STATUSES = new Set([
  'DELIVERED',
  'COMPLETED',
  'PICKED_UP',
  'READY_FOR_PICKUP',
  'PROCESSED',
  'READY',
  'GOOD',
]);
const NEUTRAL_STATUSES = new Set(['DRAFT', 'REGISTERED']);
const WARNING_STATUSES = new Set(['CANCELLED', 'EXCEPTION', 'HOLD', 'MINOR_DAMAGE', 'DAMAGED']);

/** Best-effort color mapping shared across ShipmentStatus, ShipmentItemStatus, etc. */
export function statusBadgeVariant(status: string): 'neutral' | 'primary' | 'accent' | 'warning' | 'success' {
  if (NEUTRAL_STATUSES.has(status)) return 'neutral';
  if (WARNING_STATUSES.has(status)) return 'warning';
  if (SUCCESS_STATUSES.has(status)) return 'success';
  return 'primary';
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
