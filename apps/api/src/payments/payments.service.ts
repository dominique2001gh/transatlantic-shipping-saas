import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod, PaymentSource, PaymentStatus, Prisma } from '@prisma/client';
import { PAYABLE_INVOICE_STATUSES } from '@transatlantic/shared';
import type { CreateCheckoutSessionResponse, PaymentListItem, PaymentSummary } from '@transatlantic/shared';
import { formatMoney, toStripeAmount } from '../common/money/money.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

const PAYMENT_LIST_INCLUDE = {
  invoice: { select: { invoiceNumber: true } },
  customer: { select: { firstName: true, lastName: true } },
} as const;

type PaymentWithDisplayFields = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_LIST_INCLUDE }>;

/**
 * Invoice statuses that can still legitimately receive a payment. DRAFT
 * (never issued), VOID, and PAID are all rejected explicitly below with a
 * specific message, rather than only being caught incidentally by the
 * overpayment check. Built from the shared PAYABLE_INVOICE_STATUSES
 * constant (Stage 3F) so the manual-recording guard here and the
 * online-checkout guard below can never silently drift apart.
 */
const PAYABLE_STATUSES = new Set<InvoiceStatus>(PAYABLE_INVOICE_STATUSES as unknown as InvoiceStatus[]);

/**
 * Stage 3B: manual payment recording. `recordPayment` is the single
 * mutation chokepoint for Invoice.amountPaid/status — the same "one place
 * writes derived state" pattern ShipmentsService.createTrackingEvent
 * already establishes for shipment/item status. No payment
 * edit/delete/refund exists; payments are append-only once created.
 *
 * customerId and currency are never accepted from the caller — always
 * read off the already tenant-scoped invoice — so a payment can never be
 * misattributed to the wrong customer or carry a mismatched currency.
 *
 * Stage 3F adds the online-payment counterpart:
 * `createOnlineCheckoutSession` / `completeOnlinePayment` apply the exact
 * same amountPaid/status chokepoint from a Stripe-confirmed payment
 * instead of a staff form submission — see each method's own doc comment.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Stage 3D: GET /payments — every payment across the whole tenant (not
   * scoped to one invoice), for the staff payments list page. Same
   * tenantId scoping as every other query in this service; enriched with
   * invoiceNumber/customerName purely for display so the frontend never
   * needs a per-row follow-up request.
   */
  async findAllForTenant(
    tenantId: string,
    filters: { invoiceId?: string; customerId?: string; status?: PaymentStatus },
  ): Promise<PaymentListItem[]> {
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        ...(filters.invoiceId ? { invoiceId: filters.invoiceId } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: PAYMENT_LIST_INCLUDE,
      orderBy: { paidAt: 'desc' },
    });
    return payments.map((payment) => this.toListItem(payment));
  }

  async listForInvoice(tenantId: string, invoiceId: string): Promise<PaymentSummary[]> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    const payments = await this.prisma.payment.findMany({
      where: { tenantId, invoiceId },
      orderBy: { paidAt: 'asc' },
    });
    return payments.map((payment) => this.toSummary(payment));
  }

  /**
   * Records a completed manual payment (cash/bank transfer/mobile money/
   * check/other — never an online/provider-processed payment, which is a
   * later stage) and atomically updates the invoice's amountPaid/status
   * in the same transaction. Rejects:
   *   - a payment against a DRAFT (never issued), VOID, or already-PAID
   *     invoice, each with its own specific message;
   *   - any payment that would push amountPaid past the invoice total
   *     (no credit-balance/overpayment concept exists anywhere in this
   *     schema, so V1 rejects it outright rather than inventing one).
   * Zero/negative amounts are already rejected by CreatePaymentDto's
   * @IsPositive() before this method ever runs.
   */
  async recordPayment(tenantId: string, invoiceId: string, dto: CreatePaymentDto): Promise<PaymentSummary> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException('Invoice must be issued before payments can be recorded');
    }
    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException('Cannot record a payment against a voided invoice');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already fully paid');
    }
    if (!PAYABLE_STATUSES.has(invoice.status)) {
      // Defensive: should be unreachable given InvoiceStatus's fixed enum
      // and the three explicit checks above, but fail closed rather than
      // silently accept a status this service doesn't know how to handle.
      throw new BadRequestException('Invoice is not in a payable state');
    }

    const amount = new Prisma.Decimal(dto.amount);
    const newAmountPaid = invoice.amountPaid.plus(amount);
    if (newAmountPaid.greaterThan(invoice.total)) {
      throw new BadRequestException('Payment would exceed the invoice balance due');
    }

    const newStatus = newAmountPaid.equals(invoice.total) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          tenantId,
          invoiceId,
          // Always the invoice's own customer/currency — never
          // client-supplied (CreatePaymentDto has no such fields at all).
          customerId: invoice.customerId,
          currency: invoice.currency,
          amount,
          method: dto.method,
          status: PaymentStatus.COMPLETED,
          // Explicit, even though it's also the schema default — this is
          // the manual-recording path; only createOnlineCheckoutSession
          // below ever creates a source: ONLINE row.
          source: PaymentSource.MANUAL,
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        },
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: newAmountPaid, status: newStatus },
      });

      return created;
    });

    // Stage 3H: see ShipmentsService.createTrackingEvent's identical
    // comment on why this is awaited and can't fail the payment recording.
    await this.notificationsService.firePaymentReceived(tenantId, payment.id);

    return this.toSummary(payment);
  }

  /**
   * Stage 3F: creates a Stripe Checkout Session for `invoiceId`'s current
   * balance (never a customer-supplied amount — there is no partial-pay
   * input anywhere in this flow) and a matching PENDING/ONLINE Payment
   * row to track it through to webhook confirmation. Re-checks tenancy
   * and payability itself (tenantId + PAYABLE_STATUSES) rather than
   * trusting the caller purely because CustomerPortalService already ran
   * InvoicesService.findByIdForCustomer — the same "re-validate, don't
   * just trust an upstream check" discipline recordPayment above already
   * follows.
   *
   * At most one payable online session exists per invoice at a time: any
   * still-PENDING session for this invoice is actively expired via the
   * Stripe API (StripeService.expireCheckoutSession) and marked FAILED
   * locally before the new one is created. Without this, a customer who
   * opens the portal in two tabs (or double-clicks Pay Now) could
   * complete two independent Stripe checkouts for the same balance — two
   * real charges, not a duplicate-webhook problem idempotency alone can
   * catch, since they'd be two genuinely different, genuinely completed
   * sessions.
   */
  async createOnlineCheckoutSession(
    tenantId: string,
    invoiceId: string,
    urls: { successUrl: string; cancelUrl: string },
  ): Promise<CreateCheckoutSessionResponse> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (!PAYABLE_STATUSES.has(invoice.status)) {
      throw new BadRequestException('This invoice is not currently payable online');
    }

    const balance = invoice.total.minus(invoice.amountPaid);
    if (!balance.greaterThan(0)) {
      throw new BadRequestException('This invoice has no remaining balance to pay');
    }

    const priorPending = await this.prisma.payment.findFirst({
      where: { tenantId, invoiceId, source: PaymentSource.ONLINE, status: PaymentStatus.PENDING },
    });
    if (priorPending?.providerReference) {
      await this.stripeService.expireCheckoutSession(priorPending.providerReference);
      await this.prisma.payment.update({
        where: { id: priorPending.id },
        data: { status: PaymentStatus.FAILED, notes: 'Superseded by a newer checkout session' },
      });
    }

    const session = await this.stripeService.createCheckoutSession({
      amount: toStripeAmount(balance),
      currency: invoice.currency,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    if (!session.url) {
      // Stripe always returns a url for a `mode: 'payment'` Checkout
      // Session request that succeeds; this is defensive, not an
      // expected path.
      throw new BadRequestException('Unable to start checkout — please try again');
    }

    await this.prisma.payment.create({
      data: {
        tenantId,
        invoiceId,
        customerId: invoice.customerId,
        amount: balance,
        currency: invoice.currency,
        method: PaymentMethod.CARD,
        status: PaymentStatus.PENDING,
        source: PaymentSource.ONLINE,
        provider: 'STRIPE',
        providerReference: session.id,
      },
    });

    return { url: session.url };
  }

  /**
   * Stage 3F: applies a Stripe-confirmed payment — the online-payment
   * counterpart to recordPayment's atomic amountPaid/status update, same
   * chokepoint, triggered by a verified webhook event instead of a staff
   * form submission.
   *
   * Idempotent by construction: `providerReference` is unique, so a given
   * Stripe session maps to exactly one Payment row.
   *   - Already COMPLETED: a webhook retry / dashboard resend — Stripe's
   *     "at least once" delivery guarantee means every consumer must
   *     tolerate the same event arriving more than once; this is a no-op
   *     that returns the already-applied result.
   *   - No matching row at all: safely ignored (returns null) rather than
   *     thrown — a webhook handler must never 500 just because it doesn't
   *     recognize an event's session id (e.g. a stale/misdirected event).
   *   - Not PENDING (e.g. FAILED/superseded): also safely ignored. Should
   *     be unreachable in practice since a superseded session is actively
   *     expired via the Stripe API before this can happen (see
   *     createOnlineCheckoutSession), but fail closed rather than
   *     resurrect a session this app already moved past.
   *
   * A completed Stripe session means money was actually collected — this
   * method never rejects or discards a completed charge. If applying its
   * full amount would push amountPaid past the invoice's total (a race
   * against a manual payment recorded in between session creation and
   * completion), the amount actually collected is still recorded on the
   * Payment row, but the invoice's amountPaid is clamped to its total —
   * this schema has no credit-balance/overpayment concept anywhere (the
   * exact same documented limitation recordPayment's own doc comment
   * already carries). Reconciling that discrepancy is a manual/staff
   * task; refunds are out of scope for this stage.
   */
  async completeOnlinePayment(providerReference: string, paidAt: Date): Promise<PaymentSummary | null> {
    const payment = await this.prisma.payment.findUnique({ where: { providerReference } });
    if (!payment) {
      this.logger.warn(`Stripe webhook for unknown session ${providerReference} — ignoring`);
      return null;
    }
    if (payment.status === PaymentStatus.COMPLETED) {
      return this.toSummary(payment);
    }
    if (payment.status !== PaymentStatus.PENDING) {
      this.logger.warn(`Stripe webhook for session ${providerReference} in unexpected status ${payment.status} — ignoring`);
      return null;
    }

    const completed = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
      const rawNewAmountPaid = invoice.amountPaid.plus(payment.amount);
      const newAmountPaid = rawNewAmountPaid.greaterThan(invoice.total) ? invoice.total : rawNewAmountPaid;
      const newStatus = newAmountPaid.equals(invoice.total) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.COMPLETED, paidAt },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid: newAmountPaid, status: newStatus },
      });
      return updatedPayment;
    });

    // Stage 3H: only reached on an actual PENDING -> COMPLETED transition
    // (the early returns above cover the already-completed/unknown/
    // unexpected-status cases) — see ShipmentsService.createTrackingEvent's
    // identical comment on awaiting this safely.
    await this.notificationsService.firePaymentReceived(completed.tenantId, completed.id);

    return this.toSummary(completed);
  }

  private toListItem(payment: PaymentWithDisplayFields): PaymentListItem {
    return {
      ...this.toSummary(payment),
      invoiceNumber: payment.invoice.invoiceNumber,
      customerName: `${payment.customer.firstName} ${payment.customer.lastName}`,
    };
  }

  private toSummary(payment: Prisma.PaymentGetPayload<object>): PaymentSummary {
    return {
      id: payment.id,
      tenantId: payment.tenantId,
      invoiceId: payment.invoiceId,
      customerId: payment.customerId,
      amount: formatMoney(payment.amount),
      currency: payment.currency,
      method: payment.method as unknown as PaymentSummary['method'],
      status: payment.status as unknown as PaymentSummary['status'],
      source: payment.source as unknown as PaymentSummary['source'],
      provider: payment.provider,
      referenceNumber: payment.referenceNumber,
      notes: payment.notes,
      paidAt: payment.paidAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
