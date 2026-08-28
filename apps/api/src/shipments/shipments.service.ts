import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatItemCode } from '@transatlantic/shared';
import type { Prisma } from '@prisma/client';
import { ShipmentStatus, TrackingEventSource, TrackingEventType } from '@prisma/client';
import { generateTrackingNumber } from '../common/numbering/numbering.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { CreateTrackingEventDto } from './dto/create-tracking-event.dto';
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
  constructor(private readonly prisma: PrismaService) {}

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
        // Stamp the "where is it / who received it" convenience fields the
        // first time a receiving event fires for this item, so item-count
        // reads (itemCounts.received) don't require joining tracking_events.
        if (isReceivingEvent && !item.receivedAt) {
          itemUpdateData.receivedAt = created.occurredAt;
          itemUpdateData.receivedByUser = { connect: { id: actorUserId } };
          if (dto.warehouseId) {
            itemUpdateData.currentWarehouse = { connect: { id: dto.warehouseId } };
          }
        }

        if (Object.keys(itemUpdateData).length > 0) {
          await tx.shipmentItem.update({ where: { id: item.id }, data: itemUpdateData });
        }
      }

      return created;
    });

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
