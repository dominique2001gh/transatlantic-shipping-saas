import { ShipmentStatus } from '@transatlantic/shared';

/**
 * SMS/Twilio MVP: exactly the 5 shipment-lifecycle milestones approved for
 * SMS — deliberately a hardcoded allow-list, not "every notifiable
 * SHIPMENT_STATUS_MILESTONES entry" (which also includes CUSTOMS_CLEARED
 * and OUT_FOR_DELIVERY). Same posture WHATSAPP_SUPPORTED_SHIPMENT_STATUSES
 * and EMAIL_TEMPLATED_SHIPMENT_STATUSES already document for their own
 * channels: a status notifiable for email/IN_APP but absent here simply
 * never gets an SMS attempt — an explicit scope boundary, not a bug.
 * DELIVERED and COMPLETED are both included (a driver-delivery reaches
 * DELIVERED; a customer-pickup reaches COMPLETED directly) — see
 * NotificationsService.buildShipmentSmsContent's own doc comment for how
 * the redundant COMPLETED-after-DELIVERED case is suppressed so a
 * driver-delivered shipment never gets two "you're all set" texts.
 */
const SMS_SUPPORTED_SHIPMENT_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  ShipmentStatus.WAREHOUSE_RECEIVED,
  ShipmentStatus.DEPARTED,
  ShipmentStatus.ARRIVED_DESTINATION,
  ShipmentStatus.READY_FOR_PICKUP,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.COMPLETED,
]);

export function isSmsSupportedShipmentStatus(status: ShipmentStatus): boolean {
  return SMS_SUPPORTED_SHIPMENT_STATUSES.has(status);
}

/**
 * Pure, side-effect-free SMS body builder — mirrors shipment-customer-
 * emails.ts's own separation (DB fetches stay in NotificationsService,
 * this file only ever turns already-resolved values into text) so this
 * copy can be unit-tested without a database.
 *
 * Deliberately terse and GSM-7-safe (plain ASCII punctuation only — no
 * em dashes, smart quotes, or emoji) to stay close to one SMS segment
 * (160 chars) — a single non-GSM-7 character anywhere in the body drops
 * the per-segment limit to 70 chars and can silently double the cost of
 * every send. `tenantName` (not `legalName`) matches the shorter,
 * customer-recognizable form a business actually goes by — the same
 * field WhatsApp/email already treat as the tenant's own display name.
 * No ETA/pickup-location detail is included here (unlike the email
 * templates) — deliberately out of MVP scope to keep the message short;
 * the tracking link is where a customer gets that detail.
 */
export function buildShipmentSmsBody(params: { tenantName: string; trackingNumber: string; status: ShipmentStatus; trackingUrl: string | null }): string | null {
  const { tenantName, trackingNumber, trackingUrl, status } = params;
  const trackLine = trackingUrl ? ` Track: ${trackingUrl}` : '';

  switch (status) {
    case ShipmentStatus.WAREHOUSE_RECEIVED:
      return `${tenantName}: We've received shipment ${trackingNumber}.${trackLine}`;
    case ShipmentStatus.DEPARTED:
      return `${tenantName}: Shipment ${trackingNumber} has departed and is on its way.${trackLine}`;
    case ShipmentStatus.ARRIVED_DESTINATION:
      return `${tenantName}: Shipment ${trackingNumber} has arrived at destination.${trackLine}`;
    case ShipmentStatus.READY_FOR_PICKUP:
      return `${tenantName}: Shipment ${trackingNumber} is ready for pickup.${trackLine}`;
    case ShipmentStatus.DELIVERED:
      return `${tenantName}: Shipment ${trackingNumber} has been delivered. Thank you for shipping with us.${trackLine}`;
    case ShipmentStatus.COMPLETED:
      return `${tenantName}: Shipment ${trackingNumber} has been picked up. Thank you for shipping with us.${trackLine}`;
    default:
      return null;
  }
}
