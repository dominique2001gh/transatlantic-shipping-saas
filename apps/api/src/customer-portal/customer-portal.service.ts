import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateCheckoutSessionResponse,
  InvoiceSummary,
  PortalCustomerProfile,
  PortalDocumentSummary,
  PortalInvoiceDetail,
  PortalNotificationPreferences,
  PortalNotificationSummary,
  PortalShipmentDetail,
  PortalShipmentSummary,
} from '@transatlantic/shared';
import { DocumentsService } from '../documents/documents.service';
import { InvoicesService } from '../invoices/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdatePortalProfileDto } from './dto/update-portal-profile.dto';

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
    private readonly documentsService: DocumentsService,
    private readonly notificationsService: NotificationsService,
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

  /**
   * Stage 3I: partial update of the caller's own profile.
   * `customerId`/`tenantId` are the controller's JWT-sourced values, not a
   * route param — there is no `:id` on this endpoint, so there is no ID
   * to tamper with. `findFirst` first (rather than updating blind) so a
   * theoretically-orphaned/cross-tenant state fails closed with the same
   * 404 every other ownership check in this module uses, instead of
   * `update` throwing a raw Prisma "record not found" error. Only
   * firstName/lastName/phone are ever writable here — see
   * UpdatePortalProfileDto for why email/customerNumber are excluded.
   */
  async updateProfile(tenantId: string, customerId: string, dto: UpdatePortalProfileDto): Promise<PortalCustomerProfile> {
    const existing = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('Customer profile not found');
    }
    return this.prisma.customer.update({
      where: { id: customerId },
      data: dto,
      select: { customerNumber: true, firstName: true, lastName: true, email: true, phone: true },
    });
  }

  /** Stage 3I: read-side of the notification preferences below — same shape, same tenantId+customerId scoping. */
  async getNotificationPreferences(tenantId: string, customerId: string): Promise<PortalNotificationPreferences> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { notifyByEmail: true, notifyBySms: true, notifyByWhatsapp: true, whatsappPhone: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }
    return customer;
  }

  /**
   * Stage 3I: partial update of the four Stage 3H opt-in columns on
   * Customer that NotificationsService.notifyCustomer already reads on
   * every send — no new schema, no change to dispatch logic, no
   * retroactive effect on any Notification/NotificationEvent row already
   * written (those are historical records of what was sent under the
   * preferences in force at the time, and are never touched here).
   * IN_APP is deliberately not settable — it has no opt-out anywhere in
   * this system, so critical operational in-app notification history is
   * never something this endpoint can suppress.
   *
   * Validates the *resulting merged* state, not the DTO in isolation:
   * enabling notifyByWhatsapp in a request that doesn't also set
   * whatsappPhone must still succeed if a number is already on file from
   * an earlier update (or fail if neither ever will be), so the "WhatsApp
   * needs a number" invariant has to be checked against what the row will
   * actually look like after this write, not against the request body
   * alone.
   */
  async updateNotificationPreferences(
    tenantId: string,
    customerId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<PortalNotificationPreferences> {
    const existing = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { notifyByEmail: true, notifyBySms: true, notifyByWhatsapp: true, whatsappPhone: true },
    });
    if (!existing) {
      throw new NotFoundException('Customer profile not found');
    }

    const resultingWhatsappEnabled = dto.notifyByWhatsapp ?? existing.notifyByWhatsapp;
    const resultingWhatsappPhone = dto.whatsappPhone !== undefined ? dto.whatsappPhone : existing.whatsappPhone;
    if (resultingWhatsappEnabled && !resultingWhatsappPhone) {
      throw new BadRequestException('A WhatsApp number is required to enable WhatsApp notifications.');
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: dto,
      select: { notifyByEmail: true, notifyBySms: true, notifyByWhatsapp: true, whatsappPhone: true },
    });
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

  /** Stage 3G: DocumentsService.findAllForCustomer already scopes by tenantId + customerId + visibleToCustomer:true — nothing to add here. */
  listDocuments(tenantId: string, customerId: string): Promise<PortalDocumentSummary[]> {
    return this.documentsService.findAllForCustomer(tenantId, customerId);
  }

  getDocument(tenantId: string, customerId: string, id: string): Promise<PortalDocumentSummary> {
    return this.documentsService.findByIdForCustomer(tenantId, customerId, id);
  }

  /** DocumentsService.getDownloadTargetForCustomer re-runs the full tenantId+customerId+visibleToCustomer ownership check itself before resolving any file bytes — see its own doc comment. */
  downloadDocument(tenantId: string, customerId: string, id: string) {
    return this.documentsService.getDownloadTargetForCustomer(tenantId, customerId, id);
  }

  /** Stage 3H: NotificationsService.findAllForCustomer already scopes by tenantId + customerId + channel: IN_APP — nothing to add here. */
  listNotifications(tenantId: string, customerId: string): Promise<PortalNotificationSummary[]> {
    return this.notificationsService.findAllForCustomer(tenantId, customerId);
  }

  unreadNotificationCount(tenantId: string, customerId: string): Promise<number> {
    return this.notificationsService.unreadCountForCustomer(tenantId, customerId);
  }

  markNotificationRead(tenantId: string, customerId: string, id: string): Promise<PortalNotificationSummary> {
    return this.notificationsService.markRead(tenantId, customerId, id);
  }
}
