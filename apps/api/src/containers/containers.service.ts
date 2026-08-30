import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ContainerStatus as DbContainerStatus,
  ShipmentItemStatus as DbShipmentItemStatus,
  ShipmentStatus as DbShipmentStatus,
  TrackingEventSource,
} from '@prisma/client';
import { ShipmentItemStatus, ShipmentStatus, TrackingEventType } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { CreateContainerDto } from './dto/create-container.dto';
import { FinalizeContainerDto } from './dto/finalize-container.dto';
import { LoadItemDto } from './dto/load-item.dto';
import { UnloadItemDto } from './dto/unload-item.dto';

const ACTOR_SELECT = { id: true, firstName: true, lastName: true } as const;

/** Only currently-loaded (not soft-removed) items belong in a "what's in this container right now" view. */
const ACTIVE_CONTAINER_ITEM_INCLUDE = {
  where: { removedAt: null },
  include: {
    shipmentItem: {
      select: {
        id: true,
        itemCode: true,
        itemType: true,
        description: true,
        weight: true,
        weightUnit: true,
        status: true,
      },
    },
    shipment: {
      select: {
        id: true,
        trackingNumber: true,
        destinationCountry: true,
        destinationLocation: true,
        customer: { select: { id: true, customerNumber: true, firstName: true, lastName: true } },
      },
    },
    loadedByUser: { select: ACTOR_SELECT },
  },
} satisfies Prisma.Container$itemsArgs;

const CONTAINER_DETAIL_INCLUDE = {
  warehouse: { select: { id: true, name: true, code: true } },
  route: { select: { id: true, name: true, originCountry: true, destinationCountry: true } },
  loadingFinalizedByUser: { select: ACTOR_SELECT },
  items: ACTIVE_CONTAINER_ITEM_INCLUDE,
  // Milestone 3E Manifest frontend needs to tell "eligible" apart from
  // "already assigned" containers before attempting an assignment.
  manifest: { select: { id: true, manifestNumber: true } },
} satisfies Prisma.ContainerInclude;

type ContainerDetailRaw = Prisma.ContainerGetPayload<{ include: typeof CONTAINER_DETAIL_INCLUDE }>;

/** Groups active items' weight by unit (LB/KG) rather than converting — see schema.prisma Container doc comment. */
function summarizeContents(container: ContainerDetailRaw) {
  const weightByUnit: Record<string, number> = {};
  const customerIds = new Set<string>();
  for (const containerItem of container.items) {
    if (containerItem.shipmentItem.weight) {
      const unit = containerItem.shipmentItem.weightUnit;
      weightByUnit[unit] = (weightByUnit[unit] ?? 0) + Number(containerItem.shipmentItem.weight);
    }
    customerIds.add(containerItem.shipment.customer.id);
  }
  return {
    itemCount: container.items.length,
    customerCount: customerIds.size,
    weightByUnit,
  };
}

/** Milestone 3F: destinationSummary is present only once a container has reached ARRIVED or later. */
const CONTAINER_ARRIVED_OR_LATER: DbContainerStatus[] = [
  DbContainerStatus.ARRIVED,
  DbContainerStatus.UNLOADING,
  DbContainerStatus.CLOSED,
];

/**
 * Live-computed, destination-side progress — never stored, always
 * derived from current ContainerItem + ShipmentItem.status. Deliberately
 * distinguishes "outstanding" (not yet scanned in at destination) from
 * "exception" (scanned in but damaged/missing/flagged) from "received" —
 * an outstanding or exception item is never folded into receivedCount,
 * so a discrepancy can never be silently hidden, including after CLOSE.
 */
function summarizeDestination(container: ContainerDetailRaw) {
  if (!CONTAINER_ARRIVED_OR_LATER.includes(container.status)) {
    return null;
  }
  let receivedCount = 0;
  let exceptionCount = 0;
  let outstandingCount = 0;
  for (const containerItem of container.items) {
    if (containerItem.shipmentItem.status === DbShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE) {
      receivedCount += 1;
    } else if (containerItem.shipmentItem.status === DbShipmentItemStatus.EXCEPTION) {
      exceptionCount += 1;
    } else {
      outstandingCount += 1;
    }
  }
  return { receivedCount, outstandingCount, exceptionCount };
}

function presentContainer(container: ContainerDetailRaw) {
  return { ...container, summary: summarizeContents(container), destinationSummary: summarizeDestination(container) };
}

@Injectable()
export class ContainersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentsService: ShipmentsService,
  ) {}

  async create(tenantId: string, dto: CreateContainerDto) {
    if (dto.warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
      if (!warehouse) {
        throw new NotFoundException('Warehouse not found');
      }
    }
    if (dto.routeId) {
      const route = await this.prisma.route.findFirst({ where: { id: dto.routeId, tenantId } });
      if (!route) {
        throw new NotFoundException('Route not found');
      }
    }

    try {
      const container = await this.prisma.container.create({
        data: {
          tenantId,
          containerNumber: dto.containerNumber.trim(),
          containerType: dto.containerType,
          warehouseId: dto.warehouseId,
          routeId: dto.routeId,
          originPort: dto.originPort,
          destinationPort: dto.destinationPort,
        },
      });
      return this.findById(tenantId, container.id);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(`A container numbered "${dto.containerNumber}" already exists.`);
      }
      throw error;
    }
  }

  async findAll(tenantId: string, params: { status?: DbContainerStatus; warehouseId?: string }) {
    const containers = await this.prisma.container.findMany({
      where: {
        tenantId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      },
      include: CONTAINER_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return containers.map(presentContainer);
  }

  async findById(tenantId: string, id: string) {
    const container = await this.prisma.container.findFirst({
      where: { id, tenantId },
      include: CONTAINER_DETAIL_INCLUDE,
    });
    if (!container) {
      throw new NotFoundException('Container not found');
    }
    return presentContainer(container);
  }

  /**
   * Scans one PROCESSED (Ready) item into a container. The item must
   * currently be at the same warehouse the container is loading at.
   * Cross-tenant, wrong-warehouse, ineligible-status, and already-loaded
   * cases all reject with a specific message rather than silently
   * succeeding or creating a duplicate ContainerItem row.
   */
  async loadItem(tenantId: string, actorUserId: string, containerId: string, itemId: string, dto: LoadItemDto) {
    const container = await this.prisma.container.findFirst({ where: { id: containerId, tenantId } });
    if (!container) {
      throw new NotFoundException('Container not found');
    }
    if (container.status !== DbContainerStatus.BOOKED && container.status !== DbContainerStatus.LOADING) {
      throw new ConflictException(
        `This container is ${container.status} and can no longer accept items.`,
      );
    }
    if (!container.warehouseId) {
      throw new ConflictException('This container has no warehouse assigned yet — set one before loading items.');
    }

    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true, destinationCountry: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled and its items cannot be loaded.');
    }

    if (item.status !== DbShipmentItemStatus.PROCESSED) {
      if (item.status === DbShipmentItemStatus.ASSIGNED_TO_CONTAINER || item.status === DbShipmentItemStatus.LOADED) {
        const activeAssignment = await this.prisma.containerItem.findFirst({
          where: { shipmentItemId: item.id, tenantId, removedAt: null },
          include: { container: { select: { containerNumber: true } } },
        });
        throw new ConflictException(
          `This item is already ${item.status === DbShipmentItemStatus.LOADED ? 'loaded into' : 'assigned to'} container ${activeAssignment?.container.containerNumber ?? 'another container'}.`,
        );
      }
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible for container loading. ` +
          `It must be Processed / Ready first.`,
      );
    }

    if (item.currentWarehouseId !== container.warehouseId) {
      throw new ConflictException("This item is not currently at the container's warehouse.");
    }

    // Soft destination-compatibility check — a mismatch is surfaced, not blocked.
    let destinationWarning: string | undefined;
    if (container.routeId) {
      const route = await this.prisma.route.findUnique({ where: { id: container.routeId } });
      if (route && route.destinationCountry !== item.shipment.destinationCountry) {
        destinationWarning = `This item's destination (${item.shipment.destinationCountry}) does not match the container's route destination (${route.destinationCountry}).`;
      }
    }

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType: TrackingEventType.ASSIGNED_TO_CONTAINER,
        shipmentItemId: item.id,
        itemStatus: ShipmentItemStatus.ASSIGNED_TO_CONTAINER,
        warehouseId: container.warehouseId,
        notes: dto.notes ?? `Loaded into container ${container.containerNumber}`,
        metadata: {
          containerId: container.id,
          containerNumber: container.containerNumber,
          ...(destinationWarning ? { destinationWarning } : {}),
        },
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    await this.prisma.containerItem.create({
      data: {
        tenantId,
        containerId: container.id,
        shipmentId: item.shipmentId,
        shipmentItemId: item.id,
        loadedByUserId: actorUserId,
      },
    });

    if (container.status === DbContainerStatus.BOOKED) {
      await this.prisma.container.update({ where: { id: container.id }, data: { status: DbContainerStatus.LOADING } });
    }

    await this.maybeRollupShipmentConsolidation(tenantId, actorUserId, item.shipmentId);

    const result = await this.findById(tenantId, container.id);
    return destinationWarning ? { ...result, destinationWarning } : result;
  }

  /** Soft-removes an item from a container — only while the container is still accepting items (not yet finalized). */
  async unloadItem(tenantId: string, actorUserId: string, containerId: string, itemId: string, dto: UnloadItemDto) {
    const container = await this.prisma.container.findFirst({ where: { id: containerId, tenantId } });
    if (!container) {
      throw new NotFoundException('Container not found');
    }
    if (container.status !== DbContainerStatus.BOOKED && container.status !== DbContainerStatus.LOADING) {
      throw new ConflictException(`This container is ${container.status} — items can no longer be removed.`);
    }

    const containerItem = await this.prisma.containerItem.findFirst({
      where: { containerId: container.id, shipmentItemId: itemId, tenantId, removedAt: null },
    });
    if (!containerItem) {
      throw new NotFoundException('This item is not currently loaded in this container.');
    }

    await this.prisma.containerItem.update({
      where: { id: containerItem.id },
      data: { removedAt: new Date(), removedByUserId: actorUserId, removalReason: dto.reason ?? null },
    });

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      containerItem.shipmentId,
      {
        eventType: TrackingEventType.REMOVED_FROM_CONTAINER,
        shipmentItemId: itemId,
        itemStatus: ShipmentItemStatus.PROCESSED,
        notes: dto.reason ?? `Removed from container ${container.containerNumber}`,
        metadata: { containerId: container.id, containerNumber: container.containerNumber },
      },
      { source: TrackingEventSource.MANUAL },
    );

    const remainingActive = await this.prisma.containerItem.count({
      where: { containerId: container.id, tenantId, removedAt: null },
    });
    if (remainingActive === 0 && container.status === DbContainerStatus.LOADING) {
      await this.prisma.container.update({ where: { id: container.id }, data: { status: DbContainerStatus.BOOKED } });
    }

    await this.maybeRollupShipmentConsolidation(tenantId, actorUserId, containerItem.shipmentId);

    return this.findById(tenantId, container.id);
  }

  /**
   * Seals the container: LOADING -> LOADED, and every currently-loaded
   * item bulk-advances ASSIGNED_TO_CONTAINER -> LOADED. This is a one-way
   * gate — once finalized, ContainerItem rows for this container are
   * immutable (loadItem/unloadItem both reject once status is no longer
   * BOOKED/LOADING), and no code path in this milestone ever reverts a
   * LOADED item or shipment back.
   */
  async finalize(tenantId: string, actorUserId: string, containerId: string, dto: FinalizeContainerDto) {
    const container = await this.prisma.container.findFirst({ where: { id: containerId, tenantId } });
    if (!container) {
      throw new NotFoundException('Container not found');
    }
    if (container.status !== DbContainerStatus.LOADING) {
      throw new ConflictException(
        `Container must be actively loading to finalize (current status: ${container.status}).`,
      );
    }

    const activeItems = await this.prisma.containerItem.findMany({
      where: { containerId: container.id, tenantId, removedAt: null },
      select: { shipmentItemId: true, shipmentId: true },
    });
    // Defense-in-depth: unloadItem already demotes LOADING -> BOOKED the
    // moment a container's last active item is removed, so a LOADING
    // container with zero active items shouldn't be reachable through the
    // normal API flow — this guard exists in case that invariant ever
    // changes.
    if (activeItems.length === 0) {
      throw new BadRequestException('Cannot finalize an empty container.');
    }

    await this.prisma.container.update({
      where: { id: container.id },
      data: {
        status: DbContainerStatus.LOADED,
        sealNumber: dto.sealNumber ?? container.sealNumber,
        loadingFinalizedAt: new Date(),
        loadingFinalizedByUserId: actorUserId,
      },
    });

    for (const containerItem of activeItems) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        containerItem.shipmentId,
        {
          eventType: TrackingEventType.LOADED,
          shipmentItemId: containerItem.shipmentItemId,
          itemStatus: ShipmentItemStatus.LOADED,
          warehouseId: container.warehouseId ?? undefined,
          notes: `Sealed into container ${container.containerNumber}`,
          metadata: { containerId: container.id, containerNumber: container.containerNumber },
        },
        { source: TrackingEventSource.SYSTEM },
      );
    }

    const affectedShipmentIds = [...new Set(activeItems.map((containerItem) => containerItem.shipmentId))];
    for (const shipmentId of affectedShipmentIds) {
      await this.maybeRollupShipmentConsolidation(tenantId, actorUserId, shipmentId);
    }

    return this.findById(tenantId, container.id);
  }

  /**
   * Milestone 3F: ARRIVED -> UNLOADING — staff has broken the seal and
   * begun destination processing. A pure container-status bookkeeping
   * transition, same as BOOKED -> LOADING in loadItem() above: it does
   * not itself change any item's status (items are already
   * ARRIVED_DESTINATION from the manifest's own arrive() cascade), so no
   * TrackingEvent is written here — there is nothing new to report on
   * any individual shipment yet.
   */
  async openForUnloading(tenantId: string, containerId: string) {
    const container = await this.prisma.container.findFirst({ where: { id: containerId, tenantId } });
    if (!container) {
      throw new NotFoundException('Container not found');
    }
    if (container.status !== DbContainerStatus.ARRIVED) {
      throw new ConflictException(`Container must be ARRIVED to open for unloading (current: ${container.status}).`);
    }
    await this.prisma.container.update({ where: { id: container.id }, data: { status: DbContainerStatus.UNLOADING } });
    return this.findById(tenantId, container.id);
  }

  /**
   * Milestone 3F: UNLOADING -> CLOSED — staff has finished destination
   * processing for this container. Deliberately does NOT require every
   * item to have been received: a still-outstanding or EXCEPTION item is
   * a real discrepancy, not a blocker — closing just means "we're done
   * looking," and the discrepancy stays fully visible afterward via
   * destinationSummary (see summarizeDestination) rather than being
   * silently dropped. No item ever advances past
   * RECEIVED_DESTINATION_WAREHOUSE as a side effect of closing — Ready
   * for Pickup/Delivery is a distinct later milestone.
   */
  async closeUnloading(tenantId: string, containerId: string) {
    const container = await this.prisma.container.findFirst({ where: { id: containerId, tenantId } });
    if (!container) {
      throw new NotFoundException('Container not found');
    }
    if (container.status !== DbContainerStatus.UNLOADING) {
      throw new ConflictException(`Container must be UNLOADING to close (current: ${container.status}).`);
    }
    await this.prisma.container.update({ where: { id: container.id }, data: { status: DbContainerStatus.CLOSED } });
    return this.findById(tenantId, container.id);
  }

  /**
   * Bidirectional between READY_FOR_CONSOLIDATION and CONSOLIDATED, mirroring
   * the pattern established for the receive/process rollups (including the
   * READY_FOR_CONSOLIDATION downgrade fix):
   *   - READY_FOR_CONSOLIDATION -> CONSOLIDATED the first time any item is
   *     assigned to a container.
   *   - CONSOLIDATED -> READY_FOR_CONSOLIDATION if every item is later
   *     unassigned again (e.g. all removed before finalization).
   *   - CONSOLIDATED -> LOADED once every item is LOADED (finalized).
   * LOADED is a hard, one-way gate here too — the eligible-status allow-list
   * never includes it, so a shipment already LOADED (or further) is never
   * touched by this function.
   */
  private async maybeRollupShipmentConsolidation(tenantId: string, actorUserId: string, shipmentId: string) {
    const ROLLUP_ELIGIBLE_STATUSES: DbShipmentStatus[] = [
      DbShipmentStatus.READY_FOR_CONSOLIDATION,
      DbShipmentStatus.CONSOLIDATED,
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

    const anyAssignedOrLoaded = shipment.items.some(
      (shipmentItem) =>
        shipmentItem.status === DbShipmentItemStatus.ASSIGNED_TO_CONTAINER ||
        shipmentItem.status === DbShipmentItemStatus.LOADED,
    );

    if (currentStatus === DbShipmentStatus.READY_FOR_CONSOLIDATION && anyAssignedOrLoaded) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.CONSOLIDATED,
          status: ShipmentStatus.CONSOLIDATED,
          notes: 'Item(s) assigned to a container',
        },
        { source: TrackingEventSource.SYSTEM },
      );
      currentStatus = DbShipmentStatus.CONSOLIDATED;
    } else if (currentStatus === DbShipmentStatus.CONSOLIDATED && !anyAssignedOrLoaded) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.REMOVED_FROM_CONTAINER,
          status: ShipmentStatus.READY_FOR_CONSOLIDATION,
          notes: 'No items currently assigned to a container',
        },
        { source: TrackingEventSource.SYSTEM },
      );
      currentStatus = DbShipmentStatus.READY_FOR_CONSOLIDATION;
    }

    const allLoaded = shipment.items.every((shipmentItem) => shipmentItem.status === DbShipmentItemStatus.LOADED);
    if (currentStatus === DbShipmentStatus.CONSOLIDATED && allLoaded) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.LOADED,
          status: ShipmentStatus.LOADED,
          notes: 'All items loaded into container(s)',
        },
        { source: TrackingEventSource.SYSTEM },
      );
    }
  }
}
