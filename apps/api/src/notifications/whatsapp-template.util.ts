import { ShipmentStatus } from '@transatlantic/shared';

/** The exact request shape MetaWhatsAppProvider needs to send an approved-template message. */
export interface WhatsAppTemplatePayload {
  name: string;
  language: string;
  /** Positional {{1}}, {{2}}, ... body variables, in order — Meta templates take no named params. */
  params: string[];
}

/**
 * WhatsApp Integration (Stage 4C) Phase 1: exactly the shipment-status
 * milestones approved for this phase — deliberately a hardcoded allow-
 * list, not "every notifiable SHIPMENT_STATUS_MILESTONES entry" (which
 * also includes CUSTOMS_CLEARED). Two independent reasons a status must
 * be in both places to actually notify: SHIPMENT_STATUS_MILESTONES
 * decides whether email/SMS/IN_APP fire at all (unchanged, untouched by
 * this file); this list decides, additionally, whether a WhatsApp
 * attempt is made for that same occurrence. A status notifiable for
 * email but absent here (CUSTOMS_CLEARED today) simply never gets a
 * WhatsApp attempt yet — not a bug, an explicit scope boundary — until a
 * real approved Meta template exists for it and it's added here.
 */
const WHATSAPP_SUPPORTED_SHIPMENT_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  ShipmentStatus.WAREHOUSE_RECEIVED,
  ShipmentStatus.DEPARTED,
  ShipmentStatus.ARRIVED_DESTINATION,
  ShipmentStatus.READY_FOR_PICKUP,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.COMPLETED,
]);

/**
 * Builds the approved-template payload for a shipment-status-changed
 * occurrence, or `null` if this status isn't (yet) WhatsApp-supported —
 * callers treat `null` as "skip WhatsApp for this one, every other
 * channel is unaffected," never as an error.
 *
 * Deliberately ONE generic template covering every supported milestone
 * (reusing the exact same customer-facing label text
 * SHIPMENT_STATUS_MILESTONES already provides for email), rather than one
 * Meta-approved template per status — Meta template approval is a real,
 * per-template, per-tenant submission process; one template with two
 * body variables ({{1}} tracking number, {{2}} status label) is far
 * simpler to get approved and maintain than seven, and trivially extends
 * to a future status by adding it to the allow-list above with zero new
 * template submissions.
 */
export function buildShipmentStatusWhatsAppTemplate(
  status: ShipmentStatus,
  trackingNumber: string,
  milestoneLabel: string,
  templateName: string,
  templateLanguage: string,
): WhatsAppTemplatePayload | null {
  if (!WHATSAPP_SUPPORTED_SHIPMENT_STATUSES.has(status)) {
    return null;
  }
  return {
    name: templateName,
    language: templateLanguage,
    params: [trackingNumber, milestoneLabel],
  };
}
