import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ContainerStatus as DbContainerStatus,
  ManifestStatus as DbManifestStatus,
  ShipmentItemStatus as DbShipmentItemStatus,
  ShipmentMode as DbShipmentMode,
  ShipmentStatus as DbShipmentStatus,
  TrackingEventSource,
} from '@prisma/client';
import { ShipmentItemStatus, ShipmentStatus, TrackingEventType } from '@transatlantic/shared';
import { generateManifestNumber } from '../common/numbering/numbering.util';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { AssignContainerDto } from './dto/assign-container.dto';
import { AssignItemDto } from './dto/assign-item.dto';
import { CreateManifestDto } from './dto/create-manifest.dto';
import { UnassignDto } from './dto/unassign.dto';

const ACTOR_SELECT = { id: true, firstName: true, lastName: true } as const;
const WAREHOUSE_SELECT = { id: true, name: true, code: true } as const;

/**
 * Milestone 3E-B adds assignment: `containers`/`items` are no longer
 * always empty. Each assigned container's active ContainerItem rows are
 * fetched too (weight/weightUnit/customerId only) so the manifest-level
 * summary can aggregate real cargo across both the container path and
 * the direct-item (air) path — that nested detail is stripped back out
 * in `present()` so the exposed `containers[]` shape stays the minimal
 * ManifestContainerSummary contract, not a full container dump (GET
 * /containers/:id already exists for that).
 */
const MANIFEST_DETAIL_INCLUDE = {
  originWarehouse: { select: WAREHOUSE_SELECT },
  route: { select: { id: true, name: true, originCountry: true, destinationCountry: true } },
  finalizedByUser: { select: ACTOR_SELECT },
  departedByUser: { select: ACTOR_SELECT },
  arrivedByUser: { select: ACTOR_SELECT },
  containers: {
    select: {
      id: true,
      containerNumber: true,
      containerType: true,
      status: true,
      items: {
        where: { removedAt: null },
        select: {
          shipmentItem: { select: { weight: true, weightUnit: true } },
          shipment: { select: { customerId: true } },
        },
      },
    },
  },
  items: {
    where: { removedAt: null },
    include: {
      addedByUser: { select: ACTOR_SELECT },
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
    },
  },
} satisfies Prisma.ManifestInclude;

type ManifestDetailRaw = Prisma.ManifestGetPayload<{ include: typeof MANIFEST_DETAIL_INCLUDE }>;

/**
 * Live-computed, never stored. Aggregates real cargo across both paths:
 * each assigned container's active ContainerItem rows, plus every direct
 * ManifestItem. Weight is grouped by unit rather than converted — the
 * schema has no canonical-unit setting to safely normalize LB/KG against,
 * so a mixed-unit total would misrepresent the true weight; reporting
 * "1,240 LB + 60 KG" separately is honest, a single blended number would
 * not be.
 */
function summarize(manifest: ManifestDetailRaw) {
  const weightByUnit: Record<string, number> = {};
  const customerIds = new Set<string>();
  let itemCount = 0;

  for (const container of manifest.containers) {
    for (const containerItem of container.items) {
      itemCount += 1;
      if (containerItem.shipmentItem.weight) {
        const unit = containerItem.shipmentItem.weightUnit;
        weightByUnit[unit] = (weightByUnit[unit] ?? 0) + Number(containerItem.shipmentItem.weight);
      }
      customerIds.add(containerItem.shipment.customerId);
    }
  }
  for (const manifestItem of manifest.items) {
    itemCount += 1;
    if (manifestItem.shipmentItem.weight) {
      const unit = manifestItem.shipmentItem.weightUnit;
      weightByUnit[unit] = (weightByUnit[unit] ?? 0) + Number(manifestItem.shipmentItem.weight);
    }
    customerIds.add(manifestItem.shipment.customer.id);
  }

  return {
    containerCount: manifest.containers.length,
    itemCount,
    customerCount: customerIds.size,
    weightByUnit,
  };
}

function present(manifest: ManifestDetailRaw) {
  const summary = summarize(manifest);
  // Strip the nested item-aggregation detail back out of `containers` —
  // exposed shape is the minimal ManifestContainerSummary contract.
  const containers = manifest.containers.map(({ id, containerNumber, containerType, status }) => ({
    id,
    containerNumber,
    containerType,
    status,
  }));
  return { ...manifest, containers, summary };
}

const OCEAN_RORO_MODES: DbShipmentMode[] = [
  DbShipmentMode.OCEAN_LCL,
  DbShipmentMode.OCEAN_FCL,
  DbShipmentMode.RORO,
];

/**
 * "At least this far along" sets for the shipment-level rollups below.
 * Necessary because a shipment's items don't move in lockstep once
 * departure is possible: one item can reach DEPARTED_ORIGIN on an
 * earlier manifest while a sibling item is still sitting at PROCESSED,
 * unassigned to anything. A naive "every item's status === LOADED"
 * check would never be true again once the first item departs (it's
 * moved past LOADED), so these rollups instead ask "has every item
 * reached at least this stage" — an item further along than the stage
 * being checked still satisfies it.
 */
const ITEM_COMMITTED_OR_LATER: DbShipmentItemStatus[] = [
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
const ITEM_LOADED_OR_LATER: DbShipmentItemStatus[] = [
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
const ITEM_DEPARTED_OR_LATER: DbShipmentItemStatus[] = [
  DbShipmentItemStatus.DEPARTED_ORIGIN,
  DbShipmentItemStatus.IN_TRANSIT,
  DbShipmentItemStatus.ARRIVED_DESTINATION,
  DbShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE,
  DbShipmentItemStatus.READY_FOR_PICKUP,
  DbShipmentItemStatus.OUT_FOR_DELIVERY,
  DbShipmentItemStatus.DELIVERED,
  DbShipmentItemStatus.PICKED_UP,
];
/** Milestone 3F: used by maybeRollupShipmentArrival below. */
const ITEM_ARRIVED_OR_LATER: DbShipmentItemStatus[] = [
  DbShipmentItemStatus.ARRIVED_DESTINATION,
  DbShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE,
  DbShipmentItemStatus.READY_FOR_PICKUP,
  DbShipmentItemStatus.OUT_FOR_DELIVERY,
  DbShipmentItemStatus.DELIVERED,
  DbShipmentItemStatus.PICKED_UP,
];

const FINALIZE_ITEM_SELECT = {
  id: true,
  itemCode: true,
  itemType: true,
  status: true,
  weight: true,
  weightUnit: true,
} satisfies Prisma.ShipmentItemSelect;

const FINALIZE_SHIPMENT_SELECT = {
  id: true,
  trackingNumber: true,
  destinationCountry: true,
  destinationLocation: true,
  customer: { select: { id: true, customerNumber: true, firstName: true, lastName: true } },
} satisfies Prisma.ShipmentSelect;

const FINALIZE_CONTAINER_INCLUDE = {
  items: {
    where: { removedAt: null },
    include: {
      shipmentItem: { select: FINALIZE_ITEM_SELECT },
      shipment: { select: FINALIZE_SHIPMENT_SELECT },
    },
  },
} satisfies Prisma.ContainerInclude;

const FINALIZE_MANIFEST_ITEM_INCLUDE = {
  shipmentItem: { select: FINALIZE_ITEM_SELECT },
  shipment: { select: FINALIZE_SHIPMENT_SELECT },
} satisfies Prisma.ManifestItemInclude;

type FinalizeContainerRaw = Prisma.ContainerGetPayload<{ include: typeof FINALIZE_CONTAINER_INCLUDE }>;
type FinalizeManifestItemRaw = Prisma.ManifestItemGetPayload<{ include: typeof FINALIZE_MANIFEST_ITEM_INCLUDE }>;

/**
 * Immutable operational snapshot captured at finalize time — "what was
 * approved for transport," reconstructable even if the underlying
 * container/item rows are edited afterward (which they can't be, once
 * FINALIZED, but this also survives e.g. a shipment's own fields
 * changing later). Deliberately excludes customer contact details
 * (email/phone) and declared value — only what's needed to identify and
 * route the cargo, matching the same minimalism ItemLabel.tsx already
 * applies to printed labels.
 */
function buildFinalizeSnapshot(
  manifest: {
    manifestNumber: string;
    tenantId: string;
    shipmentMode: DbShipmentMode;
    originLocation: string | null;
    destinationLocation: string | null;
    originWarehouseId: string | null;
    routeId: string | null;
    carrierName: string | null;
    vesselName: string | null;
    voyageNumber: string | null;
    flightNumber: string | null;
    plannedDepartureAt: Date | null;
    estimatedArrivalAt: Date | null;
  },
  containers: FinalizeContainerRaw[],
  manifestItems: FinalizeManifestItemRaw[],
  finalizedAt: Date,
  finalizedByUserId: string,
) {
  const toItemSnapshot = (
    shipmentItem: FinalizeManifestItemRaw['shipmentItem'],
    shipment: FinalizeManifestItemRaw['shipment'],
  ) => ({
    shipmentItemId: shipmentItem.id,
    itemCode: shipmentItem.itemCode,
    itemType: shipmentItem.itemType,
    weight: shipmentItem.weight ? shipmentItem.weight.toString() : null,
    weightUnit: shipmentItem.weightUnit,
    shipmentId: shipment.id,
    trackingNumber: shipment.trackingNumber,
    destinationCountry: shipment.destinationCountry,
    destinationLocation: shipment.destinationLocation,
    customer: {
      id: shipment.customer.id,
      customerNumber: shipment.customer.customerNumber,
      firstName: shipment.customer.firstName,
      lastName: shipment.customer.lastName,
    },
  });

  const weightByUnit: Record<string, number> = {};
  const customerIds = new Set<string>();
  let itemCount = 0;
  const addToSummary = (shipmentItem: FinalizeManifestItemRaw['shipmentItem'], shipment: FinalizeManifestItemRaw['shipment']) => {
    itemCount += 1;
    if (shipmentItem.weight) {
      weightByUnit[shipmentItem.weightUnit] = (weightByUnit[shipmentItem.weightUnit] ?? 0) + Number(shipmentItem.weight);
    }
    customerIds.add(shipment.customer.id);
  };

  const containerSnapshots = containers.map((container) => {
    for (const containerItem of container.items) {
      addToSummary(containerItem.shipmentItem, containerItem.shipment);
    }
    return {
      id: container.id,
      containerNumber: container.containerNumber,
      containerType: container.containerType,
      status: container.status,
      items: container.items.map((containerItem) => toItemSnapshot(containerItem.shipmentItem, containerItem.shipment)),
    };
  });

  const directItemSnapshots = manifestItems.map((manifestItem) => {
    addToSummary(manifestItem.shipmentItem, manifestItem.shipment);
    return toItemSnapshot(manifestItem.shipmentItem, manifestItem.shipment);
  });

  return {
    manifestNumber: manifest.manifestNumber,
    tenantId: manifest.tenantId,
    shipmentMode: manifest.shipmentMode,
    originLocation: manifest.originLocation,
    destinationLocation: manifest.destinationLocation,
    originWarehouseId: manifest.originWarehouseId,
    routeId: manifest.routeId,
    carrierName: manifest.carrierName,
    vesselName: manifest.vesselName,
    voyageNumber: manifest.voyageNumber,
    flightNumber: manifest.flightNumber,
    plannedDepartureAt: manifest.plannedDepartureAt?.toISOString() ?? null,
    estimatedArrivalAt: manifest.estimatedArrivalAt?.toISOString() ?? null,
    finalizedAt: finalizedAt.toISOString(),
    finalizedByUserId,
    containers: containerSnapshots,
    items: directItemSnapshots,
    summary: {
      containerCount: containers.length,
      itemCount,
      customerCount: customerIds.size,
      weightByUnit,
    },
  };
}

@Injectable()
export class ManifestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentsService: ShipmentsService,
  ) {}

  async create(tenantId: string, dto: CreateManifestDto) {
    if (dto.originWarehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { id: dto.originWarehouseId, tenantId },
      });
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

    const manifestNumber = await generateManifestNumber(this.prisma, tenantId);

    const manifest = await this.prisma.manifest.create({
      data: {
        tenantId,
        manifestNumber,
        shipmentMode: dto.shipmentMode,
        originWarehouseId: dto.originWarehouseId,
        routeId: dto.routeId,
        originLocation: dto.originLocation,
        destinationLocation: dto.destinationLocation,
        carrierName: dto.carrierName,
        vesselName: dto.vesselName,
        voyageNumber: dto.voyageNumber,
        flightNumber: dto.flightNumber,
        plannedDepartureAt: dto.plannedDepartureAt ? new Date(dto.plannedDepartureAt) : undefined,
        estimatedArrivalAt: dto.estimatedArrivalAt ? new Date(dto.estimatedArrivalAt) : undefined,
      },
    });

    return this.findById(tenantId, manifest.id);
  }

  async findAll(tenantId: string, params: { status?: DbManifestStatus; shipmentMode?: DbShipmentMode }) {
    const manifests = await this.prisma.manifest.findMany({
      where: {
        tenantId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.shipmentMode ? { shipmentMode: params.shipmentMode } : {}),
      },
      include: MANIFEST_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return manifests.map(present);
  }

  async findById(tenantId: string, id: string) {
    const manifest = await this.prisma.manifest.findFirst({
      where: { id, tenantId },
      include: MANIFEST_DETAIL_INCLUDE,
    });
    if (!manifest) {
      throw new NotFoundException('Manifest not found');
    }
    return present(manifest);
  }

  /**
   * Assigns one already-sealed (LOADED) container to an Ocean/RoRo
   * manifest. Never touches the container's items' ShipmentItemStatus —
   * they're already LOADED from the container's own finalize step
   * (Milestone 3D) and stay that way; assignment only records that this
   * container is now scheduled on this manifest. One TrackingEvent per
   * currently-loaded item records the assignment for audit purposes
   * (eventType ASSIGNED_TO_MANIFEST, no itemStatus change), matching
   * "capture tenant/manifest/container/user/timestamp/action" without
   * misrepresenting this as departure.
   */
  async assignContainer(
    tenantId: string,
    actorUserId: string,
    manifestId: string,
    containerId: string,
    dto: AssignContainerDto,
  ) {
    const manifest = await this.prisma.manifest.findFirst({ where: { id: manifestId, tenantId } });
    if (!manifest) {
      throw new NotFoundException('Manifest not found');
    }
    if (manifest.status !== DbManifestStatus.DRAFT) {
      throw new ConflictException(`Manifest must be DRAFT to assign containers (current: ${manifest.status}).`);
    }
    if (!OCEAN_RORO_MODES.includes(manifest.shipmentMode)) {
      throw new ConflictException(
        'Containers can only be assigned to an Ocean/RoRo manifest. Assign items directly for an Air manifest.',
      );
    }

    const container = await this.prisma.container.findFirst({
      where: { id: containerId, tenantId },
      include: {
        items: {
          where: { removedAt: null },
          include: { shipment: { select: { id: true, destinationCountry: true } } },
        },
      },
    });
    if (!container) {
      throw new NotFoundException('Container not found');
    }
    if (container.status !== DbContainerStatus.LOADED) {
      throw new ConflictException(
        `Container must be sealed (status LOADED) to be assigned to a manifest (current: ${container.status}).`,
      );
    }
    if (container.manifestId === manifest.id) {
      throw new ConflictException('This container is already assigned to this manifest.');
    }
    if (container.manifestId) {
      const existing = await this.prisma.manifest.findUnique({
        where: { id: container.manifestId },
        select: { manifestNumber: true },
      });
      throw new ConflictException(
        `This container is already assigned to manifest ${existing?.manifestNumber ?? 'another manifest'}.`,
      );
    }

    if (manifest.originWarehouseId && container.warehouseId !== manifest.originWarehouseId) {
      throw new ConflictException("This container's warehouse does not match the manifest's origin warehouse.");
    }

    // Soft-but-real destination check: only enforced when the manifest
    // has a structured route to compare against, and only rejects when
    // EVERY item in the container disagrees with it — a partially mixed
    // consolidation container is not "obviously incompatible," it's
    // normal LCL practice, and this deliberately doesn't try to be a
    // full routing engine.
    if (manifest.routeId && container.items.length > 0) {
      const route = await this.prisma.route.findUnique({ where: { id: manifest.routeId } });
      if (route) {
        const anyMatch = container.items.some(
          (containerItem) => containerItem.shipment.destinationCountry === route.destinationCountry,
        );
        if (!anyMatch) {
          throw new ConflictException(
            `This container's cargo destination doesn't match manifest route destination (${route.destinationCountry}).`,
          );
        }
      }
    }

    await this.prisma.container.update({ where: { id: container.id }, data: { manifestId: manifest.id } });

    for (const containerItem of container.items) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        containerItem.shipment.id,
        {
          eventType: TrackingEventType.ASSIGNED_TO_MANIFEST,
          shipmentItemId: containerItem.shipmentItemId,
          notes: dto.notes ?? `Container ${container.containerNumber} assigned to manifest ${manifest.manifestNumber}`,
          metadata: {
            manifestId: manifest.id,
            manifestNumber: manifest.manifestNumber,
            containerId: container.id,
            containerNumber: container.containerNumber,
          },
        },
        { source: TrackingEventSource.MANUAL },
      );
    }

    return this.findById(tenantId, manifest.id);
  }

  /** Unassigns a container — only while the manifest is still DRAFT. Never deletes the container or its history. */
  async unassignContainer(tenantId: string, actorUserId: string, manifestId: string, containerId: string, dto: UnassignDto) {
    const manifest = await this.prisma.manifest.findFirst({ where: { id: manifestId, tenantId } });
    if (!manifest) {
      throw new NotFoundException('Manifest not found');
    }
    if (manifest.status !== DbManifestStatus.DRAFT) {
      throw new ConflictException(`Manifest must be DRAFT to unassign containers (current: ${manifest.status}).`);
    }

    const container = await this.prisma.container.findFirst({
      where: { id: containerId, tenantId, manifestId: manifest.id },
      include: {
        items: {
          where: { removedAt: null },
          include: { shipment: { select: { id: true } } },
        },
      },
    });
    if (!container) {
      throw new NotFoundException('This container is not currently assigned to this manifest.');
    }

    await this.prisma.container.update({ where: { id: container.id }, data: { manifestId: null } });

    for (const containerItem of container.items) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        containerItem.shipment.id,
        {
          eventType: TrackingEventType.REMOVED_FROM_MANIFEST,
          shipmentItemId: containerItem.shipmentItemId,
          notes: dto.reason ?? `Container ${container.containerNumber} removed from manifest ${manifest.manifestNumber}`,
          metadata: {
            manifestId: manifest.id,
            manifestNumber: manifest.manifestNumber,
            containerId: container.id,
            containerNumber: container.containerNumber,
          },
        },
        { source: TrackingEventSource.MANUAL },
      );
    }

    return this.findById(tenantId, manifest.id);
  }

  /**
   * Assigns one PROCESSED (Ready) item directly to an Air manifest — no
   * container involved. Mirrors ContainersService.loadItem's eligibility
   * posture exactly (status/warehouse checks, clear 409 messaging), but
   * ShipmentItemStatus moves PROCESSED -> ASSIGNED_TO_MANIFEST (the
   * air-specific equivalent of ASSIGNED_TO_CONTAINER) since there's no
   * container-finalize step to defer the LOADED transition to for air.
   */
  async assignItem(tenantId: string, actorUserId: string, manifestId: string, itemId: string, dto: AssignItemDto) {
    const manifest = await this.prisma.manifest.findFirst({ where: { id: manifestId, tenantId } });
    if (!manifest) {
      throw new NotFoundException('Manifest not found');
    }
    if (manifest.status !== DbManifestStatus.DRAFT) {
      throw new ConflictException(`Manifest must be DRAFT to assign items (current: ${manifest.status}).`);
    }
    if (manifest.shipmentMode !== DbShipmentMode.AIR) {
      throw new ConflictException(
        'Items can only be assigned directly to an Air manifest. Assign a sealed container for Ocean/RoRo.',
      );
    }

    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, tenantId },
      include: { shipment: { select: { id: true, status: true, destinationCountry: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (item.shipment.status === DbShipmentStatus.CANCELLED) {
      throw new ConflictException('This shipment has been cancelled and its items cannot be assigned.');
    }

    if (item.status !== DbShipmentItemStatus.PROCESSED) {
      if (item.status === DbShipmentItemStatus.ASSIGNED_TO_MANIFEST) {
        const activeAssignment = await this.prisma.manifestItem.findFirst({
          where: { shipmentItemId: item.id, tenantId, removedAt: null },
          include: { manifest: { select: { manifestNumber: true } } },
        });
        throw new ConflictException(
          `This item is already assigned to manifest ${activeAssignment?.manifest.manifestNumber ?? 'another manifest'}.`,
        );
      }
      throw new ConflictException(
        `This item's current status (${item.status}) is not eligible for manifest assignment. ` +
          `It must be Processed / Ready first.`,
      );
    }

    if (manifest.originWarehouseId && item.currentWarehouseId !== manifest.originWarehouseId) {
      throw new ConflictException("This item is not currently at the manifest's origin warehouse.");
    }

    if (manifest.routeId) {
      const route = await this.prisma.route.findUnique({ where: { id: manifest.routeId } });
      if (route && route.destinationCountry !== item.shipment.destinationCountry) {
        throw new ConflictException(
          `This item's destination (${item.shipment.destinationCountry}) doesn't match manifest route destination (${route.destinationCountry}).`,
        );
      }
    }

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      item.shipmentId,
      {
        eventType: TrackingEventType.ASSIGNED_TO_MANIFEST,
        shipmentItemId: item.id,
        itemStatus: ShipmentItemStatus.ASSIGNED_TO_MANIFEST,
        notes: dto.notes ?? `Assigned to manifest ${manifest.manifestNumber}`,
        metadata: { manifestId: manifest.id, manifestNumber: manifest.manifestNumber },
      },
      {
        source: dto.scanned ? TrackingEventSource.BARCODE_SCAN : TrackingEventSource.MANUAL,
        scanIdentifier: dto.scanIdentifier,
      },
    );

    await this.prisma.manifestItem.create({
      data: {
        tenantId,
        manifestId: manifest.id,
        shipmentId: item.shipmentId,
        shipmentItemId: item.id,
        addedByUserId: actorUserId,
      },
    });

    await this.maybeRollupShipmentConsolidation(tenantId, actorUserId, item.shipmentId);

    return this.findById(tenantId, manifest.id);
  }

  /** Unassigns a direct item — only while the manifest is still DRAFT. Item reverts to PROCESSED. */
  async unassignItem(tenantId: string, actorUserId: string, manifestId: string, itemId: string, dto: UnassignDto) {
    const manifest = await this.prisma.manifest.findFirst({ where: { id: manifestId, tenantId } });
    if (!manifest) {
      throw new NotFoundException('Manifest not found');
    }
    if (manifest.status !== DbManifestStatus.DRAFT) {
      throw new ConflictException(`Manifest must be DRAFT to unassign items (current: ${manifest.status}).`);
    }

    const manifestItem = await this.prisma.manifestItem.findFirst({
      where: { manifestId: manifest.id, shipmentItemId: itemId, tenantId, removedAt: null },
    });
    if (!manifestItem) {
      throw new NotFoundException('This item is not currently assigned to this manifest.');
    }

    await this.prisma.manifestItem.update({
      where: { id: manifestItem.id },
      data: { removedAt: new Date(), removedByUserId: actorUserId, removalReason: dto.reason ?? null },
    });

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      manifestItem.shipmentId,
      {
        eventType: TrackingEventType.REMOVED_FROM_MANIFEST,
        shipmentItemId: itemId,
        itemStatus: ShipmentItemStatus.PROCESSED,
        notes: dto.reason ?? `Removed from manifest ${manifest.manifestNumber}`,
        metadata: { manifestId: manifest.id, manifestNumber: manifest.manifestNumber },
      },
      { source: TrackingEventSource.MANUAL },
    );

    await this.maybeRollupShipmentConsolidation(tenantId, actorUserId, manifestItem.shipmentId);

    return this.findById(tenantId, manifest.id);
  }

  /**
   * DRAFT -> FINALIZED only. Finalization means the manifest's transport
   * contents are reviewed and locked, ready for departure — it does NOT
   * mean anything has physically departed. No shipment/container/item
   * ever moves to a DEPARTED/IN_TRANSIT status here; that is Milestone
   * 3E-D's job, deliberately not touched by this method.
   *
   * All validation runs before any write, so a rejected finalize leaves
   * the manifest exactly as it was (DRAFT, untouched) — there is nothing
   * to roll back. Re-finalizing an already-FINALIZED manifest hits the
   * same "must be DRAFT" guard as every other mutation here, so a
   * duplicate request 409s rather than silently repeating the side
   * effects (no duplicate snapshot, no duplicate tracking events).
   */
  async finalize(tenantId: string, actorUserId: string, manifestId: string) {
    const manifest = await this.prisma.manifest.findFirst({ where: { id: manifestId, tenantId } });
    if (!manifest) {
      throw new NotFoundException('Manifest not found');
    }
    if (manifest.status !== DbManifestStatus.DRAFT) {
      throw new ConflictException(`Manifest must be DRAFT to finalize (current: ${manifest.status}).`);
    }

    const isAir = manifest.shipmentMode === DbShipmentMode.AIR;

    // Required transport information for the mode.
    const missing: string[] = [];
    if (!manifest.carrierName?.trim()) missing.push('carrierName');
    if (isAir) {
      if (!manifest.flightNumber?.trim()) missing.push('flightNumber');
    } else {
      if (!manifest.vesselName?.trim()) missing.push('vesselName');
      if (!manifest.voyageNumber?.trim()) missing.push('voyageNumber');
    }
    if (!manifest.originLocation?.trim() && !manifest.originWarehouseId) {
      missing.push('origin (originLocation or originWarehouseId)');
    }
    if (!manifest.destinationLocation?.trim()) {
      missing.push('destinationLocation');
    }
    if (missing.length > 0) {
      throw new BadRequestException(`Cannot finalize: missing required transport information (${missing.join(', ')}).`);
    }

    let containers: FinalizeContainerRaw[] = [];
    let manifestItems: FinalizeManifestItemRaw[] = [];

    if (isAir) {
      manifestItems = await this.prisma.manifestItem.findMany({
        where: { manifestId: manifest.id, tenantId, removedAt: null },
        include: FINALIZE_MANIFEST_ITEM_INCLUDE,
      });
      if (manifestItems.length === 0) {
        throw new BadRequestException('Cannot finalize an empty manifest — assign at least one item.');
      }
      // Re-check eligibility hasn't regressed since assignment (defense
      // in depth — no code path currently lets an ASSIGNED_TO_MANIFEST
      // item change status without going through unassignItem first, but
      // this guards against that invariant ever changing silently).
      for (const manifestItem of manifestItems) {
        if (manifestItem.shipmentItem.status !== DbShipmentItemStatus.ASSIGNED_TO_MANIFEST) {
          throw new ConflictException(
            `Item ${manifestItem.shipmentItem.itemCode} is no longer eligible ` +
              `(status: ${manifestItem.shipmentItem.status}) — it may have changed since assignment.`,
          );
        }
      }
    } else {
      containers = await this.prisma.container.findMany({
        where: { manifestId: manifest.id, tenantId },
        include: FINALIZE_CONTAINER_INCLUDE,
      });
      if (containers.length === 0) {
        throw new BadRequestException('Cannot finalize an empty manifest — assign at least one container.');
      }
      for (const container of containers) {
        if (container.status !== DbContainerStatus.LOADED) {
          throw new ConflictException(`Container ${container.containerNumber} is no longer sealed (status: ${container.status}).`);
        }
        for (const containerItem of container.items) {
          if (containerItem.shipmentItem.status !== DbShipmentItemStatus.LOADED) {
            throw new ConflictException(
              `Item ${containerItem.shipmentItem.itemCode} in container ${container.containerNumber} is no longer eligible ` +
                `(status: ${containerItem.shipmentItem.status}).`,
            );
          }
        }
      }
    }

    const finalizedAt = new Date();
    const snapshotJson = buildFinalizeSnapshot(manifest, containers, manifestItems, finalizedAt, actorUserId);

    await this.prisma.manifest.update({
      where: { id: manifest.id },
      data: {
        status: DbManifestStatus.FINALIZED,
        finalizedAt,
        finalizedByUserId: actorUserId,
        snapshotJson,
      },
    });

    if (isAir) {
      // The one real status change this method makes: locking each
      // direct item in as loaded/ready-for-transport. This is the "status
      // behavior established in the approved design" for the air path —
      // NOT a departure event (eventType LOADED, never DEPARTED_ORIGIN).
      for (const manifestItem of manifestItems) {
        await this.shipmentsService.createTrackingEvent(
          tenantId,
          actorUserId,
          manifestItem.shipment.id,
          {
            eventType: TrackingEventType.LOADED,
            shipmentItemId: manifestItem.shipmentItem.id,
            itemStatus: ShipmentItemStatus.LOADED,
            notes: `Manifest ${manifest.manifestNumber} finalized — cargo locked for transport`,
            metadata: {
              manifestId: manifest.id,
              manifestNumber: manifest.manifestNumber,
              action: 'MANIFEST_FINALIZED',
            },
          },
          { source: TrackingEventSource.SYSTEM },
        );
      }
      const affectedShipmentIds = new Set(manifestItems.map((manifestItem) => manifestItem.shipment.id));
      for (const shipmentId of affectedShipmentIds) {
        await this.maybeRollupShipmentConsolidation(tenantId, actorUserId, shipmentId);
      }
    } else {
      // Container-path items are already LOADED (from the container's own
      // 3D finalize) — nothing to transition here. Still append one
      // audit-only event per item so "this cargo was included in
      // manifest X, finalized at time Y" is on the shipment's history,
      // without implying a status change or departure. NOTE_ADDED is the
      // existing generic vehicle for exactly this ("operational note",
      // not a new enum value) — the actual fact is carried in
      // notes/metadata, not the event type.
      for (const container of containers) {
        for (const containerItem of container.items) {
          await this.shipmentsService.createTrackingEvent(
            tenantId,
            actorUserId,
            containerItem.shipment.id,
            {
              eventType: TrackingEventType.NOTE_ADDED,
              shipmentItemId: containerItem.shipmentItem.id,
              notes: `Manifest ${manifest.manifestNumber} finalized — cargo locked for transport`,
              metadata: {
                manifestId: manifest.id,
                manifestNumber: manifest.manifestNumber,
                containerId: container.id,
                containerNumber: container.containerNumber,
                action: 'MANIFEST_FINALIZED',
              },
            },
            { source: TrackingEventSource.SYSTEM },
          );
        }
      }
    }

    return this.findById(tenantId, manifest.id);
  }

  /**
   * FINALIZED -> DEPARTED only. This is the one action in the manifest
   * lifecycle that actually represents physical movement: every item on
   * this manifest (via its container, or directly for air) advances
   * LOADED -> DEPARTED_ORIGIN, each container advances LOADED -> DEPARTED,
   * and the manifest itself advances FINALIZED -> DEPARTED. None of this
   * is reversible in this system — matching the same one-way-gate
   * philosophy already established for LOADED (3C/3D): a real departure
   * is not something later code should ever downgrade.
   *
   * Validation happens entirely before any write (same posture as
   * finalize()), so a rejected depart leaves everything untouched.
   * Re-departing an already-DEPARTED manifest hits the same "must be
   * FINALIZED" guard as every other mutation here — 409, no duplicate
   * side effects.
   *
   * NOTE on atomicity: each status-changing step below goes through
   * ShipmentsService.createTrackingEvent, which is itself atomic per
   * call (one internal transaction), but the overall sequence across
   * potentially many containers/items/shipments is not wrapped in a
   * single top-level database transaction — no code in this project does
   * that today (see containers.service.ts's finalize/receive, this same
   * file's own finalize() above). Doing so would require refactoring
   * createTrackingEvent to accept an injectable transaction client, a
   * cross-cutting change touching every existing caller (WarehouseService,
   * ContainersService, ManifestsService) — flagged as a real architectural
   * consideration, not undertaken here since it isn't additive/isolated.
   * Practically: all eligibility is re-validated up front, so under normal
   * operation the sequence always completes; a mid-sequence infrastructure
   * failure (e.g. DB connection drop) could in principle leave a manifest
   * partially processed, exactly as already true of container finalize.
   */
  async depart(tenantId: string, actorUserId: string, manifestId: string) {
    const manifest = await this.prisma.manifest.findFirst({ where: { id: manifestId, tenantId } });
    if (!manifest) {
      throw new NotFoundException('Manifest not found');
    }
    if (manifest.status !== DbManifestStatus.FINALIZED) {
      throw new ConflictException(`Manifest must be FINALIZED to depart (current: ${manifest.status}).`);
    }

    const isAir = manifest.shipmentMode === DbShipmentMode.AIR;
    const departedAt = new Date();
    const affectedShipmentIds = new Set<string>();

    if (isAir) {
      const manifestItems = await this.prisma.manifestItem.findMany({
        where: { manifestId: manifest.id, tenantId, removedAt: null },
        include: {
          shipmentItem: { select: { id: true, itemCode: true, status: true } },
          shipment: { select: { id: true } },
        },
      });
      if (manifestItems.length === 0) {
        throw new ConflictException('This manifest has no items to depart.');
      }
      for (const manifestItem of manifestItems) {
        if (manifestItem.shipmentItem.status !== DbShipmentItemStatus.LOADED) {
          throw new ConflictException(
            `Item ${manifestItem.shipmentItem.itemCode} is not in a departable state (status: ${manifestItem.shipmentItem.status}).`,
          );
        }
      }

      for (const manifestItem of manifestItems) {
        await this.shipmentsService.createTrackingEvent(
          tenantId,
          actorUserId,
          manifestItem.shipment.id,
          {
            eventType: TrackingEventType.DEPARTED_ORIGIN,
            shipmentItemId: manifestItem.shipmentItem.id,
            itemStatus: ShipmentItemStatus.DEPARTED_ORIGIN,
            notes: `Departed on manifest ${manifest.manifestNumber}`,
            metadata: { manifestId: manifest.id, manifestNumber: manifest.manifestNumber },
          },
          { source: TrackingEventSource.SYSTEM },
        );
        affectedShipmentIds.add(manifestItem.shipment.id);
      }
    } else {
      const containers = await this.prisma.container.findMany({
        where: { manifestId: manifest.id, tenantId },
        include: {
          items: {
            where: { removedAt: null },
            include: {
              shipmentItem: { select: { id: true, itemCode: true, status: true } },
              shipment: { select: { id: true } },
            },
          },
        },
      });
      if (containers.length === 0) {
        throw new ConflictException('This manifest has no containers to depart.');
      }
      for (const container of containers) {
        if (container.status !== DbContainerStatus.LOADED) {
          throw new ConflictException(`Container ${container.containerNumber} is not in a departable state (status: ${container.status}).`);
        }
        for (const containerItem of container.items) {
          if (containerItem.shipmentItem.status !== DbShipmentItemStatus.LOADED) {
            throw new ConflictException(
              `Item ${containerItem.shipmentItem.itemCode} in container ${container.containerNumber} is not in a departable state ` +
                `(status: ${containerItem.shipmentItem.status}).`,
            );
          }
        }
      }

      for (const container of containers) {
        for (const containerItem of container.items) {
          await this.shipmentsService.createTrackingEvent(
            tenantId,
            actorUserId,
            containerItem.shipment.id,
            {
              eventType: TrackingEventType.DEPARTED_ORIGIN,
              shipmentItemId: containerItem.shipmentItem.id,
              itemStatus: ShipmentItemStatus.DEPARTED_ORIGIN,
              notes: `Departed on manifest ${manifest.manifestNumber} (container ${container.containerNumber})`,
              metadata: {
                manifestId: manifest.id,
                manifestNumber: manifest.manifestNumber,
                containerId: container.id,
                containerNumber: container.containerNumber,
              },
            },
            { source: TrackingEventSource.SYSTEM },
          );
          affectedShipmentIds.add(containerItem.shipment.id);
        }
        await this.prisma.container.update({
          where: { id: container.id },
          data: { status: DbContainerStatus.DEPARTED, departureDate: departedAt },
        });
      }
    }

    await this.prisma.manifest.update({
      where: { id: manifest.id },
      data: { status: DbManifestStatus.DEPARTED, departedAt, departedByUserId: actorUserId },
    });

    for (const shipmentId of affectedShipmentIds) {
      await this.maybeRollupShipmentDeparture(tenantId, actorUserId, shipmentId);
    }

    return this.findById(tenantId, manifest.id);
  }

  /**
   * DEPARTED -> ARRIVED. This is the "the whole transport movement has
   * landed" gate — bulk and automatic, and deliberately distinct from
   * any individual item being physically received at a destination
   * warehouse (WarehouseService.destinationReceiveItem, Milestone 3F's
   * other half: a separate, later, per-item, staff-scanned action that
   * happens asynchronously and partially over time). Arriving a manifest
   * never sets ShipmentItemStatus.RECEIVED_DESTINATION_WAREHOUSE or
   * ShipmentStatus beyond ARRIVED_DESTINATION — Ready for Pickup/Delivery
   * is out of scope here and belongs to a later milestone.
   *
   * Cascades:
   *   - Ocean/RoRo: every container on this manifest DEPARTED -> ARRIVED,
   *     with actualArrival stamped.
   *   - Air: no containers to cascade.
   *   - Every affected item (via its container, or directly for air):
   *     DEPARTED_ORIGIN -> ARRIVED_DESTINATION.
   *
   * Same posture as finalize()/depart(): all eligibility validated
   * before any write, so a rejected arrive leaves everything untouched;
   * re-arriving an already-ARRIVED manifest hits the same "must be
   * DEPARTED" guard as every other mutation here — 409, no duplicate
   * side effects.
   */
  async arrive(tenantId: string, actorUserId: string, manifestId: string) {
    const manifest = await this.prisma.manifest.findFirst({ where: { id: manifestId, tenantId } });
    if (!manifest) {
      throw new NotFoundException('Manifest not found');
    }
    if (manifest.status !== DbManifestStatus.DEPARTED) {
      throw new ConflictException(`Manifest must be DEPARTED to mark arrived (current: ${manifest.status}).`);
    }

    const isAir = manifest.shipmentMode === DbShipmentMode.AIR;
    const arrivedAt = new Date();
    const affectedShipmentIds = new Set<string>();

    if (isAir) {
      const manifestItems = await this.prisma.manifestItem.findMany({
        where: { manifestId: manifest.id, tenantId, removedAt: null },
        include: {
          shipmentItem: { select: { id: true, itemCode: true, status: true } },
          shipment: { select: { id: true } },
        },
      });
      if (manifestItems.length === 0) {
        throw new ConflictException('This manifest has no items to mark arrived.');
      }
      for (const manifestItem of manifestItems) {
        if (manifestItem.shipmentItem.status !== DbShipmentItemStatus.DEPARTED_ORIGIN) {
          throw new ConflictException(
            `Item ${manifestItem.shipmentItem.itemCode} is not in a departed state (status: ${manifestItem.shipmentItem.status}).`,
          );
        }
      }

      for (const manifestItem of manifestItems) {
        await this.shipmentsService.createTrackingEvent(
          tenantId,
          actorUserId,
          manifestItem.shipment.id,
          {
            eventType: TrackingEventType.ARRIVED_DESTINATION,
            shipmentItemId: manifestItem.shipmentItem.id,
            itemStatus: ShipmentItemStatus.ARRIVED_DESTINATION,
            notes: `Arrived on manifest ${manifest.manifestNumber}`,
            metadata: { manifestId: manifest.id, manifestNumber: manifest.manifestNumber },
          },
          { source: TrackingEventSource.SYSTEM },
        );
        affectedShipmentIds.add(manifestItem.shipment.id);
      }
    } else {
      const containers = await this.prisma.container.findMany({
        where: { manifestId: manifest.id, tenantId },
        include: {
          items: {
            where: { removedAt: null },
            include: {
              shipmentItem: { select: { id: true, itemCode: true, status: true } },
              shipment: { select: { id: true } },
            },
          },
        },
      });
      if (containers.length === 0) {
        throw new ConflictException('This manifest has no containers to mark arrived.');
      }
      for (const container of containers) {
        if (container.status !== DbContainerStatus.DEPARTED) {
          throw new ConflictException(
            `Container ${container.containerNumber} is not in a departed state (status: ${container.status}).`,
          );
        }
      }

      for (const container of containers) {
        for (const containerItem of container.items) {
          await this.shipmentsService.createTrackingEvent(
            tenantId,
            actorUserId,
            containerItem.shipment.id,
            {
              eventType: TrackingEventType.ARRIVED_DESTINATION,
              shipmentItemId: containerItem.shipmentItem.id,
              itemStatus: ShipmentItemStatus.ARRIVED_DESTINATION,
              notes: `Arrived on manifest ${manifest.manifestNumber} (container ${container.containerNumber})`,
              metadata: {
                manifestId: manifest.id,
                manifestNumber: manifest.manifestNumber,
                containerId: container.id,
                containerNumber: container.containerNumber,
              },
            },
            { source: TrackingEventSource.SYSTEM },
          );
          affectedShipmentIds.add(containerItem.shipment.id);
        }
        await this.prisma.container.update({
          where: { id: container.id },
          data: { status: DbContainerStatus.ARRIVED, actualArrival: arrivedAt },
        });
      }
    }

    await this.prisma.manifest.update({
      where: { id: manifest.id },
      data: { status: DbManifestStatus.ARRIVED, arrivedAt, arrivedByUserId: actorUserId },
    });

    for (const shipmentId of affectedShipmentIds) {
      await this.maybeRollupShipmentArrival(tenantId, actorUserId, shipmentId);
    }

    return this.findById(tenantId, manifest.id);
  }

  /**
   * Mirrors ContainersService.maybeRollupShipmentConsolidation for the
   * direct (air) item path — same READY_FOR_CONSOLIDATION <-> CONSOLIDATED
   * <-> LOADED semantics, generalized to also recognize
   * ASSIGNED_TO_MANIFEST (alongside ASSIGNED_TO_CONTAINER) as "this
   * shipment has cargo committed somewhere." Without this, an all-air
   * shipment would never advance past READY_FOR_CONSOLIDATION, since
   * nothing else in the system rolls up the direct-assignment path —
   * ContainersService's version only recognizes ASSIGNED_TO_CONTAINER,
   * and stays that way; this is a deliberate near-duplicate kept local to
   * ManifestsService rather than a shared/exported method, for the same
   * "smaller, safer, self-contained" reasoning as finalize()/depart()'s
   * transaction-boundary notes above.
   *
   * Called from assignItem/unassignItem (the READY_FOR_CONSOLIDATION <->
   * CONSOLIDATED edge) and from finalize()'s air branch, once per
   * affected shipment, after items reach LOADED (the CONSOLIDATED ->
   * LOADED edge). Ocean/container-path shipments never need this call —
   * they already reached LOADED back at their container's own 3D
   * finalize step, before ever becoming eligible for manifest assignment.
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

    const anyCommitted = shipment.items.some((shipmentItem) => ITEM_COMMITTED_OR_LATER.includes(shipmentItem.status));

    if (currentStatus === DbShipmentStatus.READY_FOR_CONSOLIDATION && anyCommitted) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.CONSOLIDATED,
          status: ShipmentStatus.CONSOLIDATED,
          notes: 'Item(s) committed to transport',
        },
        { source: TrackingEventSource.SYSTEM },
      );
      currentStatus = DbShipmentStatus.CONSOLIDATED;
    } else if (currentStatus === DbShipmentStatus.CONSOLIDATED && !anyCommitted) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.REMOVED_FROM_MANIFEST,
          status: ShipmentStatus.READY_FOR_CONSOLIDATION,
          notes: 'No items currently committed to transport',
        },
        { source: TrackingEventSource.SYSTEM },
      );
      currentStatus = DbShipmentStatus.READY_FOR_CONSOLIDATION;
    }

    const allLoaded = shipment.items.every((shipmentItem) => ITEM_LOADED_OR_LATER.includes(shipmentItem.status));
    if (currentStatus === DbShipmentStatus.CONSOLIDATED && allLoaded) {
      await this.shipmentsService.createTrackingEvent(
        tenantId,
        actorUserId,
        shipmentId,
        {
          eventType: TrackingEventType.LOADED,
          status: ShipmentStatus.LOADED,
          notes: 'All items loaded and ready for transport',
        },
        { source: TrackingEventSource.SYSTEM },
      );
    }
  }

  /**
   * Advances a shipment to DEPARTED only once EVERY one of its items has
   * reached DEPARTED_ORIGIN or later — the partial-shipment guard. A
   * shipment's items are not required to travel on the same manifest
   * (some may depart on an earlier container, others on a later flight),
   * so a naive "shipment must currently be LOADED" precondition is too
   * strict: once the first item departs, the shipment may still be
   * sitting at CONSOLIDATED (its last item never having reached LOADED
   * yet, because nothing else was assigned/finalized at the same time).
   * This re-checks the shipment's *current, complete* item list on every
   * call — both the eligible-source-status guard and the "all departed"
   * check use "reached at least this stage," not exact-match, for
   * exactly that reason. Forward-only, and — like every rollup in this
   * codebase — never downgraded: a real departure is final.
   */
  private async maybeRollupShipmentDeparture(tenantId: string, actorUserId: string, shipmentId: string) {
    const ROLLUP_ELIGIBLE_STATUSES: DbShipmentStatus[] = [DbShipmentStatus.CONSOLIDATED, DbShipmentStatus.LOADED];

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
    const allDeparted = shipment.items.every((shipmentItem) => ITEM_DEPARTED_OR_LATER.includes(shipmentItem.status));
    if (!allDeparted) {
      return;
    }

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      shipmentId,
      {
        eventType: TrackingEventType.DEPARTED_ORIGIN,
        status: ShipmentStatus.DEPARTED,
        notes: 'All items departed origin',
      },
      { source: TrackingEventSource.SYSTEM },
    );
  }

  /**
   * Mirrors maybeRollupShipmentDeparture exactly, one stage further:
   * advances a shipment to ARRIVED_DESTINATION only once EVERY one of its
   * items has reached ARRIVED_DESTINATION or later — same partial/split-
   * shipment guard (some items may arrive on an earlier manifest, others
   * on a later one), same "reached at least this stage" checks, same
   * forward-only, never-downgraded posture.
   *
   * Deliberately stops here: this milestone (3F) never advances a
   * shipment past ARRIVED_DESTINATION, regardless of how many of its
   * items go on to be individually RECEIVED_DESTINATION_WAREHOUSE — Ready
   * for Pickup/Delivery is a distinct later milestone with its own
   * reconciliation/condition/hold/business-rule gate, not something this
   * rollup should ever imply.
   */
  private async maybeRollupShipmentArrival(tenantId: string, actorUserId: string, shipmentId: string) {
    const ROLLUP_ELIGIBLE_STATUSES: DbShipmentStatus[] = [DbShipmentStatus.DEPARTED, DbShipmentStatus.IN_TRANSIT];

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
    const allArrived = shipment.items.every((shipmentItem) => ITEM_ARRIVED_OR_LATER.includes(shipmentItem.status));
    if (!allArrived) {
      return;
    }

    await this.shipmentsService.createTrackingEvent(
      tenantId,
      actorUserId,
      shipmentId,
      {
        eventType: TrackingEventType.ARRIVED_DESTINATION,
        status: ShipmentStatus.ARRIVED_DESTINATION,
        notes: 'All items arrived at destination',
      },
      { source: TrackingEventSource.SYSTEM },
    );
  }
}
