import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PreRegistrationStatus } from '@prisma/client';
import { generatePreRegistrationNumber } from '../common/numbering/numbering.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePreRegistrationDto } from './dto/create-pre-registration.dto';
import { UpdatePreRegistrationDto } from './dto/update-pre-registration.dto';

/** Statuses from which a customer may still cancel — DRAFT (never submitted) or SUBMITTED (awaiting staff). Once CONVERTED/CANCELLED/EXPIRED, cancelling again is a no-op-that-should-never-happen, not a silent success. */
const CANCELLABLE_STATUSES: PreRegistrationStatus[] = [PreRegistrationStatus.DRAFT, PreRegistrationStatus.SUBMITTED];

/** Fields a staff-facing read exposes about the submitting customer — same shape/purpose as CustomersService's DUPLICATE_MATCH_SELECT: enough to identify who this is without pulling their full record. */
const STAFF_CUSTOMER_SELECT = {
  id: true,
  customerNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} as const;

/**
 * Customer Self-Service Pre-Registration, Stage 1 — backend/data foundation
 * only. See ShipmentPreRegistration's own schema doc comment for why this
 * is a fully separate table from Shipment/ShipmentItem, never reused.
 *
 * Every method here is tenant-scoped (and, for customer-facing methods,
 * also customer-scoped) by construction — the same requireTenantId()/
 * requireCustomerId()-then-thread-through convention as every other module,
 * enforced again at the query level via `where: { tenantId, ... }` (and
 * `customerId` where applicable) on every single Prisma call, never derived
 * from a route param or request body.
 *
 * Stage 1 deliberately does NOT implement conversion into Quick Receive —
 * no method here ever creates a Shipment/ShipmentItem, writes a
 * TrackingEvent, or touches Container/Manifest/Invoice/Payment/analytics.
 * `convertedShipmentId` exists on the model as a structural placeholder a
 * later stage will write to exactly once; nothing in this file reads or
 * writes it.
 */
@Injectable()
export class PreRegistrationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a DRAFT. All fields optional by design (see
   * CreatePreRegistrationDto) — a customer may start with nothing but the
   * intent to prepare a drop-off and fill in details over time via
   * update(). No referenceNumber is assigned yet (see this model's schema
   * doc comment on why that's deferred to submit()).
   */
  async create(tenantId: string, customerId: string, dto: CreatePreRegistrationDto) {
    // Defense in depth: customerId always arrives here already derived from
    // the caller's own verified JWT (never a request param/body), but this
    // still confirms the linked Customer row itself is this tenant's, the
    // same posture every other tenant-scoped write in this codebase takes
    // before trusting a foreign key.
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return this.prisma.shipmentPreRegistration.create({
      data: {
        tenantId,
        customerId,
        status: PreRegistrationStatus.DRAFT,
        ...dto,
      },
    });
  }

  /**
   * Partial update — DRAFT only. Stage 1 deliberately does not extend
   * editing to SUBMITTED (unlike the broader "portal editing" pattern
   * elsewhere in this app): the audit's own recommendation left this open
   * for a later stage; this Stage 1 implementation takes the stricter,
   * simpler invariant on purpose. Loosening it later (if wanted) is a
   * one-line change to this guard, not a redesign.
   */
  async update(tenantId: string, customerId: string, id: string, dto: UpdatePreRegistrationDto) {
    const record = await this.findOwnedOrThrow(tenantId, customerId, id);
    if (record.status !== PreRegistrationStatus.DRAFT) {
      throw new ConflictException(
        `This pre-registration is ${record.status} and can no longer be edited. Only a DRAFT can be edited.`,
      );
    }
    return this.prisma.shipmentPreRegistration.update({ where: { id: record.id }, data: { ...dto } });
  }

  /**
   * DRAFT -> SUBMITTED only. This is the one place referenceNumber is ever
   * assigned — see generatePreRegistrationNumber's own doc comment for the
   * concurrency-safe atomic-increment mechanism (identical pattern to
   * tracking/customer/invoice/manifest number generation, own dedicated
   * TenantSettings counter/prefix pair, own namespace).
   */
  async submit(tenantId: string, customerId: string, id: string) {
    const record = await this.findOwnedOrThrow(tenantId, customerId, id);
    if (record.status !== PreRegistrationStatus.DRAFT) {
      throw new ConflictException(
        `This pre-registration is ${record.status} and cannot be submitted. Only a DRAFT can be submitted.`,
      );
    }
    const referenceNumber = await generatePreRegistrationNumber(this.prisma, tenantId);
    return this.prisma.shipmentPreRegistration.update({
      where: { id: record.id },
      data: { status: PreRegistrationStatus.SUBMITTED, referenceNumber, submittedAt: new Date() },
    });
  }

  /** DRAFT or SUBMITTED -> CANCELLED. Already-terminal (CONVERTED/CANCELLED/EXPIRED) rejects rather than silently no-op-ing, so a customer can never be misled into thinking a stale cancel request did something. */
  async cancel(tenantId: string, customerId: string, id: string) {
    const record = await this.findOwnedOrThrow(tenantId, customerId, id);
    if (!CANCELLABLE_STATUSES.includes(record.status)) {
      throw new ConflictException(`This pre-registration is already ${record.status} and cannot be cancelled.`);
    }
    return this.prisma.shipmentPreRegistration.update({
      where: { id: record.id },
      data: { status: PreRegistrationStatus.CANCELLED, cancelledAt: new Date() },
    });
  }

  async findOneForCustomer(tenantId: string, customerId: string, id: string) {
    return this.findOwnedOrThrow(tenantId, customerId, id);
  }

  async listForCustomer(tenantId: string, customerId: string) {
    return this.prisma.shipmentPreRegistration.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Tenant+customer-scoped lookup shared by every customer-facing method
   * above. A record belonging to another customer (even within the same
   * tenant) or another tenant entirely produces the identical 404 — never
   * confirms existence either way, same posture as
   * assertTenantAccess()/TrackingService's customer-scoped lookups
   * elsewhere in this codebase.
   */
  private async findOwnedOrThrow(tenantId: string, customerId: string, id: string) {
    const record = await this.prisma.shipmentPreRegistration.findFirst({ where: { id, tenantId, customerId } });
    if (!record) {
      throw new NotFoundException('Pre-registration not found');
    }
    return record;
  }

  // ---------------------------------------------------------------------
  // Staff-facing (tenant-scoped only — never customer-scoped, since staff
  // must be able to find any customer's pre-registration within their own
  // tenant, but never another tenant's). Read-only in Stage 1: no method
  // here mutates a record — the Quick Receive conversion step that will
  // eventually call cancel-adjacent write logic is explicitly a later
  // stage, per this file's own top doc comment.
  // ---------------------------------------------------------------------

  /**
   * Exact-reference resolution for the future Quick Receive scan fast path
   * — same shape and same anti-enumeration posture as
   * WarehouseService.resolveScan: "no such reference" and "belongs to
   * another tenant" are indistinguishable, both a plain 404.
   */
  async findByReferenceForStaff(tenantId: string, rawReference: string) {
    const referenceNumber = rawReference.trim();
    if (!referenceNumber) {
      throw new BadRequestException('Enter or scan a reference.');
    }
    const record = await this.prisma.shipmentPreRegistration.findFirst({
      where: { tenantId, referenceNumber },
      include: { customer: { select: STAFF_CUSTOMER_SELECT } },
    });
    if (!record) {
      throw new NotFoundException('No pre-registration found for this reference.');
    }
    return record;
  }

  /** Manual fallback mirroring WarehouseService.searchItems's shape: reference, or the submitting customer's name/phone/customer number, partial match, tenant-scoped. */
  async searchForStaff(tenantId: string, rawQuery: string) {
    const query = rawQuery.trim();
    if (!query) {
      return [];
    }
    return this.prisma.shipmentPreRegistration.findMany({
      where: {
        tenantId,
        OR: [
          { referenceNumber: { contains: query, mode: 'insensitive' } },
          { customer: { firstName: { contains: query, mode: 'insensitive' } } },
          { customer: { lastName: { contains: query, mode: 'insensitive' } } },
          { customer: { phone: { contains: query, mode: 'insensitive' } } },
          { customer: { customerNumber: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: { customer: { select: STAFF_CUSTOMER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  }

  /** "Select it from pending pre-registrations" — every SUBMITTED (i.e. awaiting staff) record for this tenant, oldest first. */
  async listPendingForStaff(tenantId: string) {
    return this.prisma.shipmentPreRegistration.findMany({
      where: { tenantId, status: PreRegistrationStatus.SUBMITTED },
      include: { customer: { select: STAFF_CUSTOMER_SELECT } },
      orderBy: { submittedAt: 'asc' },
    });
  }

  async findOneForStaff(tenantId: string, id: string) {
    const record = await this.prisma.shipmentPreRegistration.findFirst({
      where: { id, tenantId },
      include: { customer: { select: STAFF_CUSTOMER_SELECT } },
    });
    if (!record) {
      throw new NotFoundException('Pre-registration not found');
    }
    return record;
  }
}
