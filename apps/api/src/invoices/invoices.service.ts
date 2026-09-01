import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import type { InvoiceDetail, InvoiceItemSummary, InvoiceSummary } from '@transatlantic/shared';
import { assertWithinMoneyRange, formatMoney } from '../common/money/money.util';
import { generateInvoiceNumber } from '../common/numbering/numbering.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

const DISPLAY_INCLUDE = {
  customer: { select: { firstName: true, lastName: true } },
  shipment: { select: { trackingNumber: true } },
} as const;

type InvoiceWithDisplayFields = Prisma.InvoiceGetPayload<{ include: typeof DISPLAY_INCLUDE }>;
type InvoiceWithItems = Prisma.InvoiceGetPayload<{ include: typeof DISPLAY_INCLUDE & { items: true } }>;

/**
 * Stage 3A: the backend invoice foundation. Every method takes tenantId
 * as an explicit first parameter (sourced by the controller from the
 * caller's verified JWT, never from a route param or body) and includes
 * it directly in every Prisma `where` clause — the same per-query scoping
 * convention every other service in this codebase follows. `create()`
 * additionally validates that both the referenced customer AND shipment
 * belong to that tenant, and that the shipment specifically belongs to
 * the referenced customer — never just "some customer in this tenant" —
 * so an invoice can never be created against another customer's shipment,
 * even by a legitimate staff member operating within their own tenant.
 *
 * No payment recording, no online payment, no rate/pricing engine — all
 * out of scope for this stage (see Stage 3B+).
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    filters: { customerId?: string; shipmentId?: string; status?: InvoiceStatus },
  ): Promise<InvoiceSummary[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.shipmentId ? { shipmentId: filters.shipmentId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: DISPLAY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map((invoice) => this.toSummary(invoice));
  }

  async findById(tenantId: string, id: string): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: { ...DISPLAY_INCLUDE, items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return this.toDetail(invoice);
  }

  /**
   * Creates a DRAFT invoice with its line items in one transaction,
   * computing subtotal/tax/total with Prisma.Decimal arithmetic
   * throughout — never a JS number/float — so e.g. three $0.10 items sum
   * to exactly "0.30", not a floating-point artifact like
   * "0.30000000000000004".
   */
  async create(tenantId: string, dto: CreateInvoiceDto): Promise<InvoiceDetail> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // The shipment must belong to THIS tenant AND to THIS specific
    // customer — not merely "some customer in the tenant" — otherwise a
    // staff member could (accidentally or otherwise) invoice one customer
    // for another customer's shipment.
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: dto.shipmentId, tenantId, customerId: dto.customerId },
    });
    if (!shipment) {
      throw new NotFoundException('Shipment not found for this customer');
    }

    const items = dto.items.map((item) => {
      const quantity = item.quantity ?? 1;
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const amount = unitPrice.times(quantity);
      assertWithinMoneyRange(amount, 'Item amount');
      return { description: item.description, quantity, unitPrice, amount };
    });
    const subtotal = items.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    const tax = new Prisma.Decimal(dto.tax ?? 0);
    const total = subtotal.plus(tax);
    // Checked before any DB write — a value this large would otherwise
    // fail at the Postgres INSERT itself (Decimal(12,2) overflow), surfacing
    // as an unhandled 500 instead of a clean 400.
    assertWithinMoneyRange(subtotal, 'Invoice subtotal');
    assertWithinMoneyRange(total, 'Invoice total');

    // Sequence generation is its own atomic step, deliberately outside the
    // transaction below — matches generateTrackingNumber's own reasoning
    // (ShipmentsService.create): a crash between the two would only ever
    // leave a harmless gap in the sequence, never a duplicate invoice
    // number.
    const invoiceNumber = await generateInvoiceNumber(this.prisma, tenantId);

    const invoiceId = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          customerId: dto.customerId,
          shipmentId: dto.shipmentId,
          invoiceNumber,
          status: InvoiceStatus.DRAFT,
          subtotal,
          tax,
          total,
          amountPaid: new Prisma.Decimal(0),
          currency: dto.currency,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
      });

      for (const item of items) {
        await tx.invoiceItem.create({
          data: {
            tenantId,
            invoiceId: invoice.id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
          },
        });
      }

      return invoice.id;
    });

    return this.findById(tenantId, invoiceId);
  }

  /** DRAFT -> SENT, stamping issuedAt. This is the transition that will make an invoice visible to the customer portal in a later stage — a DRAFT invoice is a staff-only working copy. */
  async issue(tenantId: string, id: string): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, tenantId } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only draft invoices can be issued');
    }

    await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.SENT, issuedAt: new Date() },
    });

    return this.findById(tenantId, id);
  }

  private toSummary(invoice: InvoiceWithDisplayFields): InvoiceSummary {
    return {
      id: invoice.id,
      tenantId: invoice.tenantId,
      customerId: invoice.customerId,
      customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
      shipmentId: invoice.shipmentId,
      shipmentTrackingNumber: invoice.shipment?.trackingNumber ?? null,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status as unknown as InvoiceSummary['status'],
      subtotal: formatMoney(invoice.subtotal),
      tax: formatMoney(invoice.tax),
      total: formatMoney(invoice.total),
      amountPaid: formatMoney(invoice.amountPaid),
      balanceDue: formatMoney(invoice.total.minus(invoice.amountPaid)),
      currency: invoice.currency,
      dueDate: invoice.dueDate?.toISOString() ?? null,
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    };
  }

  private toDetail(invoice: InvoiceWithItems): InvoiceDetail {
    const items: InvoiceItemSummary[] = invoice.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: formatMoney(item.unitPrice),
      amount: formatMoney(item.amount),
    }));
    return { ...this.toSummary(invoice), items };
  }
}
