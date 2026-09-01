import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateCheckoutSessionResponse,
  InvoiceSummary,
  PortalCustomerProfile,
  PortalInvoiceDetail,
  PortalShipmentDetail,
  PortalShipmentSummary,
} from '@transatlantic/shared';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
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
 * projection (see TrackingService's class doc comment). Stage 3E's invoice
 * viewing follows the exact same delegation principle, to InvoicesService/
 * PaymentsService instead.
 */
@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly config: ConfigService,
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

  listInvoices(tenantId: string, customerId: string): Promise<InvoiceSummary[]> {
    return this.invoicesService.findAllForCustomer(tenantId, customerId);
  }

  /**
   * InvoicesService.findByIdForCustomer is the actual authorization gate
   * here — scoped by tenantId + customerId + "not DRAFT", 404 on any
   * mismatch. It's only safe to call paymentsService.listForInvoice
   * (which only checks tenantId, not customerId) afterward because that
   * gate has already thrown if this invoice isn't confirmed to belong to
   * this customer — the ordering below is the actual security boundary,
   * not an incidental detail.
   */
  async getInvoice(tenantId: string, customerId: string, invoiceId: string): Promise<PortalInvoiceDetail> {
    const invoice = await this.invoicesService.findByIdForCustomer(tenantId, customerId, invoiceId);
    const payments = await this.paymentsService.listForInvoice(tenantId, invoiceId);
    return { ...invoice, payments };
  }

  /**
   * Stage 3F: same ownership gate as getInvoice above —
   * InvoicesService.findByIdForCustomer is what actually confirms this
   * invoice belongs to this customer's own tenant + Customer record and
   * has been issued (not DRAFT); only once that's thrown or succeeded is
   * it safe to hand `invoice.id` to PaymentsService.createOnlineCheckoutSession,
   * which re-scopes by tenantId itself (the same defense-in-depth
   * discipline recordPayment already follows) but does not re-check
   * customerId — this call ordering is what makes that safe, exactly as
   * documented on getInvoice.
   *
   * success/cancel URLs point back at this exact invoice's detail page —
   * WEB_APP_URL defaults to the local dev web app so this works out of
   * the box without extra .env setup; override it for any other
   * environment.
   */
  async createCheckoutSession(
    tenantId: string,
    customerId: string,
    invoiceId: string,
  ): Promise<CreateCheckoutSessionResponse> {
    const invoice = await this.invoicesService.findByIdForCustomer(tenantId, customerId, invoiceId);
    const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
    return this.paymentsService.createOnlineCheckoutSession(tenantId, invoice.id, {
      successUrl: `${webAppUrl}/portal/invoices/${invoice.id}?payment=success`,
      cancelUrl: `${webAppUrl}/portal/invoices/${invoice.id}?payment=cancelled`,
    });
  }
}
