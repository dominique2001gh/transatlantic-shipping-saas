import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatItemCode, ShipmentItemType, UserRole } from '@transatlantic/shared';
import type { Prisma } from '@prisma/client';
import {
  InvoiceStatus,
  PreRegistrationStatus,
  ShipmentItemStatus,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
} from '@prisma/client';
import { generateTrackingNumber } from '../common/numbering/numbering.util';
import { writeTenantAuditLog } from '../common/tenant/tenant-audit.util';
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

/**
 * Shipment Editing Phase 4: which UpdateShipmentDto/UpdateShipmentItemDto
 * fields a PATCH may touch, keyed by the shipment's current lifecycle
 * status — see resolveEditTier's own doc comment for the full tier table.
 * Field-set membership only; `declaredValue` is additionally blocked at
 * every tier once a non-DRAFT Invoice exists (checked separately in
 * update/updateItem, since that's a cross-cutting rule, not a per-tier one).
 */
const BROAD_SHIPMENT_FIELDS = [
  'originLocation',
  'destinationCountry',
  'destinationLocation',
  'originWarehouseId',
  'destinationWarehouseId',
  'routeId',
  'description',
  'declaredValue',
  'currency',
  'recipientName',
  'recipientPhone',
  'recipientEmail',
  'recipientAddressLine1',
  'recipientAddressLine2',
  'recipientCity',
  'recipientState',
  'recipientCountry',
  'recipientPostalCode',
] as const;
const NARROW_SHIPMENT_FIELDS = ['description', 'declaredValue', 'currency'] as const;
const MINIMAL_SHIPMENT_FIELDS = ['description'] as const;
/** Fields whose change is visible on a printed label — see ItemLabel.tsx. */
const LABEL_AFFECTING_SHIPMENT_FIELDS = ['recipientName', 'recipientPhone', 'destinationCountry', 'destinationLocation'] as const;

const BROAD_ITEM_FIELDS = [
  'itemType',
  'description',
  'quantity',
  'length',
  'width',
  'height',
  'dimensionUnit',
  'weight',
  'weightUnit',
  'declaredValue',
  'condition',
  'externalTrackingCarrier',
  'externalTrackingNumber',
] as const;
const MINIMAL_ITEM_FIELDS = ['description'] as const;
/** Fields whose change is visible on a printed label — see ItemLabel.tsx. */
const LABEL_AFFECTING_ITEM_FIELDS = ['itemType', 'description'] as const;

const BROAD_SHIPMENT_FIELD_SET = new Set<string>(BROAD_SHIPMENT_FIELDS);
const NARROW_SHIPMENT_FIELD_SET = new Set<string>(NARROW_SHIPMENT_FIELDS);
const MINIMAL_SHIPMENT_FIELD_SET = new Set<string>(MINIMAL_SHIPMENT_FIELDS);
const BROAD_ITEM_FIELD_SET = new Set<string>(BROAD_ITEM_FIELDS);
const MINIMAL_ITEM_FIELD_SET = new Set<string>(MINIMAL_ITEM_FIELDS);
const EMPTY_FIELD_SET = new Set<string>();

/** OWNER or MANAGER — the "elevated permission" tier from LOADED onward. STAFF is excluded here only; every earlier tier remains open to STAFF, matching its pre-existing access. */
function isOwnerOrManager(role: UserRole): boolean {
  return role === UserRole.OWNER || role === UserRole.MANAGER;
}

interface ShipmentEditTier {
  allowedShipmentFields: ReadonlySet<string>;
  allowedItemFields: ReadonlySet<string>;
  /**
   * LOADED and every stage beyond it — "elevated permission" per this
   * feature's own spec requirement. OWNER or MANAGER only; STAFF retains
   * its pre-existing ability to edit a shipment at every earlier tier
   * (DRAFT through BOOKED) — this is the one tier where STAFF's
   * historical unrestricted-edit behavior is deliberately not preserved,
   * by explicit product decision, since nothing in this system ever
   * guaranteed STAFF access to a specific lifecycle stage by name and a
   * shipment that's already loaded into a sealed container is exactly
   * the point past which broader staff access stops being appropriate.
   */
  requiresManagerUp: boolean;
  /** DELIVERED/COMPLETED — a documented correction, per this feature's own spec requirement. Applies to every role equally, including STAFF. */
  requiresReason: boolean;
  /** BOOKED only — a label has already been printed from this data. Applies to every role equally, including STAFF. */
  isLabelLockedTier: boolean;
}

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
   *
   * Customer Self-Service Pre-Registration, Stage 3: an optional
   * `dto.preRegistrationId` links this transaction to a customer-submitted
   * ShipmentPreRegistration (see that model's own schema doc comment). This
   * never blindly trusts the pre-registration's data — the frontend only
   * uses it to prefill the same fields below, which staff can freely
   * correct before submitting, exactly like every other Quick Receive
   * field. The PRE-* reference is a temporary arrival reference only; the
   * `trackingNumber` generated below is what becomes authoritative.
   */
  async createQuickReceive(tenantId: string, actorUserId: string, dto: QuickReceiveDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Customer Self-Service Pre-Registration, Stage 3: validate up front so
    // an invalid/ineligible reference fails fast with a clear message
    // before any writes. Re-checked atomically inside the transaction below
    // (see the conditional updateMany there) so two concurrent Quick
    // Receive submissions against the same pre-registration can never both
    // succeed — the loser's whole transaction (shipment included) rolls
    // back rather than leaving an orphan shipment behind.
    let preRegistration: { id: string; status: PreRegistrationStatus } | null = null;
    if (dto.preRegistrationId) {
      preRegistration = await this.prisma.shipmentPreRegistration.findFirst({
        where: { id: dto.preRegistrationId, tenantId },
        select: { id: true, status: true },
      });
      if (!preRegistration) {
        throw new NotFoundException('Pre-registration not found');
      }
      if (preRegistration.status !== PreRegistrationStatus.SUBMITTED) {
        throw new ConflictException(
          `This pre-registration is ${preRegistration.status} and cannot be received. Only a SUBMITTED drop-off can be converted.`,
        );
      }
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
      // Same "never accepted as a destination unless actually flagged one"
      // rule WarehouseService.resolveEligibleDestinationWarehouseId
      // enforces at pickup/dispatch time — enforced here too so a bad
      // value (e.g. an origin-only warehouse, the only one that existed
      // for the tenant yet) can never even be recorded on the shipment in
      // the first place, not just rejected later at handoff.
      const destinationWarehouse = await this.prisma.warehouse.findFirst({
        where: { id: dto.destinationWarehouseId, tenantId, isActive: true, isDestinationWarehouse: true },
      });
      if (!destinationWarehouse) {
        throw new NotFoundException(
          'Destination warehouse not found. It must be an active warehouse flagged as a destination warehouse for this organization.',
        );
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

      if (preRegistration) {
        // Conditional (compare-and-swap) update, not a plain write: this is
        // the actual duplicate-conversion guard, atomic with the shipment
        // creation above. `count !== 1` means something else already
        // converted or cancelled this pre-registration between the
        // pre-check above and here — throwing here rolls back the entire
        // transaction, so no orphan shipment is left behind for the loser.
        const conversion = await tx.shipmentPreRegistration.updateMany({
          where: { id: preRegistration.id, tenantId, status: PreRegistrationStatus.SUBMITTED },
          data: {
            status: PreRegistrationStatus.CONVERTED,
            convertedShipmentId: shipment.id,
            convertedAt: receivedAt,
          },
        });
        if (conversion.count !== 1) {
          throw new ConflictException('This pre-registration was already converted.');
        }
      }

      return shipment.id;
    });

    // Stage 3H convention (see createTrackingEvent below): fired after the
    // transaction commits, never inside it — a notification-pipeline
    // failure must never roll back a shipment that has otherwise already
    // been successfully created and received.
    await this.notificationsService.fireShipmentStatusChanged(tenantId, shipmentId, ShipmentStatus.WAREHOUSE_RECEIVED);

    return this.findById(tenantId, shipmentId);
  }

  /**
   * Shipment Editing Phase 4: which fields a PATCH may touch, and under
   * what extra conditions, depends on the shipment's current lifecycle
   * status. The route itself stays OPERATIONS_ROLES + shipments.manage —
   * the same gate STAFF already had before this feature existed — so
   * STAFF is never blocked from calling this endpoint at all; what varies
   * by tier is which fields are editable and, for LOADED-and-later, which
   * roles may act:
   *   - DRAFT/AWAITING_ITEMS and every stage through CONSOLIDATED: broad
   *     edit, available to OWNER/MANAGER/STAFF alike, no extra
   *     confirmation (WAREHOUSE_RECEIVED onward is still a "correction"
   *     in spirit — the audit log records it the same way regardless,
   *     see `lifecycleTier` in its metadata).
   *   - BOOKED: same broad field set and same OWNER/MANAGER/STAFF access,
   *     but a label has already been printed from this data — a change
   *     to any LABEL_AFFECTING field requires the caller to resubmit with
   *     `confirmLabelRegeneration: true`, which is the "clear
   *     confirmation before changes that affect labels" this feature's
   *     own spec requires, for every role equally.
   *   - LOADED: narrows to description/declaredValue/currency only, and
   *     requires the actor's role to be OWNER or MANAGER — "elevated
   *     permission" per spec. This is the one tier where STAFF's
   *     historical unrestricted access is deliberately not preserved —
   *     see ShipmentEditTier.requiresManagerUp's own doc comment.
   *     Enforced here rather than via a second static
   *     @RequirePermission (which can't vary by a resource's own current
   *     state, only by route).
   *   - DEPARTED through OUT_FOR_DELIVERY: OWNER/MANAGER only,
   *     description only — weight/dims/qty/declaredValue are locked
   *     because a Manifest snapshot has already been taken from this
   *     shipment's data.
   *   - DELIVERED/COMPLETED: OWNER/MANAGER only, description only, and a
   *     non-empty `reason` is required — "documented corrections" per
   *     spec, for every role equally.
   *   - CANCELLED (and any future status not enumerated here): no edits
   *     at all, by omission from the switch below.
   */
  private resolveEditTier(status: ShipmentStatus): ShipmentEditTier {
    switch (status) {
      case ShipmentStatus.DRAFT:
      case ShipmentStatus.QUOTE_REQUESTED:
      case ShipmentStatus.AWAITING_ITEMS:
      case ShipmentStatus.WAREHOUSE_RECEIVED:
      case ShipmentStatus.PROCESSING:
      case ShipmentStatus.READY_FOR_CONSOLIDATION:
      case ShipmentStatus.CONSOLIDATED:
        return {
          allowedShipmentFields: BROAD_SHIPMENT_FIELD_SET,
          allowedItemFields: BROAD_ITEM_FIELD_SET,
          requiresManagerUp: false,
          requiresReason: false,
          isLabelLockedTier: false,
        };
      case ShipmentStatus.BOOKED:
        return {
          allowedShipmentFields: BROAD_SHIPMENT_FIELD_SET,
          allowedItemFields: BROAD_ITEM_FIELD_SET,
          requiresManagerUp: false,
          requiresReason: false,
          isLabelLockedTier: true,
        };
      case ShipmentStatus.LOADED:
        return {
          allowedShipmentFields: NARROW_SHIPMENT_FIELD_SET,
          allowedItemFields: MINIMAL_ITEM_FIELD_SET,
          requiresManagerUp: true,
          requiresReason: false,
          isLabelLockedTier: false,
        };
      case ShipmentStatus.DEPARTED:
      case ShipmentStatus.IN_TRANSIT:
      case ShipmentStatus.ARRIVED_DESTINATION:
      case ShipmentStatus.CUSTOMS_PROCESSING:
      case ShipmentStatus.CUSTOMS_CLEARED:
      case ShipmentStatus.READY_FOR_PICKUP:
      case ShipmentStatus.OUT_FOR_DELIVERY:
        return {
          allowedShipmentFields: MINIMAL_SHIPMENT_FIELD_SET,
          allowedItemFields: MINIMAL_ITEM_FIELD_SET,
          requiresManagerUp: true,
          requiresReason: false,
          isLabelLockedTier: false,
        };
      case ShipmentStatus.DELIVERED:
      case ShipmentStatus.COMPLETED:
        return {
          allowedShipmentFields: MINIMAL_SHIPMENT_FIELD_SET,
          allowedItemFields: MINIMAL_ITEM_FIELD_SET,
          requiresManagerUp: true,
          requiresReason: true,
          isLabelLockedTier: false,
        };
      default:
        return {
          allowedShipmentFields: EMPTY_FIELD_SET,
          allowedItemFields: EMPTY_FIELD_SET,
          requiresManagerUp: true,
          requiresReason: false,
          isLabelLockedTier: false,
        };
    }
  }

  /** Blocks a declaredValue change once this shipment has a non-DRAFT invoice — never silently desyncs an amount already billed. */
  private async assertDeclaredValueEditable(tenantId: string, shipmentId: string): Promise<void> {
    const billedCount = await this.prisma.invoice.count({
      where: { tenantId, shipmentId, status: { not: InvoiceStatus.DRAFT } },
    });
    if (billedCount > 0) {
      throw new ConflictException('declaredValue cannot be changed once a non-draft invoice exists for this shipment.');
    }
  }

  async update(tenantId: string, actorUserId: string, actorRole: UserRole, id: string, dto: UpdateShipmentDto) {
    const shipment = await this.prisma.shipment.findFirst({ where: { id, tenantId } });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    const { confirmLabelRegeneration, reason, ...patch } = dto;
    const fields = Object.keys(patch) as (keyof typeof patch)[];
    if (fields.length === 0) {
      return this.findById(tenantId, id);
    }

    const tier = this.resolveEditTier(shipment.status);
    if (tier.requiresManagerUp && !isOwnerOrManager(actorRole)) {
      throw new ForbiddenException(`Only an OWNER or MANAGER may edit a shipment in ${shipment.status} status.`);
    }
    const disallowed = fields.filter((field) => !tier.allowedShipmentFields.has(field));
    if (disallowed.length > 0) {
      throw new BadRequestException(
        `These fields cannot be edited while this shipment is ${shipment.status}: ${disallowed.join(', ')}`,
      );
    }
    if (tier.requiresReason && !reason?.trim()) {
      throw new BadRequestException('A reason is required to edit a shipment in this status.');
    }
    if (patch.declaredValue !== undefined) {
      await this.assertDeclaredValueEditable(tenantId, id);
    }
    if (tier.isLabelLockedTier && !confirmLabelRegeneration) {
      const shipmentRecord = shipment as unknown as Record<string, unknown>;
      const labelFieldsChanged = LABEL_AFFECTING_SHIPMENT_FIELDS.some(
        (field) => (patch as Record<string, unknown>)[field] !== undefined && (patch as Record<string, unknown>)[field] !== shipmentRecord[field],
      );
      if (labelFieldsChanged) {
        throw new ConflictException(
          'This change affects the printed label. Re-submit with confirmLabelRegeneration: true to proceed.',
        );
      }
    }

    const shipmentRecord = shipment as unknown as Record<string, unknown>;
    const before = Object.fromEntries(fields.map((field) => [field, shipmentRecord[field]]));

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.shipment.update({ where: { id }, data: patch });
      const resultRecord = result as unknown as Record<string, unknown>;
      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'SHIPMENT_UPDATED',
        metadata: {
          shipmentId: id,
          before,
          after: Object.fromEntries(fields.map((field) => [field, resultRecord[field]])),
          fields,
          lifecycleTier: shipment.status,
          reason: reason ?? null,
        } as Prisma.InputJsonValue,
      });
      return result;
    });

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

  /** Item-level counterpart of update() — gated by the PARENT shipment's lifecycle tier (an item has no status tier of its own for editing purposes). See resolveEditTier's own doc comment. */
  async updateItem(
    tenantId: string,
    actorUserId: string,
    actorRole: UserRole,
    shipmentId: string,
    itemId: string,
    dto: UpdateShipmentItemDto,
  ) {
    const item = await this.prisma.shipmentItem.findFirst({
      where: { id: itemId, shipmentId, tenantId },
    });
    if (!item) {
      throw new NotFoundException('Shipment item not found');
    }
    const shipment = await this.prisma.shipment.findFirst({ where: { id: shipmentId, tenantId } });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    const { confirmLabelRegeneration, reason, ...patch } = dto;
    const fields = Object.keys(patch) as (keyof typeof patch)[];
    if (fields.length === 0) {
      return this.findById(tenantId, shipmentId);
    }

    const tier = this.resolveEditTier(shipment.status);
    if (tier.requiresManagerUp && !isOwnerOrManager(actorRole)) {
      throw new ForbiddenException(`Only an OWNER or MANAGER may edit a shipment item while its shipment is ${shipment.status}.`);
    }
    const disallowed = fields.filter((field) => !tier.allowedItemFields.has(field));
    if (disallowed.length > 0) {
      throw new BadRequestException(
        `These fields cannot be edited while this shipment is ${shipment.status}: ${disallowed.join(', ')}`,
      );
    }
    if (tier.requiresReason && !reason?.trim()) {
      throw new BadRequestException('A reason is required to edit a shipment item in this status.');
    }
    if (patch.declaredValue !== undefined) {
      await this.assertDeclaredValueEditable(tenantId, shipmentId);
    }
    if (tier.isLabelLockedTier && !confirmLabelRegeneration) {
      const itemRecord = item as unknown as Record<string, unknown>;
      const labelFieldsChanged = LABEL_AFFECTING_ITEM_FIELDS.some(
        (field) => (patch as Record<string, unknown>)[field] !== undefined && (patch as Record<string, unknown>)[field] !== itemRecord[field],
      );
      if (labelFieldsChanged) {
        throw new ConflictException(
          'This change affects the printed label. Re-submit with confirmLabelRegeneration: true to proceed.',
        );
      }
    }

    const itemRecord = item as unknown as Record<string, unknown>;
    const before = Object.fromEntries(fields.map((field) => [field, itemRecord[field]]));

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.shipmentItem.update({ where: { id: itemId }, data: patch });
      const resultRecord = result as unknown as Record<string, unknown>;
      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'SHIPMENT_UPDATED',
        metadata: {
          shipmentId,
          shipmentItemId: itemId,
          before,
          after: Object.fromEntries(fields.map((field) => [field, resultRecord[field]])),
          fields,
          lifecycleTier: shipment.status,
          reason: reason ?? null,
        } as Prisma.InputJsonValue,
      });
      return result;
    });

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
