import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateCustomerNumber } from '../common/numbering/numbering.util';
import { writeTenantAuditLog } from '../common/tenant/tenant-audit.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const DUPLICATE_MATCH_SELECT = {
  id: true,
  customerNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Customer Management Phase 3: `archived` defaults to showing only
   * active customers (archivedAt: null) — archived customers only appear
   * when the caller explicitly asks for them (`archived: true`), never
   * mixed into the default list. There is no "both" mode: the Archived
   * filter on the Customers page is a toggle, not an additive view.
   */
  findAll(tenantId: string, search?: string, archived?: boolean) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        archivedAt: archived ? { not: null } : null,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { customerNumber: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        addresses: true,
        shipments: {
          orderBy: { createdAt: 'desc' },
          include: { items: { select: { id: true, receivedAt: true } } },
        },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  /**
   * Creates a customer with a server-generated, tenant-sequential
   * customerNumber. Before inserting, checks this tenant (never another
   * tenant's data — see DUPLICATE_MATCH_SELECT's query below) for an
   * existing customer sharing the same email (case-insensitive exact
   * match) or the same phone (exact match). A hit 409s with the matches
   * instead of silently creating or silently merging — this is a warning,
   * not a hard block: `dto.confirmDuplicate` lets a caller who has looked
   * at the matches and confirmed this is genuinely a different person
   * proceed anyway. Deliberately no fuzzy name matching — two unrelated
   * customers who happen to share a common name must never be blocked
   * from both existing.
   */
  async create(tenantId: string, dto: CreateCustomerDto) {
    const { confirmDuplicate, ...customerFields } = dto;
    if (!confirmDuplicate) {
      const duplicates = await this.prisma.customer.findMany({
        where: {
          tenantId,
          OR: [
            { email: { equals: dto.email, mode: 'insensitive' } },
            ...(dto.phone?.trim() ? [{ phone: dto.phone.trim() }] : []),
          ],
        },
        select: DUPLICATE_MATCH_SELECT,
      });
      if (duplicates.length > 0) {
        throw new ConflictException({
          message: 'A customer with this email or phone number already exists.',
          duplicates,
        });
      }
    }

    const customerNumber = await generateCustomerNumber(this.prisma, tenantId);
    return this.prisma.customer.create({
      data: { tenantId, customerNumber, ...customerFields },
    });
  }

  async update(tenantId: string, actorUserId: string, id: string, dto: UpdateCustomerDto) {
    const existing = await this.findById(tenantId, id); // 404s if missing or belongs to another tenant
    const fields = Object.keys(dto) as (keyof UpdateCustomerDto)[];
    const before = Object.fromEntries(fields.map((f) => [f, existing[f as keyof typeof existing]]));

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({ where: { id }, data: dto });
      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'CUSTOMER_UPDATED',
        metadata: { customerId: id, before, after: Object.fromEntries(fields.map((f) => [f, dto[f]])), fields },
      });
      return updated;
    });
  }

  /**
   * Customer Management Phase 3: archive is the default removal option —
   * see this feature's own spec requirement. Reversible; every
   * shipment/payment/invoice/warehouse/audit relation is untouched.
   */
  async archive(tenantId: string, actorUserId: string, id: string) {
    const existing = await this.findById(tenantId, id);
    if (existing.archivedAt) {
      return existing;
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: { archivedAt: new Date(), archivedByUserId: actorUserId },
      });
      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'CUSTOMER_ARCHIVED',
        metadata: { customerId: id, customerNumber: existing.customerNumber },
      });
      return updated;
    });
  }

  async restore(tenantId: string, actorUserId: string, id: string) {
    const existing = await this.findById(tenantId, id);
    if (!existing.archivedAt) {
      return existing;
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: { archivedAt: null, archivedByUserId: null },
      });
      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'CUSTOMER_RESTORED',
        metadata: { customerId: id, customerNumber: existing.customerNumber },
      });
      return updated;
    });
  }

  /**
   * Hard delete — only ever safe for a customer with zero operational or
   * financial history, per this feature's own spec requirement
   * ("prevent deletion of customers with active receiving records or
   * shipments" / "do not allow permanent deletion of customers with
   * linked operational or financial history"). Every other case must use
   * archive() instead; this throws rather than silently archiving on the
   * caller's behalf, so the 409 message is the actual feedback the UI
   * surfaces.
   */
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.findById(tenantId, id);

    const [shipments, receivingRecords, invoices, payments, documents] = await Promise.all([
      this.prisma.shipment.count({ where: { tenantId, customerId: id } }),
      this.prisma.receivingRecord.count({ where: { tenantId, customerId: id } }),
      this.prisma.invoice.count({ where: { tenantId, customerId: id } }),
      this.prisma.payment.count({ where: { tenantId, customerId: id } }),
      this.prisma.document.count({ where: { tenantId, customerId: id } }),
    ]);
    const linkedCounts = { shipments, receivingRecords, invoices, payments, documents };
    if (Object.values(linkedCounts).some((count) => count > 0)) {
      throw new ConflictException({
        message: 'This customer has shipments, receiving records, invoices, payments, or documents on file and cannot be deleted. Archive instead.',
        linkedCounts,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.delete({ where: { id } });
      await writeTenantAuditLog(tx, {
        tenantId,
        actorUserId,
        targetUserId: null,
        action: 'CUSTOMER_DELETED',
        metadata: { customerId: id, customerNumber: existing.customerNumber, email: existing.email },
      });
    });
  }
}
