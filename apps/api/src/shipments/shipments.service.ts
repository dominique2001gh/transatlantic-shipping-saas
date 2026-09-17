import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatItemCode, ShipmentItemType } from '@transatlantic/shared';
import type { Prisma } from '@prisma/client';
import { ShipmentItemStatus, ShipmentStatus, TrackingEventSource, TrackingEventType } from '@prisma/client';
import { generateTrackingNumber } from '../common/numbering/numbering.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { CreateTrackingEventDto } from './dto/create-tracking-event.dto';
import { QuickReceiveDto } from './dto/quick-receive.dto';
import { ShipmentItemInputDto } from './dto/shipment-item-input.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { UpdateShipmentItemDto } from './dto/update-shipment-item.dto';

const TRACKING_EVENT_ACTOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

/**
 * Event types the system generates automatically at the moment a shipment
 * or item is created — never accepted from the manual tracking-event
 * creation endpoint, so a shipment's history can't end up with two
 * "created" events or a fabricated one out of order.
 */
const SYSTEM_ONLY_EVENT_TYPES = new Set<TrackingEventType>([
  TrackingEventType.SHIPMENT_CREATED,
  TrackingEventType.ITEM_REGISTERED,
]);

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(tenantId: string, filters: { customerId?: string; status?: ShipmentStatus }) {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        tenantId,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        customer: true,
        items: { select: { id: true, receivedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return shipments.map((shipment) => this.withItemCounts(shipment));
  }

  /**
   * Staff Tracking page lookup: partial match across the three identifiers
   * staff actually have in hand — shipment tracking number, item/package
   * code, or customer name/number. Same OR-clause shape as
   * WarehouseService.searchItems (proven pattern, not duplicated logic —
   * that one searches ShipmentItem for the scan workflow; this one
   * searches Shipment directly since the Tracking page's unit of result
   * is a shipment, not an item). Reuses withItemCounts so the response
   * shape is identical to findAll/findById — no new projection.
   */
  async search(tenantId: string, rawQuery: string) {
    const query = rawQuery.trim();
    if (!query) {
      return [];
    }
    const shipments = await this.prisma.shipment.findMany({
      where: {
        tenantId,
        OR: [
          { trackingNumber: { contains: query, mode: 'insensitive' } },
          { items: { some: { itemCode: { contains: query, mode: 'insensitive' } } } },
          { customer: { customerNumber: { contains: query, mode: 'insensitive' } } },
          { customer: { firstName: { contains: query, mode: 'insensitive' } } },
          { customer: { lastName: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: {
        customer: true,
        items: { select: { id: true, receivedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return shipments.map((shipment) => this.withItemCounts(shipment));
  }

  async findById(tenantId: string, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        items: { orderBy: { sequenceNumber: 'asc' } },
      },
    });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }
    return this.withItemCounts(shipment);
  }

  /**
   * Creates a shipment (and, optionally, its initial items) in one
   * transaction, auto-generating the tracking number and itemCodes, and
   * writing the SHIPMENT_CREATED / ITEM_REGISTERED audit events that make
   * up its history from the very first moment it exists.
   */
  async create(tenantId: string, actorUserId: string, dto: CreateShipmentDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Sequence generation is its own atomic step, deliberately outside the
    // transaction below — a crash between the two would only ever leave a
    // harmless gap in the sequence, never a duplicate tracking number.
    const trackingNumber = await generateTrackingNumber(this.prisma, tenantId);

    const shipmentId = await this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.create({
        data: {
          tenantId,
          customerId: dto.customerId,
          trackingNumber,
          shipmentMode: dto.shipmentMode,
          originCountry: dto.originCountry,
          destinationCountry: dto.destinationCountry,
          originLocation: dto.originLocation,
          destinationLocation: dto.destinationLocation,
          originWarehouseId: dto.originWarehouseId,
          destinationWarehouseId: dto.destinationWarehouseId,
          routeId: dto.routeId,
          description: dto.description,
          declaredValue: dto.declaredValue,
          currency: dto.currency,
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone,
          recipientEmail: dto.recipientEmail,
          recipientAddressLine1: dto.recipientAddressLine1,
          recipientAddressLine2: dto.recipientAddressLine2,
          recipientCity: dto.recipientCity,
          recipientState: dto.recipientState,
          recipientCountry: dto.recipientCountry,
          recipientPostalCode: dto.recipientPostalCode,
          status: ShipmentStatus.DRAFT,
        },
      });

      await tx.trackingEvent.create({
        data: {
          tenantId,
          shipmentId: shipment.id,
          eventType: TrackingEventType.SHIPMENT_CREATED,
          source: TrackingEventSource.MANUAL,
          status: ShipmentStatus.DRAFT,
          createdByUserId: actorUserId,
        },
      });

      for (const [index, itemDto] of (dto.items ?? []).entries()) {
        await this.createItemWithinTransaction(tx, {
          tenantId,
          actorUserId,
          shipmentId: shipment.id,
          trackingNumber,
          sequenceNumber: index + 1,
          input: itemDto,
        });
      }

      return shipment.id;
    });

    return this.findById(tenantId, shipmentId);
  }

  /**
   * Quick Receive: creates a shipment and `packageCount` identical-defaults
   * items in one transaction, with every item already in the normal
   * origin-warehouse RECEIVED state — no separate trip through Warehouse
   * -> Receive is required for these pieces. `create()` above and
   * WarehouseService.receiveItem are both untouched by this method;
   * existing New Shipment / Warehouse -> Receive keep working exactly as
   * before for anyone who doesn't use this endpoint.
   *
   * Phase 2: origin geography (originCountry/originLocation) is derived
   * from the selected warehouse, never client-supplied — see
   * QuickReceiveDto's own doc comment. Also persists the required
   * recipient/consignee fields onto the Shipment row (Requirement #5-#7 of
   * the Phase 2 design) — the same fields CreateShipmentDto's `create()`
   * populates, so both intake paths produce an identically-shaped Shipment
   * record.
   *
   * Deliberately does NOT call createTrackingEvent() (used by
   * receiveItem) for the per-item receiving writes: that method opens its
   * own `$transaction`, and a Prisma interactive transaction started from
   * inside another one would not actually be atomic with it. Instead this
   * inlines the same handful of fields createTrackingEvent's transaction
   * body would set (ShipmentItem.status/receivedAt/receivedByUserId/
   * currentWarehouseId, plus the matching TrackingEvent row) directly
   * here, and mirrors WarehouseService.maybeRollupShipmentStatus's own
   * shipment-level rollup at the end of the same transaction — since by
   * construction every item this method creates is already received, the
   * rollup is unconditional rather than re-queried the way that method
   * (called after a single ad-hoc item receive) needs to.
   *
   * Every generated item shares one set of optional physical defaults
   * (itemType/weight/dimensions/declaredValue) from the DTO — a single
   * odd-one-out package is still editable afterward via the existing
   * PATCH /shipments/:id/items/:itemId, unchanged by this feature.
   */
  async createQuickReceive(tenantId: string, actorUserId: string, dto: QuickReceiveDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.originWarehouseId, tenantId },
    });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    // Origin geography is never client-supplied free text here (see
    // QuickReceiveDto's own doc comment) — the selected warehouse's own
    // address is the single source of truth for "where these packages
    // physically are right now," for any tenant, in any country.
    const originCountry = warehouse.country;
    const originLocation = warehouse.state ? `${warehouse.city}, ${warehouse.state}` : warehouse.city;

    let destinationWarehouseId: string | undefined;
    if (dto.destinationWarehouseId) {
      const destinationWarehouse = await this.prisma.warehouse.findFirst({
        where: { id: dto.destinationWarehouseId, tenantId },
      });
      if (!destinationWarehouse) {
        throw new NotFoundException('Destination warehouse not found');
      }
      destinationWarehouseId = destinationWarehouse.id;
    }

    // Sequence generation is its own atomic step, deliberately outside the
    // transaction below — same reasoning as create() above.
    const trackingNumber = await generateTrackingNumber(this.prisma, tenantId);
    // One shared timestamp for the whole batch: every item in this intake
    // physically arrived and was logged together, so "received at" should
    // read as one moment, not `packageCount` microscopically different ones.
    const receivedAt = new Date();

    const shipmentId = await this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.create({
        data: {
          tenantId,
          customerId: dto.customerId,
          trackingNumber,
          shipmentMode: dto.shipmentMode,
          originCountry,
          destinationCountry: dto.destinationCountry,
          originLocation,
          destinationLocation: dto.destinationLocation,
          originWarehouseId: dto.originWarehouseId,
          destinationWarehouseId,
          description: dto.description,
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone,
          recipientEmail: dto.recipientEmail,
          recipientAddressLine1: dto.recipientAddressLine1,
          recipientAddressLine2: dto.recipientAddressLine2,
          recipientCity: dto.recipientCity,
          recipientState: dto.recipientState,
          recipientCountry: dto.recipientCountry,
          recipientPostalCode: dto.recipientPostalCode,
          status: ShipmentStatus.DRAFT,
        },
      });

      await tx.trackingEvent.create({
        data: {
          tenantId,
          shipmentId: shipment.id,
          eventType: TrackingEventType.SHIPMENT_CREATED,
          source: TrackingEventSource.MANUAL,
          status: ShipmentStatus.DRAFT,
          occurredAt: receivedAt,
          createdByUserId: actorUserId,
        },
      });

      for (let sequenceNumber = 1; sequenceNumber <= dto.packageCount; sequenceNumber++) {
        const item = await tx.shipmentItem.create({
          data: {
            tenantId,
            shipmentId: shipment.id,
            itemCode: formatItemCode(trackingNumber, sequenceNumber),
            sequenceNumber,
            itemType: dto.itemType ?? ShipmentItemType.BOX,
            description: dto.itemDescription,
            quantity: 1,
            length: dto.length,
            width: dto.width,
            height: dto.height,
            dimensionUnit: dto.dimensionUnit,
            weight: dto.weight,
            weightUnit: dto.weightUnit,
            declaredValue: dto.declaredValue,
            // The entire point of Quick Receive: every generated item
            // starts already received, never REGISTERED — see the method
            // doc above for why this is written directly here rather than
            // via a second call to the general receiving code path.
            status: ShipmentItemStatus.RECEIVED_ORIGIN_WAREHOUSE,
            receivedAt,
            receivedByUserId: actorUserId,
            currentWarehouseId: dto.originWarehouseId,
          },
        });

        await tx.trackingEvent.create({
          data: {
            tenantId,
            shipmentId: shipment.id,
            shipmentItemId: item.id,
            eventType: TrackingEventType.ITEM_REGISTERED,
            source: TrackingEventSource.MANUAL,
            occurredAt: receivedAt,
            createdByUserId: actorUserId,
          },
        });

        await tx.trackingEvent.create({
          data: {
            tenantId,
            shipmentId: shipment.id,
            shipmentItemId: item.id,
            eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE,
            source: TrackingEventSource.MANUAL,
            warehouseId: dto.originWarehouseId,
            notes: dto.notes,
            occurredAt: receivedAt,
            createdByUserId: actorUserId,
          },
        });
      }

      // Shipment-level rollup — unconditional here (unlike
      // WarehouseService.maybeRollupShipmentStatus, which re-checks "are
      // all items received?" because it runs after a single ad-hoc item
      // receive): by construction every item created above is already
      // received, so the shipment goes straight to WAREHOUSE_RECEIVED in
      // this same transaction.
      await tx.trackingEvent.create({
        data: {
          tenantId,
          shipmentId: shipment.id,
          eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE,
          source: TrackingEventSource.SYSTEM,
          status: ShipmentStatus.WAREHOUSE_RECEIVED,
          notes: 'All items received at origin warehouse (Quick Receive)',
          occurredAt: receivedAt,
          createdByUserId: actorUserId,
        },
      });
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: ShipmentStatus.WAREHOUSE_RECEIVED },
      });

      return shipment.id;
    });

    // Stage 3H convention (see createTrackingEvent below): fired after the
    // transaction commits, never inside it — a notification-pipeline
    // failure must never roll back a shipment that has otherwise already
    // been successfully created and received.
    await this.notificationsService.fireShipmentStatusChanged(tenantId, shipmentId, ShipmentStatus.WAREHOUSE_RECEIVED);

    return this.findById(tenantId, shipmentId);
  }

  async update(tenantId: string, id: string, dto: UpdateShipmentDto) {
    const shipment = await this.prisma.shipment.findFirst({ where: { id, tenantId } });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }
    await this.prisma.shipment.update({ where: { id }, data: dto });
    return this.findById(tenantId, id);
  }

  /** Adds one item to an existing shipment, auto-assigning its sequence number and itemCode. */
  async addItem(tenantId: string, actorUserId: string, shipmentId: string, dto: ShipmentItemInputDto) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
    });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    await this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.shipmentItem.count({ where: { shipmentId } });
      await this.createItemWithinTransaction(tx, {
        tenantId,
        actorUserId,
        shipmentId,
        trackingNumber: shipment.trackingNumber,
        sequenceNumber: existingCount + 1,
        input: dto,
      });
    });

    return this.findById(tenantId, shipmentId);
  }

  async updateItem(tenantId: string, shipmentId: string, itemId: string, dto: UpdateShipmentItemDto) {
    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, shipmentId, tenantId },
    });
    if (!item) {
      throw new NotFoundException('Shipment item not found');
    }
    await this.prisma.shipmentItem.update({ where: { id: itemId }, data: dto });
    return this.findById(tenantId, shipmentId);
  }

  async listTrackingEvents(tenantId: string, shipmentId: string) {
    const shipment = await this.prisma.shipment.findFirst({ where: { id: shipmentId, tenantId } });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }
    return this.prisma.trackingEvent.findMany({
      where: { shipmentId, tenantId },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      include: { createdByUser: { select: TRACKING_EVENT_ACTOR_SELECT } },
    });
  }

  /**
   * The single mutation point for shipment/item status changes. Always
   * inserts a new TrackingEvent row — never updates or deletes a previous
   * one — and only ever touches the denormalized status columns as a
   * side effect of that insert, in the same transaction.
   *
   * `options` is deliberately not part of the public DTO — it exists so
   * trusted internal callers (e.g. WarehouseService, after resolving a
   * physical scan) can record provenance (source=BARCODE_SCAN,
   * scanIdentifier=<raw code>) that a client must never be able to set
   * directly on the general-purpose HTTP endpoint. The public
   * `/shipments/:id/tracking-events` route never passes `options`, so its
   * behavior (always source=MANUAL) is unchanged from Milestone 3A.
   */
  async createTrackingEvent(
    tenantId: string,
    actorUserId: string,
    shipmentId: string,
    dto: CreateTrackingEventDto,
    options?: { source?: TrackingEventSource; scanIdentifier?: string },
  ) {
    if (SYSTEM_ONLY_EVENT_TYPES.has(dto.eventType)) {
      throw new BadRequestException(
        `${dto.eventType} is generated automatically and cannot be created manually`,
      );
    }
    if (dto.itemStatus && !dto.shipmentItemId) {
      throw new BadRequestException('itemStatus requires shipmentItemId');
    }

    const shipment = await this.prisma.shipment.findFirst({ where: { id: shipmentId, tenantId } });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    let item: { id: string; receivedAt: Date | null } | null = null;
    if (dto.shipmentItemId) {
      item = await this.prisma.shipmentItem.findFirst({
        where: { id: dto.shipmentItemId, shipmentId, tenantId },
        select: { id: true, receivedAt: true },
      });
      if (!item) {
        throw new NotFoundException('Shipment item not found');
      }
    }

    if (dto.warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { id: dto.warehouseId, tenantId },
      });
      if (!warehouse) {
        throw new NotFoundException('Warehouse not found');
      }
    }

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trackingEvent.create({
        data: {
          tenantId,
          shipmentId,
          shipmentItemId: dto.shipmentItemId ?? null,
          eventType: dto.eventType,
          source: options?.source ?? TrackingEventSource.MANUAL,
          status: dto.status ?? null,
          warehouseId: dto.warehouseId ?? null,
          location: dto.location ?? null,
          notes: dto.notes ?? null,
          scanIdentifier: options?.scanIdentifier ?? null,
          metadata: (dto.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
          createdByUserId: actorUserId,
        },
        include: { createdByUser: { select: TRACKING_EVENT_ACTOR_SELECT } },
      });

      if (dto.status) {
        await tx.shipment.update({ where: { id: shipmentId }, data: { status: dto.status } });
      }

      if (item) {
        const isReceivingEvent =
          dto.eventType === TrackingEventType.RECEIVED_AT_WAREHOUSE ||
          dto.eventType === TrackingEventType.RECEIVED_DESTINATION_WAREHOUSE;

        const itemUpdateData: Prisma.ShipmentItemUpdateInput = {};
        if (dto.itemStatus) {
          itemUpdateData.status = dto.itemStatus;
        }
        // Stamp the "who received it, and when" convenience fields only
        // the *first* time a receiving event fires for this item — this
        // is always the origin receive, and must never be overwritten by
        // a later destination receive (Milestone 3F), which is a
        // separate physical event with its own actor/timestamp already
        // captured on the TrackingEvent row itself.
        if (isReceivingEvent && !item.receivedAt) {
          itemUpdateData.receivedAt = created.occurredAt;
          itemUpdateData.receivedByUser = { connect: { id: actorUserId } };
        }
        // "Where is it right now" is a live pointer, not history — unlike
        // receivedAt/receivedByUser above, this must update on *every*
        // receiving event that carries a warehouseId, including a
        // destination receive after the item already has an origin
        // receivedAt. Without this, Milestone 3F's destination receive
        // would flip ShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE
        // but silently leave currentWarehouseId pointing at the origin
        // warehouse.
        if (isReceivingEvent && dto.warehouseId) {
          itemUpdateData.currentWarehouse = { connect: { id: dto.warehouseId } };
        }

        if (Object.keys(itemUpdateData).length > 0) {
          await tx.shipmentItem.update({ where: { id: item.id }, data: itemUpdateData });
        }
      }

      return created;
    });

    // Stage 3H: fired after the transaction commits, outside it — a
    // notification-pipeline failure must never roll back a tracking event
    // that has otherwise already succeeded. Awaited (not fire-and-forget)
    // so callers/tests observe a consistent state once this method
    // resolves; safe to await because NotificationsService's fire*
    // methods never throw (every one catches its own errors internally).
    if (dto.status) {
      await this.notificationsService.fireShipmentStatusChanged(tenantId, shipmentId, dto.status);
    }

    return event;
  }

  /**
   * Shared item-creation logic used both by `create` (nested items at
   * shipment-creation time) and `addItem` (items added later) — always
   * runs inside the caller's transaction so the item and its
   * ITEM_REGISTERED event are written atomically together.
   */
  private async createItemWithinTransaction(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      actorUserId: string;
      shipmentId: string;
      trackingNumber: string;
      sequenceNumber: number;
      input: ShipmentItemInputDto;
    },
  ) {
    const { tenantId, actorUserId, shipmentId, trackingNumber, sequenceNumber, input } = params;
    const item = await tx.shipmentItem.create({
      data: {
        tenantId,
        shipmentId,
        itemCode: formatItemCode(trackingNumber, sequenceNumber),
        sequenceNumber,
        itemType: input.itemType,
        description: input.description,
        quantity: input.quantity ?? 1,
        length: input.length,
        width: input.width,
        height: input.height,
        dimensionUnit: input.dimensionUnit,
        weight: input.weight,
        weightUnit: input.weightUnit,
        declaredValue: input.declaredValue,
      },
    });

    await tx.trackingEvent.create({
      data: {
        tenantId,
        shipmentId,
        shipmentItemId: item.id,
        eventType: TrackingEventType.ITEM_REGISTERED,
        source: TrackingEventSource.MANUAL,
        createdByUserId: actorUserId,
      },
    });

    return item;
  }

  private withItemCounts<T extends { items: { receivedAt?: Date | null }[] }>(shipment: T) {
    const total = shipment.items.length;
    const received = shipment.items.filter((item) => item.receivedAt).length;
    return { ...shipment, itemCounts: { total, received } };
  }
}
