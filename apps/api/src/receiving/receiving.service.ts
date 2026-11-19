import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ReceivingRecordStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { ReceivingRecordSummary } from '@transatlantic/shared';
import { generateReceivingReference } from '../common/numbering/numbering.util';
import { writeTenantAuditLog } from '../common/tenant/tenant-audit.util';
import { PrismaService } from '../prisma/prisma.service';
import type { UploadedFile } from '../documents/documents.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateDocumentDto } from '../documents/dto/create-document.dto';
import { CreateReceivingRecordDto } from './dto/create-receiving-record.dto';
import { UpdateReceivingRecordDto } from './dto/update-receiving-record.dto';

const DISPLAY_INCLUDE = {
  customer: { select: { firstName: true, lastName: true } },
  warehouse: { select: { name: true } },
  receivedByUser: { select: { firstName: true, lastName: true } },
} as const;

type ReceivingRecordWithDisplayFields = Prisma.ReceivingRecordGetPayload<{ include: typeof DISPLAY_INCLUDE }>;

/**
 * Non-cancelled statuses a duplicate-tracking-number check (and the
 * awaiting-consolidation list) should consider "live" — CANCELLED records
 * are excluded from both, see ReceivingRecordStatus's own doc comment in
 * schema.prisma.
 */
const LIVE_STATUSES: ReceivingRecordStatus[] = [
  ReceivingRecordStatus.AWAITING_CONSOLIDATION,
  ReceivingRecordStatus.PARTIALLY_CONSOLIDATED,
  ReceivingRecordStatus.FULLY_CONSOLIDATED,
];

/**
 * Warehouse Receiving Phase 1: every method takes tenantId as an explicit
 * first parameter, same per-query tenant-scoping convention every other
 * service in this codebase follows (see CustomersService/ShipmentsService).
 * A ReceivingRecord deliberately never creates a Shipment or a label —
 * see this model's own doc comment in schema.prisma.
 */
@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  async findAll(
    tenantId: string,
    filters: { customerId?: string; status?: ReceivingRecordStatus; awaitingConsolidation?: boolean },
  ): Promise<ReceivingRecordSummary[]> {
    const records = await this.prisma.receivingRecord.findMany({
      where: {
        tenantId,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.awaitingConsolidation
          ? {
              status: {
                in: [ReceivingRecordStatus.AWAITING_CONSOLIDATION, ReceivingRecordStatus.PARTIALLY_CONSOLIDATED],
              },
            }
          : {}),
      },
      include: DISPLAY_INCLUDE,
      orderBy: { receivedAt: 'desc' },
    });
    return records.map((record) => this.toSummary(record));
  }

  /** By customer name, phone, carrier tracking number, or internal reference — see this feature's own spec requirement. */
  async search(tenantId: string, rawQuery: string): Promise<ReceivingRecordSummary[]> {
    const query = rawQuery.trim();
    if (!query) {
      return [];
    }
    const records = await this.prisma.receivingRecord.findMany({
      where: {
        tenantId,
        OR: [
          { internalReference: { contains: query, mode: 'insensitive' } },
          { carrierTrackingNumber: { contains: query, mode: 'insensitive' } },
          { customer: { firstName: { contains: query, mode: 'insensitive' } } },
          { customer: { lastName: { contains: query, mode: 'insensitive' } } },
          { customer: { phone: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: DISPLAY_INCLUDE,
      orderBy: { receivedAt: 'desc' },
      take: 25,
    });
    return records.map((record) => this.toSummary(record));
  }

  async findById(tenantId: string, id: string): Promise<ReceivingRecordSummary> {
    const record = await this.prisma.receivingRecord.findFirst({
      where: { id, tenantId },
      include: DISPLAY_INCLUDE,
    });
    if (!record) {
      throw new NotFoundException('Receiving record not found');
    }
    return this.toSummary(record);
  }

  /**
   * Creates a receiving record with a server-generated, tenant-sequential
   * internalReference. Before inserting, checks this tenant for an
   * existing non-cancelled record sharing the same carrier + tracking
   * number — a hit 409s with the matches unless `dto.allowDuplicate` is
   * set (the caller has looked at the matches and confirmed this is
   * genuinely a different delivery), mirroring
   * CustomersService.create's duplicate-email/phone pattern exactly.
   */
  async create(tenantId: string, actorUserId: string, dto: CreateReceivingRecordDto): Promise<ReceivingRecordSummary> {
    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    let duplicates: { id: string; internalReference: string; receivedAt: Date }[] = [];
    if (dto.carrierTrackingNumber?.trim()) {
      duplicates = await this.prisma.receivingRecord.findMany({
        where: {
          tenantId,
          carrier: dto.carrier,
          carrierTrackingNumber: dto.carrierTrackingNumber.trim(),
          status: { in: LIVE_STATUSES },
        },
        select: { id: true, internalReference: true, receivedAt: true },
      });
      if (duplicates.length > 0 && !dto.allowDuplicate) {
        throw new ConflictException({
          message: 'A receiving record with this carrier and tracking number already exists.',
          duplicates,
        });
      }
    }

    const internalReference = await generateReceivingReference(this.prisma, tenantId);

    const created = await this.prisma.$transaction(async (tx) => {
      const record = await tx.receivingRecord.create({
        data: {
          tenantId,
          customerId: dto.customerId,
          warehouseId: dto.warehouseId,
          carrier: dto.carrier,
          carrierOther: dto.carrier === 'OTHER' ? dto.carrierOther : null,
          carrierTrackingNumber: dto.carrierTrackingNumber?.trim() || null,
          description: dto.description,
          quantity: dto.quantity ?? 1,
          notes: dto.notes,
          internalReference,
          receivedByUserId: actorUserId,
        },
        include: DISPLAY_INCLUDE,
      });

      if (duplicates.length > 0 && dto.allowDuplicate) {
        await writeTenantAuditLog(tx, {
          tenantId,
          actorUserId,
          targetUserId: null,
          action: 'RECEIVING_RECORD_DUPLICATE_OVERRIDDEN',
          metadata: {
            receivingRecordId: record.id,
            internalReference: record.internalReference,
            duplicateOverrideReason: dto.duplicateOverrideReason,
            matchedRecordIds: duplicates.map((d) => d.id),
          },
        });
      }

      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'RECEIVING_RECORD_CREATED',
        metadata: {
          receivingRecordId: record.id,
          internalReference: record.internalReference,
          customerId: record.customerId,
          carrier: record.carrier,
          carrierTrackingNumber: record.carrierTrackingNumber,
        },
      });

      return record;
    });

    return this.toSummary(created);
  }

  /** The "correction" path — available to any role that may create a receiving record (STAFF included), always audited. */
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateReceivingRecordDto,
  ): Promise<ReceivingRecordSummary> {
    const existing = await this.prisma.receivingRecord.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException('Receiving record not found');
    }
    if (existing.status === ReceivingRecordStatus.CANCELLED) {
      throw new BadRequestException('A cancelled receiving record cannot be corrected.');
    }
    if (dto.quantity !== undefined && dto.quantity < existing.allocatedQuantity) {
      throw new ConflictException(
        `Quantity cannot be reduced below ${existing.allocatedQuantity}, which is already consolidated into shipping boxes.`,
      );
    }

    const fields = Object.keys(dto) as (keyof UpdateReceivingRecordDto)[];
    const before = Object.fromEntries(fields.map((f) => [f, existing[f as keyof typeof existing]]));

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.receivingRecord.update({
        where: { id },
        data: {
          ...(dto.carrier !== undefined ? { carrier: dto.carrier } : {}),
          ...(dto.carrier !== undefined ? { carrierOther: dto.carrier === 'OTHER' ? dto.carrierOther : null } : {}),
          ...(dto.carrierTrackingNumber !== undefined
            ? { carrierTrackingNumber: dto.carrierTrackingNumber?.trim() || null }
            : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
        include: DISPLAY_INCLUDE,
      });

      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'RECEIVING_RECORD_CORRECTED',
        metadata: { receivingRecordId: id, before, after: Object.fromEntries(fields.map((f) => [f, dto[f]])), fields },
      });

      return record;
    });

    return this.toSummary(updated);
  }

  async cancel(tenantId: string, actorUserId: string, id: string, reason?: string): Promise<ReceivingRecordSummary> {
    const existing = await this.prisma.receivingRecord.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException('Receiving record not found');
    }
    if (existing.allocatedQuantity > 0) {
      throw new ConflictException(
        'This receiving record has already been (partly) consolidated into a shipping box and cannot be cancelled.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.receivingRecord.update({
        where: { id },
        data: { status: ReceivingRecordStatus.CANCELLED },
        include: DISPLAY_INCLUDE,
      });
      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'RECEIVING_RECORD_CANCELLED',
        metadata: { receivingRecordId: id, reason: reason ?? null },
      });
      return record;
    });

    return this.toSummary(updated);
  }

  async uploadPhoto(
    tenantId: string,
    actorUserId: string,
    id: string,
    file: UploadedFile,
    dto: CreateDocumentDto,
  ) {
    const record = await this.prisma.receivingRecord.findFirst({ where: { id, tenantId } });
    if (!record) {
      throw new NotFoundException('Receiving record not found');
    }
    return this.documentsService.uploadForReceivingRecord(tenantId, actorUserId, id, file, dto);
  }

  private toSummary(record: ReceivingRecordWithDisplayFields): ReceivingRecordSummary {
    return {
      id: record.id,
      tenantId: record.tenantId,
      customerId: record.customerId,
      customerName: record.customer ? `${record.customer.firstName} ${record.customer.lastName}` : null,
      warehouseId: record.warehouseId,
      warehouseName: record.warehouse?.name ?? null,
      status: record.status as unknown as ReceivingRecordSummary['status'],
      carrier: record.carrier as unknown as ReceivingRecordSummary['carrier'],
      carrierOther: record.carrierOther,
      carrierTrackingNumber: record.carrierTrackingNumber,
      description: record.description,
      quantity: record.quantity,
      allocatedQuantity: record.allocatedQuantity,
      receivedAt: record.receivedAt.toISOString(),
      receivedByUserId: record.receivedByUserId,
      receivedByName: record.receivedByUser
        ? `${record.receivedByUser.firstName} ${record.receivedByUser.lastName}`
        : null,
      notes: record.notes,
      internalReference: record.internalReference,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
