import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ReceivingRecordStatus,
  ShipmentItemStatus,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
} from '@prisma/client';
import { formatItemCode } from '@transatlantic/shared';
import { generateTrackingNumber } from '../common/numbering/numbering.util';
import { writeTenantAuditLog } from '../common/tenant/tenant-audit.util';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { ConsolidateDto } from './dto/consolidate.dto';

/**
 * Package Consolidation Phase 2: combines one or more already-received
 * ReceivingRecords into one or more final shipping boxes (ShipmentItems),
 * producing exactly one new Shipment. Deliberately does NOT reuse
 * ShipmentsService.create/createItemWithinTransaction — those model a
 * fresh item that starts REGISTERED (not yet physically received), which
 * is the wrong starting state here: a consolidated box's contents are, by
 * construction, already physically at the warehouse (they came from one
 * or more ReceivingRecords). Instead this mirrors
 * ShipmentsService.createQuickReceive's own inline transaction style
 * (same codebase precedent for "every item here starts already received,
 * written directly rather than via a second call to the general
 * receiving code path") — see that method's own doc comment for the
 * identical reasoning.
 */
@Injectable()
export class ConsolidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentsService: ShipmentsService,
  ) {}

  async consolidate(tenantId: string, actorUserId: string, dto: ConsolidateDto) {
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    const originWarehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.originWarehouseId, tenantId },
    });
    if (!originWarehouse) {
      throw new NotFoundException('Warehouse not found');
    }
    let destinationWarehouseId: string | undefined;
    if (dto.destinationWarehouseId) {
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

    // Requested quantity per receivingRecordId, summed across every box in
    // this one request — a single request may draw on the same record
    // from more than one box.
    const requestedByRecord = new Map<string, number>();
    for (const box of dto.boxes) {
      for (const allocation of box.allocations) {
        requestedByRecord.set(
          allocation.receivingRecordId,
          (requestedByRecord.get(allocation.receivingRecordId) ?? 0) + allocation.quantity,
        );
      }
    }

    // Sequence generation is its own atomic step, deliberately outside the
    // transaction below — same convention as every other caller of this
    // generator (see numbering.util.ts): a crash between the two only ever
    // leaves a harmless sequence gap, never a duplicate tracking number.
    const trackingNumber = await generateTrackingNumber(this.prisma, tenantId);
    const consolidatedAt = new Date();

    const shipmentId = await this.prisma.$transaction(async (tx) => {
      // Read every referenced record fresh, inside this transaction — the
      // actual concurrency guard is the conditional updateMany further
      // down (same optimistic-concurrency/compare-and-swap pattern
      // ShipmentPreRegistration's own conversion guard uses), not this
      // read by itself: a plain SELECT under Postgres's default
      // READ COMMITTED isolation does not block a concurrent transaction,
      // so this read only produces the pre-check error message / the
      // values the updateMany's WHERE clause is compared against.
      const records = await tx.receivingRecord.findMany({
        where: { id: { in: [...requestedByRecord.keys()] }, tenantId },
      });
      const recordsById = new Map(records.map((r) => [r.id, r]));
      for (const [receivingRecordId, requested] of requestedByRecord) {
        const record = recordsById.get(receivingRecordId);
        if (!record) {
          throw new NotFoundException(`Receiving record ${receivingRecordId} not found`);
        }
        if (record.customerId !== dto.customerId) {
          throw new ConflictException(`Receiving record ${record.internalReference} does not belong to this customer.`);
        }
        if (record.status === ReceivingRecordStatus.CANCELLED) {
          throw new ConflictException(`Receiving record ${record.internalReference} has been cancelled.`);
        }
        const remaining = record.quantity - record.allocatedQuantity;
        if (requested > remaining) {
          throw new ConflictException(
            `Receiving record ${record.internalReference} has only ${remaining} unit(s) remaining, but ${requested} were requested.`,
          );
        }
      }

      const shipment = await tx.shipment.create({
        data: {
          tenantId,
          customerId: dto.customerId,
          trackingNumber,
          shipmentMode: dto.shipmentMode,
          originCountry: originWarehouse.country,
          destinationCountry: dto.destinationCountry,
          originLocation: originWarehouse.state ? `${originWarehouse.city}, ${originWarehouse.state}` : originWarehouse.city,
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
          occurredAt: consolidatedAt,
          createdByUserId: actorUserId,
        },
      });

      let sequenceNumber = 0;
      for (const box of dto.boxes) {
        sequenceNumber += 1;
        const item = await tx.shipmentItem.create({
          data: {
            tenantId,
            shipmentId: shipment.id,
            itemCode: formatItemCode(trackingNumber, sequenceNumber),
            sequenceNumber,
            itemType: box.itemType,
            description: box.description,
            quantity: box.quantity ?? 1,
            length: box.length,
            width: box.width,
            height: box.height,
            dimensionUnit: box.dimensionUnit,
            weight: box.weight,
            weightUnit: box.weightUnit,
            declaredValue: box.declaredValue,
            // Already physically received — see this class's own doc comment above.
            status: ShipmentItemStatus.RECEIVED_ORIGIN_WAREHOUSE,
            receivedAt: consolidatedAt,
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
            occurredAt: consolidatedAt,
            createdByUserId: actorUserId,
          },
        });
        await tx.trackingEvent.create({
          data: {
            tenantId,
            shipmentId: shipment.id,
            shipmentItemId: item.id,
            eventType: TrackingEventType.CONSOLIDATED,
            source: TrackingEventSource.MANUAL,
            warehouseId: dto.originWarehouseId,
            occurredAt: consolidatedAt,
            createdByUserId: actorUserId,
          },
        });

        for (const allocation of box.allocations) {
          await tx.consolidationAllocation.create({
            data: {
              tenantId,
              receivingRecordId: allocation.receivingRecordId,
              shipmentItemId: item.id,
              allocatedQuantity: allocation.quantity,
              createdByUserId: actorUserId,
            },
          });
        }
      }

      for (const [receivingRecordId, requested] of requestedByRecord) {
        // Guaranteed present — the loop above already threw NotFoundException for any missing id.
        const record = recordsById.get(receivingRecordId)!;
        const newAllocatedQuantity = record.allocatedQuantity + requested;

        // The actual concurrency guard: this UPDATE only matches (and
        // therefore only applies) if allocatedQuantity is still exactly
        // what this transaction read above. If a concurrent consolidate()
        // call against the same record committed in between, this WHERE
        // clause no longer matches, `count` comes back 0, and this whole
        // transaction rolls back — the loser retries against the now-
        // current remaining quantity rather than silently over-allocating.
        const guarded = await tx.receivingRecord.updateMany({
          where: { id: receivingRecordId, tenantId, allocatedQuantity: record.allocatedQuantity },
          data: {
            allocatedQuantity: newAllocatedQuantity,
            status:
              newAllocatedQuantity >= record.quantity
                ? ReceivingRecordStatus.FULLY_CONSOLIDATED
                : ReceivingRecordStatus.PARTIALLY_CONSOLIDATED,
          },
        });
        if (guarded.count !== 1) {
          throw new ConflictException(
            `Receiving record ${record.internalReference} was updated by another consolidation at the same time. Please retry.`,
          );
        }
      }

      // Shipment-level rollup — every item created above is already
      // received and packed, so the shipment goes straight to CONSOLIDATED
      // in this same transaction, mirroring createQuickReceive's identical
      // unconditional rollup to WAREHOUSE_RECEIVED.
      await tx.trackingEvent.create({
        data: {
          tenantId,
          shipmentId: shipment.id,
          eventType: TrackingEventType.CONSOLIDATED,
          source: TrackingEventSource.SYSTEM,
          status: ShipmentStatus.CONSOLIDATED,
          notes: 'Created from Package Consolidation',
          occurredAt: consolidatedAt,
          createdByUserId: actorUserId,
        },
      });
      await tx.shipment.update({ where: { id: shipment.id }, data: { status: ShipmentStatus.CONSOLIDATED } });

      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'CONSOLIDATION_CREATED',
        metadata: {
          shipmentId: shipment.id,
          trackingNumber,
          receivingRecordIds: [...requestedByRecord.keys()],
          boxCount: dto.boxes.length,
        },
      });

      return shipment.id;
    });

    return this.shipmentsService.findById(tenantId, shipmentId);
  }
}
