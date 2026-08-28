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
import { ShipmentItemStatus, ShipmentStatus, TrackingEventType } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { ReceiveItemDto } from './dto/receive-item.dto';

/**
 * Shared shape for every endpoint that resolves to a full ShipmentItem
 * (scan, search, receive result, inventory row) — one definition so the
 * confirm panel, inventory table, and receive response always agree on
 * what a "resolved item" looks like.
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
  currentWarehouse: { select: { id: true, name: true, code: true } },
  receivedByUser: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ShipmentItemInclude;

const ACTIVITY_ACTOR_SELECT = { id: true, firstName: true, lastName: true } as const;

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
    return item;
  }

  /** Manual fallback: item code, shipment tracking number, or customer name/number, partial match. */
  async searchItems(tenantId: string, rawQuery: string) {
    const query = rawQuery.trim();
    if (!query) {
      return [];
    }
    return this.prisma.shipmentItem.findMany({
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

    return this.prisma.shipmentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_DETAIL_INCLUDE,
    });
  }

  /** Items currently associated with a warehouse — a live view, not a separate stored record. */
  async getInventory(tenantId: string, params: { warehouseId?: string; search?: string }) {
    const query = params.search?.trim();
    return this.prisma.shipmentItem.findMany({
      where: {
        tenantId,
        currentWarehouseId: params.warehouseId ? params.warehouseId : { not: null },
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
}
