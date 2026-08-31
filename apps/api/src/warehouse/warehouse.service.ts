import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
// Prisma's generated enums (aliased) — used only when comparing values
// that came directly out of a Prisma query result.
import {
  HandoffType,
  ShipmentItemStatus as DbShipmentItemStatus,
  ShipmentStatus as DbShipmentStatus,
  TrackingEventSource,
} from '@prisma/client';
// The hand-maintained shared enums — used when building the object passed
// to ShipmentsService.createTrackingEvent, since its DTO is typed against
// these (not the Prisma-generated ones). Same string values as the Prisma
// enums above, but a structurally distinct TypeScript type, so the two
// sets are not interchangeable and must stay named apart.
import {
  ItemProcessingResult,
  ShipmentItemCondition,
  ShipmentItemStatus,
  ShipmentStatus,
  TrackingEventType,
} from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { DeliverItemDto } from './dto/deliver-item.dto';
import { DestinationReceiveItemDto } from './dto/destination-receive-item.dto';
import { DispatchItemDto } from './dto/dispatch-item.dto';
import { PickupItemDto } from './dto/pickup-item.dto';
import { ProcessItemDto } from './dto/process-item.dto';
import { ReceiveItemDto } from './dto/receive-item.dto';
import { ReturnItemDto } from './dto/return-item.dto';

const ACTOR_SELECT = { id: true, firstName: true, lastName: true } as const;
const WAREHOUSE_SELECT = { id: true, name: true, code: true } as const;

/**
 * "Reached at least PROCESSED" — same "reached at least this stage"
 * pattern already established in ManifestsService (ITEM_COMMITTED_OR_LATER
 * etc.), applied here to fix a real, pre-existing bug in
 * maybeRollupToReadyForConsolidation: an item that has moved *past*
 * PROCESSED (e.g. already ASSIGNED_TO_CONTAINER because it was loaded
 * before a sibling item finished processing) is still, correctly,
 * "processed" — an exact `status === PROCESSED` check would permanently
 * stop matching that item the moment it advances, which meant a
 * multi-item shipment processed and loaded in an interleaved order
 * (process item1, load item1, process item2, load item2 — a completely
 * normal floor-staff sequence) could get stuck at PROCESSING forever,
 * never reaching READY_FOR_CONSOLIDATION, even though every item was
 * legitimately fully processed. Discovered via Milestone 3F's own
 * multi-item destination-receive testing, not something that milestone
 * introduced.
 */
const ITEM_PROCESSED_OR_LATER: DbShipmentItemStatus[] = [
  DbShipmentItemStatus.PROCESSED,
  DbShipmentItemStatus.CONSOLIDATED,
  DbShipmentItemStatus.ASSIGNED_TO_CONTAINER,
  DbShipmentItemStatus.ASSIGNED_TO_MANIFEST,
  DbShipmentItemStatus.LOADED,
  DbShipmentItemStatus.DEPARTED_ORIGIN,
  DbShipmentItemStatus.IN_TRANSIT,
  DbShipmentItemStatus.ARRIVED_DESTINATION,
  DbShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE,
  DbShipmentItemStatus.READY_FOR_PICKUP,
  DbShipmentItemStatus.OUT_FOR_DELIVERY,
  DbShipmentItemStatus.DELIVERED,
  DbShipmentItemStatus.PICKED_UP,
];

/**
 * The two terminal "cargo actually left the building" outcomes a
 * ShipmentItem can reach — PICKED_UP (Customer Pickup) and DELIVERED
 * (Delivery/Driver Dispatch, via deliverItem). maybeRollupShipmentCompletion
 * below checks against this array, not against either value alone, so a
 * shipment with a mix of picked-up and delivered items (or either kind
 * alone) reaches COMPLETED the same way. This array was written during
 * Customer Pickup specifically so this Delivery milestone would not need
 * to touch the rollup itself — confirmed true, only this comment changed.
 *
 * Exported (Stage 2A) so TrackingService can compute the same "how many
 * items reached a final handoff" count for the public tracking
 * projection's itemSummary — reusing this exact array, not a second
 * hand-maintained copy of it, keeps the two "senses of complete" (the
 * real rollup vs. the customer-facing summary) impossible to drift apart.
 */
export const ITEM_TERMINAL_HANDOFF: DbShipmentItemStatus[] = [DbShipmentItemStatus.PICKED_UP, DbShipmentItemStatus.DELIVERED];

/**
 * Shared shape for every endpoint that resolves to a full ShipmentItem
 * (scan, search, receive result, process result, inventory row) — one
 * definition so the confirm panel, inventory table, and receive/process
 * responses always agree on what a "resolved item" looks like.
 */
const ITEM_DETAIL_INCLUDE = {
  shipment: {
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      destinationCountry: true,
      destinationLocation: true,
      customer: {
        select: { id: true, customerNumber: true, firstName: true, lastName: true },
      },
    },
  },
  currentWarehouse: { select: WAREHOUSE_SELECT },
  receivedByUser: { select: ACTOR_SELECT },
  lastInspectedByUser: { select: ACTOR_SELECT },
  // Only the most recent inspection is needed for a "resolved item" view —
  // the full history lives in ItemInspection and is reachable separately
  // if a dedicated history endpoint is ever added.
  inspections: {
    orderBy: { inspectedAt: 'desc' },
    take: 1,
    include: {
      inspectedByUser: { select: ACTOR_SELECT },
      warehouse: { select: WAREHOUSE_SELECT },
    },
  },
} satisfies Prisma.ShipmentItemInclude;

type ItemDetailRaw = Prisma.ShipmentItemGetPayload<{ include: typeof ITEM_DETAIL_INCLUDE }>;

/** Reshapes the raw Prisma result's plural `inspections: [at most one]` into a singular `lastInspection`. */
function presentItem(item: ItemDetailRaw) {
  const { inspections, ...rest } = item;
  return { ...rest, lastInspection: inspections[0] ?? null };
}

const ACTIVITY_ACTOR_SELECT = ACTOR_SELECT;

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentsService: ShipmentsService,
  ) {}

  listLocations(tenantId: string) {
    return this.prisma.warehouse.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Exact-match resolution for the scan fast path. Deliberately
   * indistinguishable between "no such code" and "belongs to another
   * tenant" — both produce the same 404, so a scan can never confirm
   * another tenant's item exists.
   */
  async resolveScan(tenantId: string, rawCode: string) {
    const code = rawCode.trim();
    if (!code) {
      throw new BadRequestException('Enter or scan a code.');
    }
    const item = await this.prisma.shipmentItem.findFirst({
      where: { itemCode: code, tenantId },
      include: ITEM_DETAIL_INCLUDE,
    });
    if (!item) {
      throw new NotFoundException('No item found for this code.');
    }
    return presentItem(item);
  }

  /** Manual fallback: item code, shipment tracking number, or customer name/number, partial match. */
  async searchItems(tenantId: string, rawQuery: string) {
    const query = rawQuery.trim();
    if (!query) {
      return [];
    }
    const items = await this.prisma.shipmentItem.findMany({
      where: {
        tenantId,
        OR: [
          { itemCode: { contains: query, mode: 'insensitive' } },
          { shipment: { trackingNumber: { contains: query, mode: 'insensitive' } } },
          { shipment: { customer: { customerNumber: { contains: query, mode: 'insensitive' } } } },
          { shipment: { customer: { firstName: { contains: query, mode: 'insensitive' } } } },
          { shipment: { customer: { lastName: { contains: query, mode: 'insensitive' } } } },
        ],
      },
      include: ITEM_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return items.map(presentItem);
  }

  /**
   * Receives one item — the single implementation used by both the scan
   * fast path and the manual search fallback (they differ only in the
   * `scanned`/`scanIdentifier` provenance fields). Delegates the actual
   * TrackingEvent write to ShipmentsService.createTrackingEvent so
   * receiving never diverges from the general tracking-event logic.
   */
  async receiveItem(tenantId: string, actorUserId: string, itemId: string, dto: ReceiveItemDto) {
    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled and cannot receive items.');
    }
    if (item.status !== DbShipmentItemStatus.REGISTERED) {
      if (item.receivedAt) {
        throw new ConflictException(
          `This item was already received on ${item.receivedAt.toLocaleString()}.`,
        );
      }
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible for receiving.`,
      );
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId },
    });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE,
        shipmentItemId: item.id,
        itemStatus: ShipmentItemStatus.RECEIVED_ORIGIN_WAREHOUSE,
        warehouseId: dto.warehouseId,
        notes: dto.notes,
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    await this.maybeRollupShipmentStatus(tenantId, actorUserId, item.shipmentId);

    const received = await this.prisma.shipmentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_DETAIL_INCLUDE,
    });
    return presentItem(received);
  }

  /**
   * Inspects/processes one item that has already been received. Creates
   * an append-only ItemInspection row plus the corresponding TrackingEvent
   * (never mutates a prior inspection), then copies the actual measured
   * weight/dimensions and condition forward onto ShipmentItem as the new
   * "current known" values — the same denormalization ShipmentItem.status/
   * receivedAt/receivedByUserId already use.
   *
   * A first-time process on an item that's already PROCESSED/EXCEPTION is
   * rejected (409) unless the caller explicitly sets `reinspection: true`
   * — this is what stops an accidental duplicate scan from silently
   * creating a second inspection record while still allowing a deliberate,
   * auditable reinspection.
   */
  async processItem(tenantId: string, actorUserId: string, itemId: string, dto: ProcessItemDto) {
    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled and cannot be processed.');
    }

    const REINSPECTABLE: DbShipmentItemStatus[] = [DbShipmentItemStatus.PROCESSED, DbShipmentItemStatus.EXCEPTION];
    if (item.status === DbShipmentItemStatus.RECEIVED_ORIGIN_WAREHOUSE) {
      // eligible for first-time processing — fall through
    } else if (REINSPECTABLE.includes(item.status)) {
      if (!dto.reinspection) {
        throw new ConflictException(
          `This item was already processed on ${item.lastInspectedAt?.toLocaleString() ?? 'a previous visit'} ` +
            `(status: ${item.status}). Pass reinspection: true to record a deliberate reinspection.`,
        );
      }
      // explicit reinspection — fall through
    } else {
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible for processing. ` +
          `Items must be received at a warehouse first.`,
      );
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId },
    });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }
    if (item.currentWarehouseId !== dto.warehouseId) {
      throw new ConflictException('This item is not currently at the specified warehouse.');
    }

    if (dto.hasException && !dto.exceptionDescription?.trim()) {
      throw new BadRequestException('exceptionDescription is required when hasException is true.');
    }
    // CRITICAL STATUS RULE: a damaged or flagged item can never be marked
    // READY in the same action that flags it — container loading (a later
    // milestone) will trust ShipmentItemStatus.PROCESSED alone to mean
    // "eligible," so that must never be reachable alongside damage/exception.
    if (
      dto.result === ItemProcessingResult.READY &&
      (dto.hasException || dto.condition === ShipmentItemCondition.DAMAGED)
    ) {
      throw new BadRequestException(
        'An item flagged as damaged or with an open exception cannot be marked READY. Use result: HOLD.',
      );
    }

    const newItemStatus =
      dto.result === ItemProcessingResult.READY ? ShipmentItemStatus.PROCESSED : ShipmentItemStatus.EXCEPTION;
    const eventType =
      dto.result === ItemProcessingResult.READY ? TrackingEventType.PROCESSED : TrackingEventType.EXCEPTION;
    const defaultNotes =
      dto.result === ItemProcessingResult.READY
        ? `Processed / inspected at ${warehouse.name}`
        : `Held at ${warehouse.name}${dto.exceptionDescription ? `: ${dto.exceptionDescription}` : ''}`;

    // Snapshot of what ShipmentItem's own fields were *before* this
    // inspection overwrites them, preserved in the tracking event so the
    // customer/staff-declared values aren't silently lost even though the
    // schema doesn't (yet) carry a separate "declared" column.
    const previousMeasurements = {
      weight: item.weight,
      weightUnit: item.weightUnit,
      length: item.length,
      width: item.width,
      height: item.height,
      dimensionUnit: item.dimensionUnit,
    };

    const event = await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType,
        shipmentItemId: item.id,
        itemStatus: newItemStatus,
        warehouseId: dto.warehouseId,
        notes: dto.notes ?? defaultNotes,
        metadata: {
          reinspection: !!dto.reinspection,
          condition: dto.condition,
          result: dto.result,
          hasException: !!dto.hasException,
          exceptionDescription: dto.exceptionDescription ?? null,
          actualMeasurements: {
            weight: dto.weight ?? null,
            weightUnit: dto.weightUnit ?? null,
            length: dto.length ?? null,
            width: dto.width ?? null,
            height: dto.height ?? null,
            dimensionUnit: dto.dimensionUnit ?? null,
          },
          previousMeasurements,
        },
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    await this.prisma.shipmentItem.update({
      where: { id: item.id },
      data: {
        condition: dto.condition,
        lastInspectedAt: event.occurredAt,
        lastInspectedByUserId: actorUserId,
        // Actual warehouse-measured values become the authoritative
        // operational figures going forward — only overwrite a dimension
        // that was actually supplied in this pass.
        ...(dto.weight != null ? { weight: dto.weight, weightUnit: dto.weightUnit ?? item.weightUnit } : {}),
        ...(dto.length != null ? { length: dto.length } : {}),
        ...(dto.width != null ? { width: dto.width } : {}),
        ...(dto.height != null ? { height: dto.height } : {}),
        ...(dto.dimensionUnit != null ? { dimensionUnit: dto.dimensionUnit } : {}),
      },
    });

    await this.prisma.itemInspection.create({
      data: {
        tenantId,
        shipmentId: item.shipmentId,
        shipmentItemId: item.id,
        warehouseId: dto.warehouseId,
        weight: dto.weight ?? null,
        weightUnit: dto.weightUnit ?? null,
        length: dto.length ?? null,
        width: dto.width ?? null,
        height: dto.height ?? null,
        dimensionUnit: dto.dimensionUnit ?? null,
        condition: dto.condition,
        result: dto.result,
        hasException: !!dto.hasException,
        exceptionDescription: dto.exceptionDescription ?? null,
        notes: dto.notes ?? null,
        inspectedByUserId: actorUserId,
        inspectedAt: event.occurredAt,
        trackingEventId: event.id,
      },
    });

    await this.maybeRollupToReadyForConsolidation(tenantId, actorUserId, item.shipmentId);

    const processed = await this.prisma.shipmentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_DETAIL_INCLUDE,
    });
    return presentItem(processed);
  }

  /**
   * Milestone 3F, the other half of destination receiving (see
   * ManifestsService.arrive for the bulk/automatic "container/manifest
   * arrived" half). This is the individual, staff-scanned, per-item
   * action: an item must have ARRIVED_DESTINATION (its transport unit
   * has landed) before it is eligible here, and this is the only place
   * ShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE is ever set.
   *
   * Same dual-outcome shape as processItem: a damaged or flagged item
   * can never be marked received in the same action that flags it — it
   * goes to EXCEPTION instead. A "missing" item (one that never
   * physically arrived with its container/manifest) is recorded the
   * same way: call this manually (scanned: false) with hasException:
   * true and a descriptive note — there is nothing to scan for cargo
   * that isn't there, so this is a deliberate manual-only path rather
   * than a separate endpoint.
   *
   * CRITICAL STATUS RULE (reinforced per the approved milestone spec):
   * RECEIVED_DESTINATION_WAREHOUSE means only "the destination warehouse
   * has physically reconciled this item" — it is NOT Ready for
   * Pickup/Delivery, which is a distinct, later milestone with its own
   * reconciliation/condition/hold/business-rule gate. Nothing in this
   * method (or the shipment rollups it can trigger) ever sets or implies
   * READY_FOR_PICKUP.
   */
  async destinationReceiveItem(tenantId: string, actorUserId: string, itemId: string, dto: DestinationReceiveItemDto) {
    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true, destinationWarehouseId: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled and cannot receive items.');
    }

    if (item.status !== DbShipmentItemStatus.ARRIVED_DESTINATION) {
      if (item.status === DbShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE) {
        throw new ConflictException(
          `This item was already received at the destination warehouse on ${item.lastInspectedAt?.toLocaleString() ?? 'a previous visit'}.`,
        );
      }
      if (item.status === DbShipmentItemStatus.EXCEPTION) {
        throw new ConflictException(
          'This item is on hold with an exception and cannot be received. Resolve the exception first.',
        );
      }
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible for destination receiving. ` +
          `Its manifest/container must arrive first.`,
      );
    }

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    if (dto.hasException && !dto.exceptionDescription?.trim()) {
      throw new BadRequestException('exceptionDescription is required when hasException is true.');
    }

    // Soft destination-warehouse check — a mismatch is surfaced, not
    // blocked, same posture as the container-loading destinationWarning.
    let destinationWarning: string | undefined;
    if (item.shipment.destinationWarehouseId && item.shipment.destinationWarehouseId !== dto.warehouseId) {
      destinationWarning = "This item's shipment destination warehouse does not match the warehouse selected here.";
    }

    const isGood = !dto.hasException && dto.condition !== ShipmentItemCondition.DAMAGED;
    const newItemStatus = isGood ? ShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE : ShipmentItemStatus.EXCEPTION;
    const eventType = isGood ? TrackingEventType.RECEIVED_DESTINATION_WAREHOUSE : TrackingEventType.EXCEPTION;
    const defaultNotes = isGood
      ? `Received at destination warehouse ${warehouse.name}`
      : `Held at destination warehouse ${warehouse.name}${dto.exceptionDescription ? `: ${dto.exceptionDescription}` : ''}`;

    const event = await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType,
        shipmentItemId: item.id,
        itemStatus: newItemStatus,
        warehouseId: dto.warehouseId,
        notes: dto.notes ?? defaultNotes,
        metadata: {
          condition: dto.condition,
          hasException: !!dto.hasException,
          exceptionDescription: dto.exceptionDescription ?? null,
          ...(destinationWarning ? { destinationWarning } : {}),
        },
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    await this.prisma.shipmentItem.update({
      where: { id: item.id },
      data: {
        condition: dto.condition,
        lastInspectedAt: event.occurredAt,
        lastInspectedByUserId: actorUserId,
      },
    });

    // Reuses ItemInspection (the same structured, warehouse-scoped
    // condition/exception history origin processing already writes to)
    // rather than a new table — a Manager reporting on damage/exception
    // rates by warehouse should see origin and destination discrepancies
    // in one place.
    await this.prisma.itemInspection.create({
      data: {
        tenantId,
        shipmentId: item.shipmentId,
        shipmentItemId: item.id,
        warehouseId: dto.warehouseId,
        condition: dto.condition,
        result: isGood ? ItemProcessingResult.READY : ItemProcessingResult.HOLD,
        hasException: !!dto.hasException,
        exceptionDescription: dto.exceptionDescription ?? null,
        notes: dto.notes ?? null,
        inspectedByUserId: actorUserId,
        inspectedAt: event.occurredAt,
        trackingEventId: event.id,
      },
    });

    const received = await this.prisma.shipmentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_DETAIL_INCLUDE,
    });
    const result = presentItem(received);
    return destinationWarning ? { ...result, destinationWarning } : result;
  }

  /**
   * Customer Pickup milestone. Records a customer taking physical
   * possession of an item that has already been verified at the
   * destination warehouse (RECEIVED_DESTINATION_WAREHOUSE) — this method
   * does not re-judge condition/exception, that already happened at
   * destination-receive; it only records who took the item, confirms it
   * left the building, and closes out this item's handoff.
   *
   * Eligibility and safety, in order:
   *   - item.status must be RECEIVED_DESTINATION_WAREHOUSE. Anything else
   *     (already PICKED_UP/DELIVERED, still ARRIVED_DESTINATION and never
   *     received, EXCEPTION, etc.) is a hard reject with a specific
   *     message — this is also what makes a duplicate pickup, a stale
   *     double-submit, or a pickup attempted before the item ever reached
   *     the destination warehouse all safe: whichever request the DB
   *     commits first flips the status, and every subsequent one re-reads
   *     the now-changed status and is rejected here, the same idempotent
   *     read-then-reject pattern destinationReceiveItem already uses for
   *     "already received."
   *   - item.currentWarehouseId must equal dto.warehouseId exactly — a
   *     HARD reject, unlike destinationReceiveItem's soft
   *     destinationWarning. Handing cargo to someone at a warehouse that
   *     isn't physically holding it is not something to merely flag.
   *   - tenantId scoping on every query makes cross-tenant access
   *     structurally impossible, same as every other method here.
   */
  async pickupItem(tenantId: string, actorUserId: string, itemId: string, dto: PickupItemDto) {
    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled and cannot be picked up.');
    }

    if (item.status !== DbShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE) {
      if (item.status === DbShipmentItemStatus.PICKED_UP) {
        throw new ConflictException(
          `This item was already picked up${item.lastInspectedAt ? ` on ${item.lastInspectedAt.toLocaleString()}` : ''}.`,
        );
      }
      if (item.status === DbShipmentItemStatus.DELIVERED) {
        throw new ConflictException('This item was already delivered and cannot also be picked up.');
      }
      if (item.status === DbShipmentItemStatus.EXCEPTION) {
        throw new ConflictException(
          'This item is on hold with an exception and cannot be picked up. Resolve the exception first.',
        );
      }
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible for pickup. ` +
          `It must be received at the destination warehouse first.`,
      );
    }

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    if (item.currentWarehouseId !== dto.warehouseId) {
      throw new ConflictException(
        "This item is not currently at the selected warehouse — pickup must happen from the warehouse actually holding it.",
      );
    }

    const event = await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType: TrackingEventType.PICKED_UP,
        shipmentItemId: item.id,
        itemStatus: ShipmentItemStatus.PICKED_UP,
        warehouseId: dto.warehouseId,
        notes: dto.notes ?? `Picked up by ${dto.recipientName}`,
        metadata: {
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone ?? null,
          recipientIdReference: dto.recipientIdReference ?? null,
        },
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    // The item has physically left the warehouse — currentWarehouseId is
    // a live "where is it right now" pointer (see ShipmentItem's own
    // schema comment), so it goes to null rather than staying pointed at
    // the warehouse it was picked up from, or it would keep appearing in
    // that warehouse's inventory forever. TrackingEvent.warehouseId above
    // (and the PickupDeliveryRecord below) permanently keep the fact that
    // the handoff happened at this warehouse — nothing historical is lost.
    await this.prisma.shipmentItem.update({
      where: { id: item.id },
      data: { currentWarehouseId: null },
    });

    // Immutable structured record of this handoff — see PickupDeliveryRecord's
    // schema comment for why this exists alongside the generic TrackingEvent
    // (a real home for recipient/driver detail, and later signature/photo,
    // instead of overloading TrackingEvent.metadata for something this
    // business-critical).
    await this.prisma.pickupDeliveryRecord.create({
      data: {
        tenantId,
        shipmentId: item.shipmentId,
        shipmentItemId: item.id,
        warehouseId: dto.warehouseId,
        type: HandoffType.PICKUP,
        recipientName: dto.recipientName,
        recipientPhone: dto.recipientPhone,
        recipientIdReference: dto.recipientIdReference,
        notes: dto.notes,
        handledByUserId: actorUserId,
        handledAt: event.occurredAt,
        trackingEventId: event.id,
      },
    });

    await this.maybeRollupShipmentCompletion(tenantId, actorUserId, item.shipmentId);

    const received = await this.prisma.shipmentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_DETAIL_INCLUDE,
    });
    return presentItem(received);
  }

  /**
   * Delivery/Driver Dispatch milestone. Hands an item off to a driver or
   * courier — RECEIVED_DESTINATION_WAREHOUSE -> OUT_FOR_DELIVERY. Same
   * eligibility/safety shape as pickupItem (status guard doubles as
   * duplicate/stale-submit protection, hard currentWarehouseId match,
   * tenant scoping throughout), plus one extra rule: at least one of
   * driverUserId or courierName must identify who is taking the item.
   * Deliberately flexible rather than a required single field or a
   * dedicated Driver entity — some tenants staff deliveries with a
   * logged-in employee (driverUserId, a real User), others with an
   * independent driver or third-party courier company that has no
   * application account at all (courierName/courierPhone/courierReference,
   * free text). Not a terminal handoff — does not touch the shipment
   * completion rollup.
   */
  async dispatchItem(tenantId: string, actorUserId: string, itemId: string, dto: DispatchItemDto) {
    if (!dto.driverUserId && !dto.courierName?.trim()) {
      throw new BadRequestException('Either driverUserId or courierName is required to dispatch an item.');
    }

    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled and cannot be dispatched.');
    }

    if (item.status !== DbShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE) {
      if (item.status === DbShipmentItemStatus.OUT_FOR_DELIVERY) {
        throw new ConflictException('This item is already out for delivery.');
      }
      if (item.status === DbShipmentItemStatus.DELIVERED) {
        throw new ConflictException('This item has already been delivered and cannot be dispatched again.');
      }
      if (item.status === DbShipmentItemStatus.PICKED_UP) {
        throw new ConflictException('This item was already picked up by the customer and cannot be dispatched for delivery.');
      }
      if (item.status === DbShipmentItemStatus.EXCEPTION) {
        throw new ConflictException(
          'This item is on hold with an exception and cannot be dispatched. Resolve the exception first.',
        );
      }
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible for dispatch. ` +
          `It must be received at the destination warehouse first.`,
      );
    }

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    if (item.currentWarehouseId !== dto.warehouseId) {
      throw new ConflictException(
        "This item is not currently at the selected warehouse — dispatch must happen from the warehouse actually holding it.",
      );
    }

    if (dto.driverUserId) {
      const driver = await this.prisma.user.findFirst({ where: { id: dto.driverUserId, tenantId } });
      if (!driver) {
        throw new NotFoundException('Driver not found');
      }
    }

    const event = await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType: TrackingEventType.OUT_FOR_DELIVERY,
        shipmentItemId: item.id,
        itemStatus: ShipmentItemStatus.OUT_FOR_DELIVERY,
        warehouseId: dto.warehouseId,
        notes: dto.notes ?? `Dispatched for delivery to ${dto.recipientName}`,
        metadata: {
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone ?? null,
          deliveryAddress: dto.deliveryAddress ?? null,
          driverUserId: dto.driverUserId ?? null,
          courierName: dto.courierName ?? null,
          courierPhone: dto.courierPhone ?? null,
          courierReference: dto.courierReference ?? null,
        },
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    // Left the warehouse in a driver's/courier's custody — same
    // "no longer physically at a warehouse" pointer-clearing pickupItem
    // already does above; it must not keep showing up as this
    // warehouse's inventory while it's out with a driver.
    await this.prisma.shipmentItem.update({
      where: { id: item.id },
      data: { currentWarehouseId: null },
    });

    await this.prisma.pickupDeliveryRecord.create({
      data: {
        tenantId,
        shipmentId: item.shipmentId,
        shipmentItemId: item.id,
        warehouseId: dto.warehouseId,
        type: HandoffType.DISPATCH,
        recipientName: dto.recipientName,
        recipientPhone: dto.recipientPhone,
        deliveryAddress: dto.deliveryAddress,
        driverUserId: dto.driverUserId,
        courierName: dto.courierName,
        courierPhone: dto.courierPhone,
        courierReference: dto.courierReference,
        notes: dto.notes,
        handledByUserId: actorUserId,
        handledAt: event.occurredAt,
        trackingEventId: event.id,
      },
    });

    const dispatched = await this.prisma.shipmentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_DETAIL_INCLUDE,
    });
    return presentItem(dispatched);
  }

  /**
   * Delivery/Driver Dispatch milestone. Confirms a successful delivery —
   * OUT_FOR_DELIVERY -> DELIVERED, a terminal handoff exactly like
   * pickupItem's PICKED_UP (see ITEM_TERMINAL_HANDOFF and
   * maybeRollupShipmentCompletion below — no changes needed there, this
   * status was already accounted for). currentWarehouseId stays null: a
   * delivered item was never "at" a warehouse again, it went straight
   * from a driver's custody to the recipient's.
   *
   * If the caller doesn't supply driverUserId/courierName, this looks up
   * the item's most recent DISPATCH record and carries its driver/courier
   * detail forward — staff shouldn't have to re-type who's delivering it
   * a second time, but an explicit value here always wins (e.g. a
   * different person actually completed the handoff than was originally
   * dispatched).
   */
  async deliverItem(tenantId: string, actorUserId: string, itemId: string, dto: DeliverItemDto) {
    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled and cannot be delivered.');
    }

    if (item.status !== DbShipmentItemStatus.OUT_FOR_DELIVERY) {
      if (item.status === DbShipmentItemStatus.DELIVERED) {
        throw new ConflictException('This item has already been delivered.');
      }
      if (item.status === DbShipmentItemStatus.PICKED_UP) {
        throw new ConflictException('This item was picked up by the customer and cannot also be delivered.');
      }
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible for delivery confirmation. ` +
          `It must be dispatched (out for delivery) first.`,
      );
    }

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    if (dto.driverUserId) {
      const driver = await this.prisma.user.findFirst({ where: { id: dto.driverUserId, tenantId } });
      if (!driver) {
        throw new NotFoundException('Driver not found');
      }
    }

    let driverUserId = dto.driverUserId;
    let courierName = dto.courierName;
    let courierPhone = dto.courierPhone;
    let courierReference = dto.courierReference;
    if (!driverUserId && !courierName) {
      const lastDispatch = await this.prisma.pickupDeliveryRecord.findFirst({
        where: { tenantId, shipmentItemId: item.id, type: HandoffType.DISPATCH },
        orderBy: { handledAt: 'desc' },
      });
      driverUserId = lastDispatch?.driverUserId ?? undefined;
      courierName = lastDispatch?.courierName ?? undefined;
      courierPhone = lastDispatch?.courierPhone ?? undefined;
      courierReference = lastDispatch?.courierReference ?? undefined;
    }

    const event = await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType: TrackingEventType.DELIVERED,
        shipmentItemId: item.id,
        itemStatus: ShipmentItemStatus.DELIVERED,
        warehouseId: dto.warehouseId,
        notes: dto.notes ?? `Delivered to ${dto.recipientName}`,
        metadata: {
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone ?? null,
          recipientIdReference: dto.recipientIdReference ?? null,
          driverUserId: driverUserId ?? null,
          courierName: courierName ?? null,
        },
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    await this.prisma.pickupDeliveryRecord.create({
      data: {
        tenantId,
        shipmentId: item.shipmentId,
        shipmentItemId: item.id,
        warehouseId: dto.warehouseId,
        type: HandoffType.DELIVERY,
        recipientName: dto.recipientName,
        recipientPhone: dto.recipientPhone,
        recipientIdReference: dto.recipientIdReference,
        driverUserId,
        courierName,
        courierPhone,
        courierReference,
        notes: dto.notes,
        handledByUserId: actorUserId,
        handledAt: event.occurredAt,
        trackingEventId: event.id,
      },
    });

    await this.maybeRollupShipmentCompletion(tenantId, actorUserId, item.shipmentId);

    const delivered = await this.prisma.shipmentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_DETAIL_INCLUDE,
    });
    return presentItem(delivered);
  }

  /**
   * Delivery/Driver Dispatch milestone. Records a failed/incomplete
   * delivery attempt once the physical package is back at a destination
   * warehouse. Never DELIVERED — a failed attempt is never silently
   * marked successful. Two outcomes, same `hasException` split
   * destinationReceiveItem already uses:
   *   - hasException false (default): retry-eligible.
   *     OUT_FOR_DELIVERY -> RECEIVED_DESTINATION_WAREHOUSE, immediately
   *     eligible for a fresh dispatch or a walk-in pickup — exactly the
   *     same status the item had before it was ever dispatched.
   *   - hasException true: needs staff review (refused permanently,
   *     damaged, lost). OUT_FOR_DELIVERY -> EXCEPTION, same dead-end-
   *     until-manually-resolved posture EXCEPTION already has everywhere
   *     else in this app.
   * Both outcomes assume the item is physically at dto.warehouseId (this
   * action only makes sense once staff has it in hand) and restore
   * currentWarehouseId accordingly — including the EXCEPTION outcome,
   * since a damaged-but-present package should still show up in this
   * warehouse's inventory for staff to act on, not vanish.
   *
   * Unlike pickupItem/dispatchItem, there is no "must match
   * currentWarehouseId" check here — currentWarehouseId is null while
   * OUT_FOR_DELIVERY (see dispatchItem), so there's nothing to compare
   * dto.warehouseId against yet. Same posture destinationReceiveItem
   * already has for a first-time arrival: staff attests physical
   * presence at a specific warehouse, and that attestation is what sets
   * currentWarehouseId, not a check against it.
   *
   * Uses TrackingEventType.RETURNED_TO_WAREHOUSE (not
   * RECEIVED_DESTINATION_WAREHOUSE) for the retry-eligible outcome even
   * though the resulting item status is the same value — the event type
   * is what keeps history (and later customer-facing tracking) honest:
   * this item was dispatched, didn't arrive, and came back, not that it
   * was simply received once.
   */
  async returnItem(tenantId: string, actorUserId: string, itemId: string, dto: ReturnItemDto) {
    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled.');
    }

    if (item.status !== DbShipmentItemStatus.OUT_FOR_DELIVERY) {
      if (item.status === DbShipmentItemStatus.DELIVERED) {
        throw new ConflictException('This item has already been delivered and cannot be returned.');
      }
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible to be returned. ` +
          `It must be out for delivery first.`,
      );
    }

    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    const isRetryEligible = !dto.hasException;
    const newItemStatus = isRetryEligible ? ShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE : ShipmentItemStatus.EXCEPTION;
    const eventType = isRetryEligible ? TrackingEventType.RETURNED_TO_WAREHOUSE : TrackingEventType.EXCEPTION;
    const defaultNotes = isRetryEligible
      ? `Returned to ${warehouse.name} after a failed delivery attempt: ${dto.failureReason}`
      : `Held at ${warehouse.name} after a failed delivery attempt: ${dto.failureReason}`;

    const event = await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType,
        shipmentItemId: item.id,
        itemStatus: newItemStatus,
        warehouseId: dto.warehouseId,
        notes: dto.notes ?? defaultNotes,
        metadata: {
          failureReason: dto.failureReason,
          hasException: !!dto.hasException,
        },
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    // Physically back at this warehouse in both outcomes — see this
    // method's own doc comment for why EXCEPTION is not excluded here.
    await this.prisma.shipmentItem.update({
      where: { id: item.id },
      data: { currentWarehouseId: dto.warehouseId },
    });

    const returned = await this.prisma.shipmentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_DETAIL_INCLUDE,
    });
    return presentItem(returned);
  }

  /**
   * Advances a shipment to COMPLETED once every one of its applicable
   * items has reached a terminal handoff status (see ITEM_TERMINAL_HANDOFF
   * above) — mirrors ManifestsService.maybeRollupShipmentArrival exactly:
   * same eligible-source-status allow-list guard, same "every item at
   * least this far along" check, same forward-only/never-downgraded
   * posture, same SYSTEM-sourced shipment-level tracking event with no
   * shipmentItemId. CANCELLED items are excluded from the "every item"
   * check — a cancelled item was never going to be handed off and must
   * not block a shipment's otherwise-complete siblings; an EXCEPTION item,
   * deliberately, is not excluded, so an unresolved discrepancy keeps
   * blocking completion instead of being silently outvoted, matching
   * ContainersService.closeUnloading's posture on discrepancies.
   *
   * Delivery/Driver Dispatch milestone: now that DELIVERED items can
   * trigger this (deliverItem calls this exact same method — no changes
   * needed here beyond this comment), the shipment can complete via
   * PICKED_UP alone, DELIVERED alone, or a mix. Uses its own dedicated
   * TrackingEventType.COMPLETED rather than continuing to reuse PICKED_UP
   * (as an earlier draft of this method did) — the previous choice
   * predated this milestone and would have mislabeled a delivered-only
   * or mixed completion as "picked up," which matters once these events
   * feed customer-facing tracking/notifications.
   */
  private async maybeRollupShipmentCompletion(tenantId: string, actorUserId: string, shipmentId: string) {
    const ROLLUP_ELIGIBLE_STATUSES: DbShipmentStatus[] = [DbShipmentStatus.ARRIVED_DESTINATION];

    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
      include: { items: { select: { status: true } } },
    });
    if (!shipment || shipment.items.length === 0) {
      return;
    }
    if (!ROLLUP_ELIGIBLE_STATUSES.includes(shipment.status)) {
      return;
    }

    const applicableItems = shipment.items.filter((shipmentItem) => shipmentItem.status !== DbShipmentItemStatus.CANCELLED);
    if (applicableItems.length === 0) {
      return;
    }
    const allHandedOff = applicableItems.every((shipmentItem) => ITEM_TERMINAL_HANDOFF.includes(shipmentItem.status));
    if (!allHandedOff) {
      return;
    }

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      shipmentId,
      {
        eventType: TrackingEventType.COMPLETED,
        status: ShipmentStatus.COMPLETED,
        notes: 'All applicable items reached a final handoff status',
      },
      { source: TrackingEventSource.SYSTEM },
    );
  }

  /** Items currently associated with a warehouse — a live view, not a separate stored record. */
  async getInventory(
    tenantId: string,
    params: { warehouseId?: string; search?: string; status?: DbShipmentItemStatus },
  ) {
    const query = params.search?.trim();
    const items = await this.prisma.shipmentItem.findMany({
      where: {
        tenantId,
        currentWarehouseId: params.warehouseId ? params.warehouseId : { not: null },
        ...(params.status ? { status: params.status } : {}),
        ...(query
          ? {
              OR: [
                { itemCode: { contains: query, mode: 'insensitive' } },
                { shipment: { trackingNumber: { contains: query, mode: 'insensitive' } } },
                { shipment: { customer: { firstName: { contains: query, mode: 'insensitive' } } } },
                { shipment: { customer: { lastName: { contains: query, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: ITEM_DETAIL_INCLUDE,
      orderBy: { receivedAt: 'desc' },
    });
    return items.map(presentItem);
  }

  /** Recent physically-located (warehouse-scoped) tracking events — receiving today, other modes later. */
  async getRecentActivity(tenantId: string, params: { warehouseId?: string; limit?: number }) {
    const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
    return this.prisma.trackingEvent.findMany({
      where: {
        tenantId,
        warehouseId: params.warehouseId ? params.warehouseId : { not: null },
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      include: {
        createdByUser: { select: ACTIVITY_ACTOR_SELECT },
        warehouse: { select: { id: true, name: true, code: true } },
        shipmentItem: { select: { id: true, itemCode: true, itemType: true } },
        shipment: { select: { id: true, trackingNumber: true } },
      },
    });
  }

  /**
   * When every item on a shipment has now been received, advance the
   * shipment's own status — but only forward, and only from a
   * pre-receiving phase, so this can never regress a shipment that has
   * already moved further through its lifecycle.
   */
  private async maybeRollupShipmentStatus(tenantId: string, actorUserId: string, shipmentId: string) {
    const ROLLUP_ELIGIBLE_STATUSES: DbShipmentStatus[] = [
      DbShipmentStatus.DRAFT,
      DbShipmentStatus.QUOTE_REQUESTED,
      DbShipmentStatus.AWAITING_ITEMS,
    ];

    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
      include: { items: { select: { receivedAt: true } } },
    });
    if (!shipment || shipment.items.length === 0) {
      return;
    }
    if (!ROLLUP_ELIGIBLE_STATUSES.includes(shipment.status)) {
      return;
    }
    const allReceived = shipment.items.every((shipmentItem) => shipmentItem.receivedAt !== null);
    if (!allReceived) {
      return;
    }

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      shipmentId,
      {
        eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE,
        status: ShipmentStatus.WAREHOUSE_RECEIVED,
        notes: 'All items received at origin warehouse',
      },
      { source: TrackingEventSource.SYSTEM },
    );
  }

  /**
   * Mirrors maybeRollupShipmentStatus for the processing stage, and is
   * bidirectional between PROCESSING and READY_FOR_CONSOLIDATION:
   *   - WAREHOUSE_RECEIVED -> PROCESSING the first time any item is
   *     processed (forward-only; nothing ever un-starts processing).
   *   - PROCESSING -> READY_FOR_CONSOLIDATION once every item on the
   *     shipment is PROCESSED.
   *   - READY_FOR_CONSOLIDATION -> PROCESSING if a later call (typically a
   *     deliberate reinspection) leaves any item no longer PROCESSED —
   *     e.g. reinspected into EXCEPTION/HOLD. This is what stops a held
   *     item from letting its shipment falsely keep reporting itself
   *     ready for container loading.
   *   - Recovery back to READY_FOR_CONSOLIDATION isn't special-cased: once
   *     downgraded to PROCESSING, the next call that clears the exception
   *     re-enters the same forward branch above.
   *
   * The eligible-status allow-list is the safety rail: only these three
   * statuses are ever touched. A shipment that has legitimately progressed
   * further (CONSOLIDATED, BOOKED, LOADED, ... COMPLETED/CANCELLED) is
   * never read as reachable here, so it can never be downgraded — matching
   * the invariant "never regress a shipment past consolidation/loading".
   */
  private async maybeRollupToReadyForConsolidation(tenantId: string, actorUserId: string, shipmentId: string) {
    const ROLLUP_ELIGIBLE_STATUSES: DbShipmentStatus[] = [
      DbShipmentStatus.WAREHOUSE_RECEIVED,
      DbShipmentStatus.PROCESSING,
      DbShipmentStatus.READY_FOR_CONSOLIDATION,
    ];

    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
      include: { items: { select: { status: true } } },
    });
    if (!shipment || shipment.items.length === 0) {
      return;
    }
    if (!ROLLUP_ELIGIBLE_STATUSES.includes(shipment.status)) {
      return;
    }

    let currentStatus = shipment.status;

    const anyProcessingActivity = shipment.items.some(
      (shipmentItem) =>
        ITEM_PROCESSED_OR_LATER.includes(shipmentItem.status) ||
        shipmentItem.status === DbShipmentItemStatus.EXCEPTION,
    );
    if (currentStatus === DbShipmentStatus.WAREHOUSE_RECEIVED && anyProcessingActivity) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.PROCESSED,
          status: ShipmentStatus.PROCESSING,
          notes: 'Item processing started',
        },
        { source: TrackingEventSource.SYSTEM },
      );
      currentStatus = DbShipmentStatus.PROCESSING;
    }

    const allProcessed = shipment.items.every((shipmentItem) => ITEM_PROCESSED_OR_LATER.includes(shipmentItem.status));
    if (currentStatus === DbShipmentStatus.PROCESSING && allProcessed) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.PROCESSED,
          status: ShipmentStatus.READY_FOR_CONSOLIDATION,
          notes: 'All items processed and ready for consolidation',
        },
        { source: TrackingEventSource.SYSTEM },
      );
    } else if (currentStatus === DbShipmentStatus.READY_FOR_CONSOLIDATION && !allProcessed) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.EXCEPTION,
          status: ShipmentStatus.PROCESSING,
          notes: 'Reverted to processing — an item requires attention before consolidation',
        },
        { source: TrackingEventSource.SYSTEM },
      );
    }
  }
}
