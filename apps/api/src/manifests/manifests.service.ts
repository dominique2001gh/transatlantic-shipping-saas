import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ContainerStatus as DbContainerStatus,
  ManifestStatus as DbManifestStatus,
  ShipmentItemStatus as DbShipmentItemStatus,
  ShipmentMode as DbShipmentMode,
  ShipmentStatus as DbShipmentStatus,
  TrackingEventSource,
} from '@prisma/client';
import { ShipmentItemStatus, TrackingEventType } from '@transatlantic/shared';
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

    return this.findById(tenantId, manifest.id);
  }
}
