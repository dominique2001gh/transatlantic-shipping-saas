import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import type { PaymentListItem, PaymentSummary } from '@transatlantic/shared';
import { formatMoney } from '../common/money/money.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

const PAYMENT_LIST_INCLUDE = {
  invoice: { select: { invoiceNumber: true } },
  customer: { select: { firstName: true, lastName: true } },
} as const;

type PaymentWithDisplayFields = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_LIST_INCLUDE }>;

/** Invoice statuses that can still legitimately receive a payment. DRAFT (never issued), VOID, and PAID are all rejected explicitly below with a specific message, rather than only being caught incidentally by the overpayment check. */
const PAYABLE_STATUSES = new Set<InvoiceStatus>([
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
]);

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
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.toSummary(payment);
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
      referenceNumber: payment.referenceNumber,
      notes: payment.notes,
      paidAt: payment.paidAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
