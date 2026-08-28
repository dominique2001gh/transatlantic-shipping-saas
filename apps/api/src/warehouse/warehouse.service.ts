import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
// Prisma's generated enums (aliased) — used only when comparing values
// that came directly out of a Prisma query result.
import {
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
import { ProcessItemDto } from './dto/process-item.dto';
import { ReceiveItemDto } from './dto/receive-item.dto';

const ACTOR_SELECT = { id: true, firstName: true, lastName: true } as const;
const WAREHOUSE_SELECT = { id: true, name: true, code: true } as const;

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
   * Mirrors maybeRollupShipmentStatus for the processing stage: advances
   * WAREHOUSE_RECEIVED -> PROCESSING the first time any item is processed,
   * then PROCESSING -> READY_FOR_CONSOLIDATION once every item on the
   * shipment is PROCESSED. An item left in EXCEPTION blocks the final
   * rollup indefinitely — by design (see CRITICAL STATUS RULE in
   * processItem): a shipment can never reach READY_FOR_CONSOLIDATION while
   * any item is on hold. Forward-only and only from an eligible source
   * status, same guard shape as the receiving rollup.
   */
  private async maybeRollupToReadyForConsolidation(tenantId: string, actorUserId: string, shipmentId: string) {
    const ROLLUP_ELIGIBLE_STATUSES: DbShipmentStatus[] = [
      DbShipmentStatus.WAREHOUSE_RECEIVED,
      DbShipmentStatus.PROCESSING,
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
        shipmentItem.status === DbShipmentItemStatus.PROCESSED ||
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

    const allProcessed = shipment.items.every(
      (shipmentItem) => shipmentItem.status === DbShipmentItemStatus.PROCESSED,
    );
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
    }
  }
}
