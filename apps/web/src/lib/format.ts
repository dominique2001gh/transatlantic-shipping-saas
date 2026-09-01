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
  'ARRIVED',
  'ARRIVED_DESTINATION',
  'RECEIVED_DESTINATION_WAREHOUSE',
  'CLOSED',
  'PAID',
]);
const NEUTRAL_STATUSES = new Set(['DRAFT', 'REGISTERED', 'UNLOADING']);
const WARNING_STATUSES = new Set([
  'CANCELLED',
  'EXCEPTION',
  'HOLD',
  'MINOR_DAMAGE',
  'DAMAGED',
  'OVERDUE',
  'VOID',
  'FAILED',
]);

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

/** Date-only variant of formatDateTime, for contexts (shipment lists/summaries) that don't need a time-of-day. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * Stage 3D: formats a backend money field (always a fixed 2-decimal-place
 * string, e.g. "1234.50" — see InvoiceSummary's doc comment) for display
 * only, e.g. "$1,234.50". Never used for arithmetic — the Number()
 * conversion here exists purely to hand the value to Intl.NumberFormat;
 * no computed value derived from it is ever sent back to the API or used
 * in a calculation. The exact Decimal string from the backend remains the
 * source of truth everywhere else.
 */
export function formatCurrency(amount: string, currency: string): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return amount;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${amount}`;
  }
}
