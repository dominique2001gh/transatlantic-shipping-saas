import { Injectable, NotFoundException } from '@nestjs/common';
import type { ShipmentStatus as DbShipmentStatus } from '@prisma/client';
import type { PublicTrackingItemSummary, PublicTrackingMilestone, PublicTrackingResult } from '@transatlantic/shared';
import { ITEM_STATUS_MILESTONES, SHIPMENT_STATUS_MILESTONES } from '@transatlantic/shared';
import type { ShipmentItemType as SharedShipmentItemType } from '@transatlantic/shared';
// The Prisma-generated ShipmentStatus/ShipmentItemStatus enums (imported
// above as types, and implicitly on every Prisma query result below) are
// the same string values as the hand-maintained shared enums
// SHIPMENT_STATUS_MILESTONES/ITEM_STATUS_MILESTONES are keyed by, but a
// structurally distinct TypeScript type — same split this codebase
// already establishes in warehouse.service.ts's own import block. Casting
// through the shared enum type at the single lookup point (rather than
// importing a second aliased copy of the Prisma enums) is the smallest
// correct way to bridge the two here, since this service never compares
// or branches on the Prisma enum itself, only projects it through the
// shared label map.
import type { ShipmentStatus as SharedShipmentStatus, ShipmentItemStatus as SharedShipmentItemStatus } from '@transatlantic/shared';
import { ITEM_TERMINAL_HANDOFF } from '../warehouse/warehouse.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Stage 2A: the customer-safe projection consumed by the public tracking
 * lookup (and, later, the authenticated customer portal — same service,
 * same projection, a different, tenant/customer-scoped caller). Reads
 * only from the existing Shipment/ShipmentItem/TrackingEvent tables — no
 * parallel tracking model, no re-derivation of state. Every field this
 * returns is either copied verbatim from a small, deliberately-safe
 * allowlist (trackingNumber, originCountry, destinationCountry, itemCode,
 * itemType, item description, createdAt/occurredAt timestamps, a
 * warehouse's city/country) or produced by mapping an existing status/
 * eventType through the curated label tables in
 * packages/shared/tracking-milestones.ts. It never returns a raw
 * TrackingEvent row, its notes, its metadata, any user/staff identity, or
 * declaredValue.
 */
@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `tenantSlug` is required and not defaulted to "the only tenant that
   * currently exists" — this stays honestly multi-tenant-shaped even
   * though only one tenant exists today (see the Stage 2 investigation's
   * note that no domain-based tenant resolution exists yet; Stage 2B is
   * where the public website will start supplying its own slug).
   *
   * Every failure path — unknown tenant, unknown tracking number, wrong
   * last name — throws the exact same generic NotFoundException. This
   * mirrors assertTenantAccess's existing "404, not 403, never confirm a
   * resource exists" posture elsewhere in this codebase, extended here to
   * also cover "does this tracking number belong to a different
   * customer" — the point is that a wrong guess can never distinguish
   * "no such shipment" from "wrong last name" from "wrong tenant."
   */
  async lookupPublic(rawTenantSlug: string, rawTrackingNumber: string, rawLastName: string): Promise<PublicTrackingResult> {
    const tenantSlug = rawTenantSlug?.trim();
    const trackingNumber = rawTrackingNumber?.trim();
    const lastName = rawLastName?.trim();

    const notFound = () =>
      new NotFoundException('No matching shipment found. Double-check your tracking number and last name.');

    if (!tenantSlug || !trackingNumber || !lastName) {
      throw notFound();
    }

    const tenant = await this.prisma.tenant.findFirst({ where: { slug: tenantSlug, isActive: true } });
    if (!tenant) {
      throw notFound();
    }

    const shipment = await this.prisma.shipment.findFirst({
      where: { tenantId: tenant.id, trackingNumber },
      include: {
        customer: { select: { lastName: true } },
        items: { orderBy: { sequenceNumber: 'asc' } },
      },
    });
    if (!shipment || shipment.customer.lastName.trim().toLowerCase() !== lastName.toLowerCase()) {
      throw notFound();
    }

    const timeline = await this.buildShipmentTimeline(tenant.id, shipment.id);

    const items: PublicTrackingItemSummary[] = await Promise.all(
      shipment.items.map(async (item) => {
        const lastEvent = await this.prisma.trackingEvent.findFirst({
          where: { tenantId: tenant.id, shipmentItemId: item.id },
          orderBy: { occurredAt: 'desc' },
          select: { occurredAt: true },
        });
        const milestone = ITEM_STATUS_MILESTONES[item.status as unknown as SharedShipmentItemStatus];
        return {
          itemCode: item.itemCode,
          itemType: item.itemType as unknown as SharedShipmentItemType,
          description: item.description,
          milestone: {
            label: milestone?.label ?? item.status,
            occurredAt: lastEvent?.occurredAt.toISOString() ?? null,
          },
        };
      }),
    );

    const completedCount = shipment.items.filter((item) => ITEM_TERMINAL_HANDOFF.includes(item.status)).length;
    const overallMilestone = SHIPMENT_STATUS_MILESTONES[shipment.status as unknown as SharedShipmentStatus];

    return {
      trackingNumber: shipment.trackingNumber,
      originCountry: shipment.originCountry,
      destinationCountry: shipment.destinationCountry,
      createdAt: shipment.createdAt.toISOString(),
      overallMilestone: {
        label: overallMilestone?.label ?? shipment.status,
        occurredAt: timeline.length > 0 ? timeline[timeline.length - 1].occurredAt : null,
      },
      isCompleted: (shipment.status as unknown as DbShipmentStatus) === 'COMPLETED',
      itemSummary: { total: shipment.items.length, completed: completedCount },
      timeline,
      items,
    };
  }

  /**
   * Builds the shipment-level milestone timeline from the same
   * SYSTEM-sourced rollup TrackingEvent rows every prior milestone
   * already writes (see ManifestsService.maybeRollupShipmentArrival,
   * WarehouseService.maybeRollupShipmentCompletion, etc.) — these already
   * mean "every applicable item reached at least this stage," which is
   * exactly the semantic a shipment-level customer timeline needs.
   * Deduplicates by *label*, not by raw status, so several internal
   * sub-stages that share one customer-facing phrase (e.g.
   * READY_FOR_CONSOLIDATION/CONSOLIDATED/LOADED, which all mean
   * "Prepared for shipment" to a customer) collapse into a single
   * timeline entry at whichever was reached first — a customer sees one
   * clean progression, not three near-identical rows seconds apart.
   */
  private async buildShipmentTimeline(tenantId: string, shipmentId: string): Promise<PublicTrackingMilestone[]> {
    const events = await this.prisma.trackingEvent.findMany({
      where: { tenantId, shipmentId, shipmentItemId: null, status: { not: null } },
      orderBy: { occurredAt: 'asc' },
      include: { warehouse: { select: { city: true, country: true } } },
    });

    const timeline: PublicTrackingMilestone[] = [];
    const seenLabels = new Set<string>();
    for (const event of events) {
      if (!event.status) continue;
      const milestone = SHIPMENT_STATUS_MILESTONES[event.status as unknown as SharedShipmentStatus];
      if (!milestone || seenLabels.has(milestone.label)) continue;
      seenLabels.add(milestone.label);
      timeline.push({
        label: milestone.label,
        occurredAt: event.occurredAt.toISOString(),
        location: event.warehouse ? `${event.warehouse.city}, ${event.warehouse.country}` : null,
      });
    }
    return timeline;
  }
}
