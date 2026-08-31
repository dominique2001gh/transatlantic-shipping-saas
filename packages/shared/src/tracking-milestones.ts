import { ShipmentItemStatus, ShipmentStatus } from './enums';

/**
 * Stage 2A (customer/public tracking). Curated, customer-facing wording
 * for every internal ShipmentStatus/ShipmentItemStatus value — the single
 * mapping consumed by both the public tracking lookup and (later) the
 * authenticated customer portal, so the two surfaces can never drift into
 * inconsistent wording. Deliberately lives in the shared package, not
 * apps/api, so a future frontend can reuse the exact same labels rather
 * than re-deriving them.
 *
 * This is a presentation layer only — it never decides shipment/item
 * state (that stays entirely owned by WarehouseService/ManifestsService/
 * ShipmentsService's existing rollups) and it never surfaces the
 * operational TrackingEvent rows themselves (notes/metadata/staff
 * identity) — only a label for whichever stage the shipment/item is
 * currently denormalized as being in.
 *
 * `notifiable` marks which milestones are meaningful enough to eventually
 * trigger an email/SMS/WhatsApp notification (Stage 3, not implemented
 * here) — e.g. "Out for Delivery" is notification-worthy, "Processing" is
 * not. Purely metadata for now; nothing reads it yet.
 */
export interface CustomerMilestone {
  label: string;
  notifiable: boolean;
}

/**
 * DRAFT/QUOTE_REQUESTED/AWAITING_ITEMS/CANCELLED are intentionally
 * included (not omitted) — a customer who has a tracking number for a
 * cancelled or not-yet-dropped-off shipment should still get an honest,
 * specific answer, not a generic failure.
 */
export const SHIPMENT_STATUS_MILESTONES: Record<ShipmentStatus, CustomerMilestone> = {
  [ShipmentStatus.DRAFT]: { label: 'Shipment created', notifiable: false },
  [ShipmentStatus.QUOTE_REQUESTED]: { label: 'Quote requested', notifiable: false },
  [ShipmentStatus.AWAITING_ITEMS]: { label: 'Awaiting drop-off', notifiable: false },
  [ShipmentStatus.WAREHOUSE_RECEIVED]: { label: 'Received at origin warehouse', notifiable: true },
  [ShipmentStatus.PROCESSING]: { label: 'Processing', notifiable: false },
  [ShipmentStatus.READY_FOR_CONSOLIDATION]: { label: 'Prepared for shipment', notifiable: false },
  [ShipmentStatus.CONSOLIDATED]: { label: 'Prepared for shipment', notifiable: false },
  [ShipmentStatus.BOOKED]: { label: 'Booked for shipment', notifiable: false },
  [ShipmentStatus.LOADED]: { label: 'Loaded for shipment', notifiable: false },
  [ShipmentStatus.DEPARTED]: { label: 'Departed origin', notifiable: true },
  [ShipmentStatus.IN_TRANSIT]: { label: 'In transit', notifiable: false },
  [ShipmentStatus.ARRIVED_DESTINATION]: { label: 'Arrived at destination', notifiable: true },
  [ShipmentStatus.CUSTOMS_PROCESSING]: { label: 'In customs clearance', notifiable: false },
  [ShipmentStatus.CUSTOMS_CLEARED]: { label: 'Customs cleared', notifiable: true },
  [ShipmentStatus.READY_FOR_PICKUP]: { label: 'Ready for pickup', notifiable: true },
  [ShipmentStatus.OUT_FOR_DELIVERY]: { label: 'Out for delivery', notifiable: true },
  [ShipmentStatus.DELIVERED]: { label: 'Delivered', notifiable: true },
  [ShipmentStatus.COMPLETED]: { label: 'Completed', notifiable: true },
  [ShipmentStatus.CANCELLED]: { label: 'Cancelled', notifiable: false },
};

/**
 * Per-item equivalent, same shape. EXCEPTION deliberately gets a generic,
 * non-alarming label — the real reason (damage, refusal, loss, etc.) is
 * staff-only and must never reach this projection.
 */
export const ITEM_STATUS_MILESTONES: Record<ShipmentItemStatus, CustomerMilestone> = {
  [ShipmentItemStatus.REGISTERED]: { label: 'Registered', notifiable: false },
  [ShipmentItemStatus.RECEIVED_ORIGIN_WAREHOUSE]: { label: 'Received at origin warehouse', notifiable: true },
  [ShipmentItemStatus.MEASURED]: { label: 'Processing', notifiable: false },
  [ShipmentItemStatus.PROCESSED]: { label: 'Processed', notifiable: false },
  [ShipmentItemStatus.CONSOLIDATED]: { label: 'Prepared for shipment', notifiable: false },
  [ShipmentItemStatus.ASSIGNED_TO_CONTAINER]: { label: 'Prepared for shipment', notifiable: false },
  [ShipmentItemStatus.ASSIGNED_TO_MANIFEST]: { label: 'Prepared for shipment', notifiable: false },
  [ShipmentItemStatus.LOADED]: { label: 'Loaded for shipment', notifiable: false },
  [ShipmentItemStatus.DEPARTED_ORIGIN]: { label: 'Departed origin', notifiable: true },
  [ShipmentItemStatus.IN_TRANSIT]: { label: 'In transit', notifiable: false },
  [ShipmentItemStatus.ARRIVED_DESTINATION]: { label: 'Arrived at destination', notifiable: true },
  [ShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE]: { label: 'Arrived at destination warehouse', notifiable: true },
  [ShipmentItemStatus.READY_FOR_PICKUP]: { label: 'Ready for pickup', notifiable: true },
  [ShipmentItemStatus.OUT_FOR_DELIVERY]: { label: 'Out for delivery', notifiable: true },
  [ShipmentItemStatus.DELIVERED]: { label: 'Delivered', notifiable: true },
  [ShipmentItemStatus.PICKED_UP]: { label: 'Picked up', notifiable: true },
  [ShipmentItemStatus.EXCEPTION]: { label: 'On hold — contact us', notifiable: false },
  [ShipmentItemStatus.CANCELLED]: { label: 'Cancelled', notifiable: false },
};
