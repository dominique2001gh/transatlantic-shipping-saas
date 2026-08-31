import { Injectable, NotFoundException } from '@nestjs/common';
import type { PortalCustomerProfile, PortalShipmentDetail, PortalShipmentSummary } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';

/**
 * Stage 2C: service layer behind CustomerPortalController. Every method
 * takes tenantId + customerId as explicit parameters — sourced by the
 * controller from the caller's verified JWT, never from a route param or
 * request body — and includes both directly in its Prisma `where` clause.
 * This is the same per-query tenant-scoping convention every staff service
 * in this codebase already follows (see PrismaService's own doc comment),
 * extended one level further for per-customer ownership. Shipment
 * projection logic is never duplicated here — it's delegated to
 * TrackingService, the single owner of the Stage 2A customer-safe
 * projection (see TrackingService's class doc comment).
 */
@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
  ) {}

  async getProfile(tenantId: string, customerId: string): Promise<PortalCustomerProfile> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { customerNumber: true, firstName: true, lastName: true, email: true, phone: true },
    });
    if (!customer) {
      // Should never happen given the schema (a CUSTOMER account only
      // exists via Customer.userId), but fail closed like every other
      // ownership check in this module rather than assume.
      throw new NotFoundException('Customer profile not found');
    }
    return customer;
  }

  listShipments(tenantId: string, customerId: string): Promise<PortalShipmentSummary[]> {
    return this.trackingService.listForCustomer(tenantId, customerId);
  }

  async getShipment(tenantId: string, customerId: string, shipmentId: string): Promise<PortalShipmentDetail> {
    // TrackingService.getForCustomer already scopes by tenantId+customerId
    // and 404s on any mismatch; id is safe to attach here only because
    // that lookup already succeeded for exactly this id.
    const detail = await this.trackingService.getForCustomer(tenantId, customerId, shipmentId);
    return { ...detail, id: shipmentId };
  }
}
