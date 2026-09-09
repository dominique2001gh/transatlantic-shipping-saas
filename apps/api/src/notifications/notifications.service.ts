import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HandoffType, NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';
import {
  NotificationEventType as SharedNotificationEventType,
  SHIPMENT_STATUS_MILESTONES,
  ShipmentStatus as SharedShipmentStatus,
} from '@transatlantic/shared';
import type { NotificationSummary, PortalNotificationSummary } from '@transatlantic/shared';
import type { ShipmentMode as DbShipmentMode, ShipmentStatus } from '@prisma/client';
import type { ShipmentMode as SharedShipmentMode } from '@transatlantic/shared';
import { formatMoney } from '../common/money/money.util';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeToE164 } from './phone-normalization.util';
import { EMAIL_PROVIDER, SMS_PROVIDER, WHATSAPP_PROVIDER } from './providers/provider.types';
import type { EmailProvider, SmsProvider, WhatsAppProvider } from './providers/provider.types';
import {
  buildShipmentTrackingUrl,
  shipmentArrivedEmail,
  shipmentDeliveredEmail,
  shipmentDepartedEmail,
  shipmentOutForDeliveryEmail,
  shipmentPickedUpEmail,
  shipmentReadyForPickupEmail,
  shipmentReceivedEmail,
  type ShipmentCustomerEmail,
  type ShipmentEmailPickupLocation,
  type ShipmentEmailTenantBranding,
} from './templates/shipment-customer-emails';
import { buildShipmentStatusWhatsAppTemplate, type WhatsAppTemplatePayload } from './whatsapp-template.util';

const WHATSAPP_DEFAULT_TEMPLATE_NAME = 'shipment_status_update';
const WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE = 'en_US';

/**
 * Customer Email Redesign: exactly the 7 shipment-lifecycle statuses this
 * stage has a real branded template for — deliberately NOT "every
 * notifiable SHIPMENT_STATUS_MILESTONES entry" (which also includes
 * CUSTOMS_CLEARED). A notifiable status absent here simply keeps using the
 * original generic title/body for its email — not a bug, an explicit scope
 * boundary, same posture WHATSAPP_SUPPORTED_SHIPMENT_STATUSES already
 * documents for the same reason.
 */
const EMAIL_TEMPLATED_SHIPMENT_STATUSES: ReadonlySet<SharedShipmentStatus> = new Set([
  SharedShipmentStatus.WAREHOUSE_RECEIVED,
  SharedShipmentStatus.DEPARTED,
  SharedShipmentStatus.ARRIVED_DESTINATION,
  SharedShipmentStatus.READY_FOR_PICKUP,
  SharedShipmentStatus.OUT_FOR_DELIVERY,
  SharedShipmentStatus.DELIVERED,
  SharedShipmentStatus.COMPLETED,
]);

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
    private readonly config: ConfigService,
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
        select: {
          id: true,
          trackingNumber: true,
          customerId: true,
          shipmentMode: true,
          destinationCountry: true,
          destinationWarehouseId: true,
        },
      });
      if (!shipment) return;

      // WhatsApp Integration (Stage 4C) Phase 1: only a fixed, explicitly
      // approved allow-list of milestones gets a WhatsApp attempt at all
      // (see buildShipmentStatusWhatsAppTemplate's own doc comment) — a
      // status outside that list (e.g. CUSTOMS_CLEARED) returns null here
      // and WhatsApp is silently skipped for this occurrence, same as if
      // the customer had no WhatsApp number on file. Email/SMS/IN_APP
      // below are completely unaffected either way.
      const whatsappTemplate = buildShipmentStatusWhatsAppTemplate(
        status as unknown as SharedShipmentStatus,
        shipment.trackingNumber,
        milestone.label,
        this.config.get<string>('META_WHATSAPP_TEMPLATE_NAME', WHATSAPP_DEFAULT_TEMPLATE_NAME),
        this.config.get<string>('META_WHATSAPP_TEMPLATE_LANGUAGE', WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE),
      );

      // Customer Email Redesign: a branded, plain-language email for the 7
      // major milestones (see EMAIL_TEMPLATED_SHIPMENT_STATUSES); `null` for
      // every other notifiable status (falls back to the original generic
      // title/body below, unchanged), or the literal string 'suppress' for
      // a COMPLETED that immediately follows an already-emailed DELIVERED —
      // see buildShipmentEmailContent's own doc comment.
      const emailContent = await this.buildShipmentEmailContent(tenantId, shipment, status as unknown as SharedShipmentStatus);

      await this.fireEventForCustomer({
        tenantId,
        eventType: SharedNotificationEventType.SHIPMENT_STATUS_CHANGED,
        customerId: shipment.customerId,
        dedupeKey: `shipment:${shipmentId}:status:${status}`,
        title: `${shipment.trackingNumber} reached ${status}`,
        body: `Your shipment ${shipment.trackingNumber} status: ${milestone.label}.`,
        sourceRefs: { shipmentId },
        whatsappTemplate,
        emailContent,
      });
    } catch (err) {
      this.logger.error(`fireShipmentStatusChanged failed for shipment ${shipmentId}: ${err}`);
    }
  }

  /**
   * Customer Email Redesign: resolves the branded email for one of the 7
   * templated shipment milestones, or `null` (use the original generic
   * title/body) for anything outside that set, or the literal string
   * `'suppress'` to skip the EMAIL channel entirely for this one
   * occurrence.
   *
   * The `'suppress'` case: `maybeRollupShipmentCompletion` fires COMPLETED
   * for both a pure customer-pickup shipment AND, redundantly, right after
   * a driver-delivery's own DELIVERED (an existing, documented,
   * intentional redundancy in WarehouseService — not something this stage
   * changes). Sending the customer two near-identical "your shipment is
   * done" emails seconds apart would read as a mistake, so: if this
   * shipment already has a `PickupDeliveryRecord` of type DELIVERY (i.e. a
   * DELIVERED email already went out for the same real-world event), the
   * COMPLETED email is suppressed — the customer gets exactly one final
   * completion message, not two. A pure pickup shipment (no DELIVERY
   * record) has no earlier email to duplicate, so COMPLETED renders as the
   * "Picked Up" template instead. This only affects EMAIL — IN_APP/SMS/
   * WhatsApp keep their existing, unrelated behavior for COMPLETED
   * entirely untouched.
   */
  private async buildShipmentEmailContent(
    tenantId: string,
    shipment: {
      id: string;
      trackingNumber: string;
      customerId: string;
      shipmentMode: DbShipmentMode;
      destinationCountry: string;
      destinationWarehouseId: string | null;
    },
    status: SharedShipmentStatus,
  ): Promise<ShipmentCustomerEmail | 'suppress' | null> {
    if (!EMAIL_TEMPLATED_SHIPMENT_STATUSES.has(status)) {
      return null;
    }

    const [tenant, customer] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, legalName: true, logoUrl: true, primaryColor: true, secondaryColor: true, email: true, phone: true, website: true },
      }),
      this.prisma.customer.findFirst({ where: { id: shipment.customerId, tenantId }, select: { firstName: true } }),
    ]);
    if (!tenant) return null;

    const branding: ShipmentEmailTenantBranding = tenant;
    const trackingUrl = buildShipmentTrackingUrl(tenant.website, shipment.trackingNumber);
    const base = {
      trackingNumber: shipment.trackingNumber,
      customerFirstName: customer?.firstName ?? null,
      tenant: branding,
      trackingUrl,
    };

    switch (status) {
      case SharedShipmentStatus.WAREHOUSE_RECEIVED:
        return shipmentReceivedEmail(base);

      case SharedShipmentStatus.DEPARTED: {
        const estimatedArrival = await this.resolveShipmentEta(tenantId, shipment.id);
        return shipmentDepartedEmail({
          ...base,
          shipmentMode: shipment.shipmentMode as unknown as SharedShipmentMode,
          destinationCountry: shipment.destinationCountry,
          estimatedArrival,
        });
      }

      case SharedShipmentStatus.ARRIVED_DESTINATION:
        return shipmentArrivedEmail(base);

      case SharedShipmentStatus.READY_FOR_PICKUP: {
        const pickupLocation = await this.resolvePickupLocation(tenantId, shipment.destinationWarehouseId);
        return shipmentReadyForPickupEmail({ ...base, pickupLocation });
      }

      case SharedShipmentStatus.OUT_FOR_DELIVERY:
        return shipmentOutForDeliveryEmail(base);

      case SharedShipmentStatus.DELIVERED:
        return shipmentDeliveredEmail(base);

      case SharedShipmentStatus.COMPLETED: {
        const alreadyDelivered = await this.prisma.pickupDeliveryRecord.findFirst({
          where: { tenantId, shipmentId: shipment.id, type: HandoffType.DELIVERY },
          select: { id: true },
        });
        return alreadyDelivered ? 'suppress' : shipmentPickedUpEmail(base);
      }

      default:
        return null;
    }
  }

  /**
   * Sourced from whichever transport record this shipment's items are
   * actually attached to — never invented. Two independent paths exist in
   * this schema (see Manifest's own doc comment): ocean/RoRo items reach a
   * manifest only *through* a Container (Container.manifestId), never via
   * a direct ManifestItem row, so a container's own `estimatedArrival` is
   * checked first and its assigned manifest's `estimatedArrivalAt` is the
   * fallback; air-freight items are assigned directly to a manifest with
   * no container at all, via ManifestItem, checked separately. Returns
   * null (email omits the ETA entirely) unless every leg that has an
   * estimate set agrees on exactly one date — a shipment split across legs
   * with divergent ETAs must never show a single guessed number.
   */
  private async resolveShipmentEta(tenantId: string, shipmentId: string): Promise<Date | null> {
    const [containerLegs, manifestLegs] = await Promise.all([
      this.prisma.containerItem.findMany({
        where: { tenantId, shipmentId, removedAt: null },
        select: { container: { select: { estimatedArrival: true, manifest: { select: { estimatedArrivalAt: true } } } } },
      }),
      this.prisma.manifestItem.findMany({
        where: { tenantId, shipmentId, removedAt: null },
        select: { manifest: { select: { estimatedArrivalAt: true } } },
      }),
    ]);
    const distinctTimes = new Set<number>();
    for (const leg of containerLegs) {
      const eta = leg.container.estimatedArrival ?? leg.container.manifest?.estimatedArrivalAt ?? null;
      if (eta) distinctTimes.add(eta.getTime());
    }
    for (const leg of manifestLegs) {
      if (leg.manifest.estimatedArrivalAt) distinctTimes.add(leg.manifest.estimatedArrivalAt.getTime());
    }
    if (distinctTimes.size !== 1) return null;
    return new Date([...distinctTimes][0]);
  }

  /**
   * The shipment's destination warehouse address, when one is actually
   * assigned — never a fabricated or default location. No pickup-hours/
   * instructions field exists anywhere in this schema today (deliberately
   * not added for this stage — see this milestone's own design notes), so
   * only the location itself is ever included.
   */
  private async resolvePickupLocation(tenantId: string, destinationWarehouseId: string | null): Promise<ShipmentEmailPickupLocation | null> {
    if (!destinationWarehouseId) return null;
    return this.prisma.warehouse.findFirst({
      where: { id: destinationWarehouseId, tenantId },
      select: { name: true, addressLine1: true, addressLine2: true, city: true, state: true, country: true, postalCode: true, phone: true },
    });
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

  /**
   * WhatsApp Integration (Stage 4C) Phase 2: the one entry point
   * WhatsAppWebhookController calls for every status callback Meta sends
   * — keeps this service the sole owner of every Notification row
   * mutation, exactly like every fire* method above, rather than the
   * webhook controller reaching into Prisma directly.
   *
   * Looked up by `providerMessageId` (Meta's own globally-unique wamid,
   * stamped on the row at send time in createAndDispatch) — this is what
   * makes the update inherently tenant-safe without needing a tenantId
   * parameter here at all: a caller can only ever affect a row for a
   * message this platform actually sent, and that row's tenantId was
   * fixed at creation, not something this method or its caller could
   * redirect. An unrecognized wamid (unknown message, or a webhook for
   * something this platform never sent) is a silent no-op, never an
   * error — Meta's webhooks fan out broadly and a handler ignoring what
   * it doesn't recognize is the correct posture, same stance
   * WebhooksController already takes for unhandled Stripe event types.
   *
   * Only `read` and `failed` ever change `status` — `sent`/`delivered`
   * are already correctly represented by the existing `SENT` status set
   * at initial dispatch (this schema has no distinct DELIVERED value, and
   * adding one is out of scope for this phase); reusing `NotificationStatus.
   * READ` for "the recipient opened the WhatsApp message" is the same
   * concept `markRead` already uses for the portal's own in-app "read"
   * gesture, not a new meaning grafted on. `failed` is deliberately never
   * applied over an already-`READ` row — a message truly read by the
   * recipient cannot retroactively have failed to arrive; this is the
   * same forward-only, never-downgraded posture every shipment/manifest
   * rollup in this codebase already follows.
   *
   * Idempotent by construction, not by a separate ledger: `readAt` is
   * computed from the webhook payload's own `timestamp` field (never wall-
   * clock `now()`), so redelivering the identical callback re-applies the
   * identical value — no separate dedupe table needed, unlike Stripe's
   * StripeWebhookEvent ledger (Meta's status callbacks don't carry a
   * single stable per-delivery event id the way a Stripe Event does).
   */
  async updateWhatsAppStatusFromWebhook(
    providerMessageId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    timestampSeconds: number,
    errorMessage?: string,
  ): Promise<void> {
    if (status === 'sent' || status === 'delivered') {
      // Already correctly represented by SENT — nothing to write. Still a
      // successfully "handled" callback from the controller's point of
      // view, just a no-op here.
      return;
    }

    const notification = await this.prisma.notification.findFirst({
      where: { providerMessageId, channel: NotificationChannel.WHATSAPP },
      select: { id: true, status: true },
    });
    if (!notification) {
      this.logger.log(`WhatsApp webhook status "${status}" for unrecognized message id — ignoring.`);
      return;
    }

    if (status === 'failed' && notification.status === NotificationStatus.READ) {
      this.logger.log(`Ignoring "failed" WhatsApp webhook for a message already marked READ (out-of-order delivery).`);
      return;
    }

    const occurredAt = new Date(timestampSeconds * 1000);
    await this.prisma.notification.update({
      where: { id: notification.id },
      data:
        status === 'read'
          ? { status: NotificationStatus.READ, readAt: occurredAt }
          : { status: NotificationStatus.FAILED, errorMessage: errorMessage ?? 'WhatsApp delivery failed' },
    });
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
    /**
     * WhatsApp Integration (Stage 4C) Phase 1: only fireShipmentStatusChanged
     * ever passes this — every other fire* method (documents, invoices,
     * payments, the bulk disruption path) omits it, which means WhatsApp is
     * simply never attempted for those event types yet. Not a workaround:
     * this is the literal scope boundary this phase was approved for.
     */
    whatsappTemplate?: WhatsAppTemplatePayload | null;
    /**
     * Customer Email Redesign: only fireShipmentStatusChanged ever passes
     * this — a richer, tenant-branded {subject,text,html} to use for the
     * EMAIL channel specifically instead of the generic title/body above,
     * or the literal string 'suppress' to skip EMAIL entirely for this one
     * occurrence (see buildShipmentEmailContent's own doc comment).
     * `undefined`/omitted (every other fire* method) keeps today's exact
     * behavior: EMAIL uses the same generic title/body as IN_APP/SMS.
     */
    emailContent?: ShipmentCustomerEmail | 'suppress' | null;
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
    await this.notifyCustomer(event.id, params.tenantId, params.customerId, params.title, params.body, params.whatsappTemplate, params.emailContent);
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
    whatsappTemplate?: WhatsAppTemplatePayload | null,
    emailContent?: ShipmentCustomerEmail | 'suppress' | null,
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
        // WhatsApp Integration (Stage 4C) Phase 1: the tenant's own
        // `country` (already on Tenant, no schema change) is the
        // normalization hint for a customer's whatsappPhone when it's
        // stored in bare local format — never a hardcoded country, so
        // this stays correct for any tenant's own customer base.
        tenant: { select: { country: true } },
      },
    });
    if (!customer) return;

    // IN_APP is always on — there is no opt-out for the portal's own
    // notification list in V1, only for the outbound provider channels.
    await this.createAndDispatch(eventId, tenantId, customerId, NotificationChannel.IN_APP, title, body, null);

    // Customer Email Redesign: 'suppress' skips EMAIL entirely for this
    // occurrence (the redundant COMPLETED-after-DELIVERED case) — no
    // Notification row created at all, same posture WhatsApp already uses
    // for "not applicable this time." A real ShipmentCustomerEmail sends
    // the tenant-branded rich subject/text/html instead of the generic
    // title/body; `undefined`/null (every non-shipment-status fire* path)
    // keeps today's exact plain-text behavior.
    if (customer.notifyByEmail && emailContent !== 'suppress') {
      if (emailContent) {
        await this.createAndDispatch(
          eventId,
          tenantId,
          customerId,
          NotificationChannel.EMAIL,
          emailContent.subject,
          emailContent.text,
          customer.email,
          undefined,
          undefined,
          emailContent.html,
        );
      } else {
        await this.createAndDispatch(eventId, tenantId, customerId, NotificationChannel.EMAIL, title, body, customer.email);
      }
    }
    if (customer.notifyBySms) {
      await this.createAndDispatch(eventId, tenantId, customerId, NotificationChannel.SMS, title, body, customer.phone);
    }
    // WhatsApp Integration (Stage 4C) Phase 1: no template means this
    // event type/status isn't WhatsApp-supported yet (see
    // buildShipmentStatusWhatsAppTemplate) — skipped entirely, no
    // Notification row created at all for this channel, same as if the
    // customer had never opted in. Every other channel above is
    // unaffected either way.
    if (customer.notifyByWhatsapp && whatsappTemplate) {
      await this.createAndDispatch(
        eventId,
        tenantId,
        customerId,
        NotificationChannel.WHATSAPP,
        title,
        body,
        customer.whatsappPhone,
        whatsappTemplate,
        customer.tenant?.country,
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
    whatsappTemplate?: WhatsAppTemplatePayload | null,
    defaultCountry?: string | null,
    /** Customer Email Redesign: rich HTML body — only ever set (by notifyCustomer) when channel is EMAIL and a ShipmentCustomerEmail was provided; every other call site omits it, so the email provider gets no `html` and behaves exactly as before. */
    html?: string,
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

    // WhatsApp Integration (Stage 4C) Phase 1: normalize/validate to E.164
    // right before dispatch — a Notification row already exists for this
    // attempt (created above), so an unusable number is recorded as a
    // real FAILED attempt with a clear reason, never silently dropped and
    // never a raw/malformed value handed to the provider.
    let dispatchTarget = target;
    if (channel === NotificationChannel.WHATSAPP) {
      const normalized = normalizeToE164(target, defaultCountry);
      if (!normalized) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.FAILED,
            errorMessage: `Customer's WhatsApp number ("${target}") is not a valid phone number.`,
          },
        });
        return;
      }
      dispatchTarget = normalized;
    }

    const result =
      channel === NotificationChannel.EMAIL
        ? await this.emailProvider.send({ to: dispatchTarget, subject: title, body, html })
        : channel === NotificationChannel.SMS
          ? await this.smsProvider.send({ to: dispatchTarget, body })
          : await this.whatsappProvider.send({
              to: dispatchTarget,
              body,
              template: whatsappTemplate ?? undefined,
              tenantId,
            });

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
