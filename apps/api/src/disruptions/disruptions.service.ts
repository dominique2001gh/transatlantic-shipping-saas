import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AffectedCustomerPreviewItem, DisruptionPreviewResponse, OperationalExceptionSummary } from '@transatlantic/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisruptionDto } from './dto/create-disruption.dto';

interface AffectedCustomerAccumulator {
  customerId: string;
  customerName: string;
  shipmentTrackingNumbers: Set<string>;
  notifyByEmail: boolean;
  notifyBySms: boolean;
  notifyByWhatsapp: boolean;
}

const SHIPMENT_CUSTOMER_INCLUDE = {
  shipment: {
    select: {
      trackingNumber: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          notifyByEmail: true,
          notifyBySms: true,
          notifyByWhatsapp: true,
        },
      },
    },
  },
} as const;

/**
 * Stage 3H: staff-composed bulk container/manifest disruption messaging —
 * "delayed / held / inspected / impounded / other", a human-written
 * customer-safe explanation, previewed and confirmed before any
 * notification goes out. Resolves affected customers by walking the real
 * loading data (ContainerItem/ManifestItem, both already scoped to
 * `removedAt: null` — a soft-removed item is not currently in this
 * container/manifest and its customer is not affected), never a
 * customer-supplied list — staff pick a container/manifest, not
 * individual recipients, so there is no way to target a customer whose
 * shipment isn't actually on it.
 */
@Injectable()
export class DisruptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async preview(tenantId: string, params: { containerId?: string; manifestId?: string }): Promise<DisruptionPreviewResponse> {
    const accumulator = await this.resolveAffectedCustomers(tenantId, params);
    return { affectedCustomers: this.toPreviewItems(accumulator) };
  }

  async create(tenantId: string, actorUserId: string, dto: CreateDisruptionDto): Promise<OperationalExceptionSummary> {
    if (!dto.containerId && !dto.manifestId) {
      throw new BadRequestException('Select a container or a manifest.');
    }
    if (dto.containerId && dto.manifestId) {
      throw new BadRequestException('Select only one of container or manifest, not both.');
    }

    if (dto.containerId) {
      const container = await this.prisma.container.findFirst({ where: { id: dto.containerId, tenantId } });
      if (!container) throw new NotFoundException('Container not found');
    }
    if (dto.manifestId) {
      const manifest = await this.prisma.manifest.findFirst({ where: { id: dto.manifestId, tenantId } });
      if (!manifest) throw new NotFoundException('Manifest not found');
    }

    const accumulator = await this.resolveAffectedCustomers(tenantId, {
      containerId: dto.containerId,
      manifestId: dto.manifestId,
    });

    const exception = await this.prisma.operationalException.create({
      data: {
        tenantId,
        containerId: dto.containerId,
        manifestId: dto.manifestId,
        type: dto.type,
        message: dto.message,
        createdByUserId: actorUserId,
      },
      include: {
        container: { select: { containerNumber: true } },
        manifest: { select: { manifestNumber: true } },
        createdByUser: { select: { firstName: true, lastName: true } },
      },
    });

    const affectedCustomerIds = Array.from(accumulator.values()).map((c) => c.customerId);
    const label = exception.container
      ? `Container ${exception.container.containerNumber}`
      : `Manifest ${exception.manifest?.manifestNumber}`;

    const { notifiedCount } = await this.notificationsService.fireContainerDisruption({
      tenantId,
      operationalExceptionId: exception.id,
      affectedCustomerIds,
      internalTitle: `${label} — ${dto.type}`,
      customerMessage: dto.message,
      triggeredByUserId: actorUserId,
    });

    return this.toSummary(exception, notifiedCount);
  }

  async findAll(tenantId: string): Promise<OperationalExceptionSummary[]> {
    const exceptions = await this.prisma.operationalException.findMany({
      where: { tenantId },
      include: {
        container: { select: { containerNumber: true } },
        manifest: { select: { manifestNumber: true } },
        createdByUser: { select: { firstName: true, lastName: true } },
        notificationEvents: { select: { notifications: { select: { customerId: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return exceptions.map((exception) => {
      const notifiedCustomerIds = new Set(
        exception.notificationEvents.flatMap((event) => event.notifications.map((n) => n.customerId)).filter(Boolean),
      );
      return this.toSummary(exception, notifiedCustomerIds.size);
    });
  }

  async resolve(tenantId: string, id: string): Promise<OperationalExceptionSummary> {
    const existing = await this.prisma.operationalException.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Disruption not found');
    const updated = await this.prisma.operationalException.update({
      where: { id },
      data: { resolvedAt: existing.resolvedAt ?? new Date() },
      include: {
        container: { select: { containerNumber: true } },
        manifest: { select: { manifestNumber: true } },
        createdByUser: { select: { firstName: true, lastName: true } },
        notificationEvents: { select: { notifications: { select: { customerId: true } } } },
      },
    });
    const notifiedCustomerIds = new Set(
      updated.notificationEvents.flatMap((event) => event.notifications.map((n) => n.customerId)).filter(Boolean),
    );
    return this.toSummary(updated, notifiedCustomerIds.size);
  }

  private async resolveAffectedCustomers(
    tenantId: string,
    params: { containerId?: string; manifestId?: string },
  ): Promise<Map<string, AffectedCustomerAccumulator>> {
    const accumulator = new Map<string, AffectedCustomerAccumulator>();

    const addRows = (
      rows: { shipment: { trackingNumber: string; customer: { id: string; firstName: string; lastName: string; notifyByEmail: boolean; notifyBySms: boolean; notifyByWhatsapp: boolean } } }[],
    ) => {
      for (const row of rows) {
        const { customer } = row.shipment;
        const existing = accumulator.get(customer.id);
        if (existing) {
          existing.shipmentTrackingNumbers.add(row.shipment.trackingNumber);
          continue;
        }
        accumulator.set(customer.id, {
          customerId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`,
          shipmentTrackingNumbers: new Set([row.shipment.trackingNumber]),
          notifyByEmail: customer.notifyByEmail,
          notifyBySms: customer.notifyBySms,
          notifyByWhatsapp: customer.notifyByWhatsapp,
        });
      }
    };

    if (params.containerId) {
      const containerItems = await this.prisma.containerItem.findMany({
        where: { containerId: params.containerId, tenantId, removedAt: null },
        include: SHIPMENT_CUSTOMER_INCLUDE,
      });
      addRows(containerItems);
    }

    if (params.manifestId) {
      const containers = await this.prisma.container.findMany({
        where: { manifestId: params.manifestId, tenantId },
        select: { id: true },
      });
      if (containers.length > 0) {
        const containerItems = await this.prisma.containerItem.findMany({
          where: { containerId: { in: containers.map((c) => c.id) }, tenantId, removedAt: null },
          include: SHIPMENT_CUSTOMER_INCLUDE,
        });
        addRows(containerItems);
      }

      const manifestItems = await this.prisma.manifestItem.findMany({
        where: { manifestId: params.manifestId, tenantId, removedAt: null },
        include: SHIPMENT_CUSTOMER_INCLUDE,
      });
      addRows(manifestItems);
    }

    return accumulator;
  }

  private toPreviewItems(accumulator: Map<string, AffectedCustomerAccumulator>): AffectedCustomerPreviewItem[] {
    return Array.from(accumulator.values()).map((c) => ({
      customerId: c.customerId,
      customerName: c.customerName,
      shipmentTrackingNumbers: Array.from(c.shipmentTrackingNumbers),
      willNotifyByEmail: c.notifyByEmail,
      willNotifyBySms: c.notifyBySms,
      willNotifyByWhatsapp: c.notifyByWhatsapp,
    }));
  }

  private toSummary(
    exception: {
      id: string;
      tenantId: string;
      containerId: string | null;
      manifestId: string | null;
      type: string;
      message: string;
      createdByUserId: string | null;
      resolvedAt: Date | null;
      createdAt: Date;
      container: { containerNumber: string } | null;
      manifest: { manifestNumber: string } | null;
      createdByUser: { firstName: string; lastName: string } | null;
    },
    notifiedCustomerCount: number,
  ): OperationalExceptionSummary {
    return {
      id: exception.id,
      tenantId: exception.tenantId,
      containerId: exception.containerId,
      containerNumber: exception.container?.containerNumber ?? null,
      manifestId: exception.manifestId,
      manifestNumber: exception.manifest?.manifestNumber ?? null,
      type: exception.type as unknown as OperationalExceptionSummary['type'],
      message: exception.message,
      createdByUserId: exception.createdByUserId,
      createdByName: exception.createdByUser ? `${exception.createdByUser.firstName} ${exception.createdByUser.lastName}` : null,
      resolvedAt: exception.resolvedAt?.toISOString() ?? null,
      createdAt: exception.createdAt.toISOString(),
      notifiedCustomerCount,
    };
  }
}
