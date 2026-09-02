import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';
import {
  NotificationEventType as SharedNotificationEventType,
  SHIPMENT_STATUS_MILESTONES,
} from '@transatlantic/shared';
import type { NotificationSummary, PortalNotificationSummary } from '@transatlantic/shared';
import type { ShipmentStatus } from '@prisma/client';
import { formatMoney } from '../common/money/money.util';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER, SMS_PROVIDER, WHATSAPP_PROVIDER } from './providers/provider.types';
import type { EmailProvider, SmsProvider, WhatsAppProvider } from './providers/provider.types';

const NOTIFICATION_LIST_INCLUDE = {
  customer: { select: { firstName: true, lastName: true } },
  event: { select: { eventType: true } },
} as const;

type NotificationWithDisplayFields = Prisma.NotificationGetPayload<{ include: typeof NOTIFICATION_LIST_INCLUDE }>;

interface SourceRefs {
  shipmentId?: string;
  documentId?: string;
  invoiceId?: string;
  paymentId?: string;
  operationalExceptionId?: string;
}

/**
 * Stage 3H: the single chokepoint every trigger in this codebase calls to
 * turn a business occurrence into customer notifications — the same "one
 * place owns this side effect" discipline PaymentsService.recordPayment
 * already applies to amountPaid/status.
 *
 * Called from:
 *   - ShipmentsService.createTrackingEvent (fireShipmentStatusChanged) —
 *     only when the new shipment-level status is `notifiable` per
 *     SHIPMENT_STATUS_MILESTONES (Stage 2A), the same anti-spam table the
 *     public/portal tracking projection already uses. Deliberately
 *     shipment-level only, not item-level — a shipment with several items
 *     reaching the same milestone at different times would otherwise
 *     produce one notification per item for what a customer experiences
 *     as a single event; the shipment-level rollup IS that single event.
 *   - DocumentsService.update (fireDocumentVisible) — when
 *     visibleToCustomer flips false -> true.
 *   - InvoicesService.issue (fireInvoiceIssued).
 *   - PaymentsService.recordPayment / completeOnlinePayment
 *     (firePaymentReceived).
 *   - DisruptionsService (fireContainerDisruption) — the only multi-
 *     customer fan-out; every other fire* method here is single-customer.
 *
 * Every fire* method swallows its own errors (logs, never throws) — a
 * notification-pipeline failure must never roll back or fail the
 * underlying business operation (a shipment status update, a payment
 * being recorded) that triggered it.
 *
 * Dedup: each event gets a `dedupeKey` unique per tenant
 * (NotificationEvent.@@unique([tenantId, dedupeKey])). A second attempt to
 * fire the exact same occurrence (e.g. a status correction re-recording a
 * status the shipment already reached) hits that unique constraint, which
 * this service catches and treats as "already fired, nothing to do" —
 * never a second round of customer notifications.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsappProvider: WhatsAppProvider,
  ) {}

  async fireShipmentStatusChanged(tenantId: string, shipmentId: string, status: ShipmentStatus): Promise<void> {
    const milestone = SHIPMENT_STATUS_MILESTONES[status as unknown as keyof typeof SHIPMENT_STATUS_MILESTONES];
    if (!milestone?.notifiable) {
      return;
    }
    try {
      const shipment = await this.prisma.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, trackingNumber: true, customerId: true },
      });
      if (!shipment) return;

      await this.fireEventForCustomer({
        tenantId,
        eventType: SharedNotificationEventType.SHIPMENT_STATUS_CHANGED,
        customerId: shipment.customerId,
        dedupeKey: `shipment:${shipmentId}:status:${status}`,
        title: `${shipment.trackingNumber} reached ${status}`,
        body: `Your shipment ${shipment.trackingNumber} status: ${milestone.label}.`,
        sourceRefs: { shipmentId },
      });
    } catch (err) {
      this.logger.error(`fireShipmentStatusChanged failed for shipment ${shipmentId}: ${err}`);
    }
  }

  async fireDocumentVisible(tenantId: string, documentId: string): Promise<void> {
    try {
      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { id: true, customerId: true, fileName: true, shipment: { select: { trackingNumber: true } } },
      });
      if (!document || !document.customerId) return;

      await this.fireEventForCustomer({
        tenantId,
        eventType: SharedNotificationEventType.DOCUMENT_VISIBLE,
        customerId: document.customerId,
        dedupeKey: `document:${documentId}:visible`,
        title: `Document "${document.fileName}" made visible`,
        body: document.shipment
          ? `A new document is available for your shipment ${document.shipment.trackingNumber}: ${document.fileName}.`
          : `A new document is available on your account: ${document.fileName}.`,
        sourceRefs: { documentId },
      });
    } catch (err) {
      this.logger.error(`fireDocumentVisible failed for document ${documentId}: ${err}`);
    }
  }

  async fireInvoiceIssued(tenantId: string, invoiceId: string): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, customerId: true, invoiceNumber: true, total: true, currency: true },
      });
      if (!invoice) return;

      await this.fireEventForCustomer({
        tenantId,
        eventType: SharedNotificationEventType.INVOICE_ISSUED,
        customerId: invoice.customerId,
        dedupeKey: `invoice:${invoiceId}:issued`,
        title: `Invoice ${invoice.invoiceNumber} issued`,
        body: `Invoice ${invoice.invoiceNumber} for ${formatMoney(invoice.total)} ${invoice.currency} is now available.`,
        sourceRefs: { invoiceId },
      });
    } catch (err) {
      this.logger.error(`fireInvoiceIssued failed for invoice ${invoiceId}: ${err}`);
    }
  }

  async firePaymentReceived(tenantId: string, paymentId: string): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          customerId: true,
          amount: true,
          currency: true,
          invoice: { select: { invoiceNumber: true } },
        },
      });
      if (!payment) return;

      await this.fireEventForCustomer({
        tenantId,
        eventType: SharedNotificationEventType.PAYMENT_RECEIVED,
        customerId: payment.customerId,
        dedupeKey: `payment:${paymentId}:received`,
        title: `Payment received for ${payment.invoice.invoiceNumber}`,
        body: `We received your payment of ${formatMoney(payment.amount)} ${payment.currency} for invoice ${payment.invoice.invoiceNumber}. Thank you!`,
        sourceRefs: { paymentId },
      });
    } catch (err) {
      this.logger.error(`firePaymentReceived failed for payment ${paymentId}: ${err}`);
    }
  }

  /**
   * Stage 3H: the only multi-customer fire path — called by
   * DisruptionsService once it has already resolved the affected-customer
   * list. Creates exactly ONE NotificationEvent (this is one occurrence,
   * not N) and fans out per-customer Notification rows from it.
   */
  async fireContainerDisruption(params: {
    tenantId: string;
    operationalExceptionId: string;
    affectedCustomerIds: string[];
    internalTitle: string;
    customerMessage: string;
    triggeredByUserId: string;
  }): Promise<{ notifiedCount: number }> {
    try {
      const event = await this.getOrCreateEvent({
        tenantId: params.tenantId,
        eventType: SharedNotificationEventType.CONTAINER_DISRUPTED,
        dedupeKey: `disruption:${params.operationalExceptionId}`,
        title: params.internalTitle,
        sourceRefs: { operationalExceptionId: params.operationalExceptionId },
        triggeredByUserId: params.triggeredByUserId,
      });
      if (!event) {
        return { notifiedCount: 0 };
      }
      for (const customerId of params.affectedCustomerIds) {
        await this.notifyCustomer(event.id, params.tenantId, customerId, params.internalTitle, params.customerMessage);
      }
      return { notifiedCount: params.affectedCustomerIds.length };
    } catch (err) {
      this.logger.error(`fireContainerDisruption failed for exception ${params.operationalExceptionId}: ${err}`);
      return { notifiedCount: 0 };
    }
  }

  async findAllForTenant(
    tenantId: string,
    filters: { customerId?: string; channel?: NotificationChannel },
  ): Promise<NotificationSummary[]> {
    const notifications = await this.prisma.notification.findMany({
      where: {
        tenantId,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.channel ? { channel: filters.channel } : {}),
      },
      include: NOTIFICATION_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return notifications.map((n) => this.toSummary(n));
  }

  async findAllForCustomer(tenantId: string, customerId: string): Promise<PortalNotificationSummary[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { tenantId, customerId, channel: NotificationChannel.IN_APP },
      include: { event: { select: { shipmentId: true, invoiceId: true, documentId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return notifications.map((n) => this.toPortalSummary(n));
  }

  async unreadCountForCustomer(tenantId: string, customerId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { tenantId, customerId, channel: NotificationChannel.IN_APP, readAt: null },
    });
  }

  /** Idempotent — marking an already-read notification read again is a no-op, not an error. */
  async markRead(tenantId: string, customerId: string, id: string): Promise<PortalNotificationSummary> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, tenantId, customerId, channel: NotificationChannel.IN_APP },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: notification.readAt ?? new Date(), status: NotificationStatus.READ },
      include: { event: { select: { shipmentId: true, invoiceId: true, documentId: true } } },
    });
    return this.toPortalSummary(updated);
  }

  // ---------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------

  private async fireEventForCustomer(params: {
    tenantId: string;
    eventType: SharedNotificationEventType;
    customerId: string;
    dedupeKey: string;
    title: string;
    body: string;
    sourceRefs: SourceRefs;
  }): Promise<void> {
    const event = await this.getOrCreateEvent({
      tenantId: params.tenantId,
      eventType: params.eventType,
      dedupeKey: params.dedupeKey,
      title: params.title,
      sourceRefs: params.sourceRefs,
    });
    if (!event) {
      return; // dedupe hit — already fired for this exact occurrence
    }
    await this.notifyCustomer(event.id, params.tenantId, params.customerId, params.title, params.body);
  }

  /** Returns null on a dedupe hit (unique constraint violation) rather than throwing — the caller treats that as "nothing to do", not an error. */
  private async getOrCreateEvent(params: {
    tenantId: string;
    eventType: SharedNotificationEventType;
    dedupeKey: string;
    title: string;
    sourceRefs: SourceRefs;
    triggeredByUserId?: string;
  }): Promise<{ id: string } | null> {
    try {
      return await this.prisma.notificationEvent.create({
        data: {
          tenantId: params.tenantId,
          eventType: params.eventType,
          dedupeKey: params.dedupeKey,
          title: params.title,
          triggeredByUserId: params.triggeredByUserId,
          shipmentId: params.sourceRefs.shipmentId,
          documentId: params.sourceRefs.documentId,
          invoiceId: params.sourceRefs.invoiceId,
          paymentId: params.sourceRefs.paymentId,
          operationalExceptionId: params.sourceRefs.operationalExceptionId,
        },
        select: { id: true },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        this.logger.log(`Dedup hit for "${params.dedupeKey}" — already fired, skipping.`);
        return null;
      }
      throw err;
    }
  }

  private async notifyCustomer(
    eventId: string,
    tenantId: string,
    customerId: string,
    title: string,
    body: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: {
        email: true,
        phone: true,
        whatsappPhone: true,
        notifyByEmail: true,
        notifyBySms: true,
        notifyByWhatsapp: true,
      },
    });
    if (!customer) return;

    // IN_APP is always on — there is no opt-out for the portal's own
    // notification list in V1, only for the outbound provider channels.
    await this.createAndDispatch(eventId, tenantId, customerId, NotificationChannel.IN_APP, title, body, null);

    if (customer.notifyByEmail) {
      await this.createAndDispatch(eventId, tenantId, customerId, NotificationChannel.EMAIL, title, body, customer.email);
    }
    if (customer.notifyBySms) {
      await this.createAndDispatch(eventId, tenantId, customerId, NotificationChannel.SMS, title, body, customer.phone);
    }
    if (customer.notifyByWhatsapp) {
      await this.createAndDispatch(
        eventId,
        tenantId,
        customerId,
        NotificationChannel.WHATSAPP,
        title,
        body,
        customer.whatsappPhone,
      );
    }
  }

  private async createAndDispatch(
    eventId: string,
    tenantId: string,
    customerId: string,
    channel: NotificationChannel,
    title: string,
    body: string,
    target: string | null,
  ): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: { tenantId, eventId, customerId, channel, status: NotificationStatus.PENDING, title, body },
    });

    if (channel === NotificationChannel.IN_APP) {
      // Nothing to dispatch — the row itself is what the portal reads.
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.SENT, sentAt: new Date() },
      });
      return;
    }

    if (!target) {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.FAILED, errorMessage: `No ${channel} address on file for this customer.` },
      });
      return;
    }

    const result =
      channel === NotificationChannel.EMAIL
        ? await this.emailProvider.send({ to: target, subject: title, body })
        : channel === NotificationChannel.SMS
          ? await this.smsProvider.send({ to: target, body })
          : await this.whatsappProvider.send({ to: target, body });

    await this.prisma.notification.update({
      where: { id: notification.id },
      data: result.success
        ? { status: NotificationStatus.SENT, sentAt: new Date(), providerMessageId: result.providerMessageId }
        : { status: NotificationStatus.FAILED, errorMessage: result.errorMessage ?? 'Unknown provider error' },
    });
  }

  private toSummary(n: NotificationWithDisplayFields): NotificationSummary {
    return {
      id: n.id,
      tenantId: n.tenantId,
      eventId: n.eventId,
      eventType: (n.event?.eventType as unknown as NotificationSummary['eventType']) ?? null,
      customerId: n.customerId,
      customerName: n.customer ? `${n.customer.firstName} ${n.customer.lastName}` : null,
      channel: n.channel as unknown as NotificationSummary['channel'],
      status: n.status as unknown as NotificationSummary['status'],
      title: n.title,
      body: n.body,
      providerMessageId: n.providerMessageId,
      errorMessage: n.errorMessage,
      sentAt: n.sentAt?.toISOString() ?? null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    };
  }

  private toPortalSummary(
    n: Prisma.NotificationGetPayload<{ include: { event: { select: { shipmentId: true; invoiceId: true; documentId: true } } } }>,
  ): PortalNotificationSummary {
    return {
      id: n.id,
      channel: n.channel as unknown as PortalNotificationSummary['channel'],
      title: n.title,
      body: n.body,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      shipmentId: n.event?.shipmentId ?? null,
      invoiceId: n.event?.invoiceId ?? null,
      documentId: n.event?.documentId ?? null,
    };
  }
}
