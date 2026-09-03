import { Injectable } from '@nestjs/common';
import { Prisma, ContainerStatus, InvoiceStatus, ShipmentStatus, ShipmentItemStatus, TrackingEventType, HandoffType } from '@prisma/client';
import type {
  AnalyticsAlertsResponse,
  AnalyticsCustomersResponse,
  AnalyticsDestinationsResponse,
  AnalyticsExceptionsResponse,
  AnalyticsOperationsResponse,
  AnalyticsOverviewResponse,
  AnalyticsRevenueResponse,
  CurrencyAmount,
  OutstandingAgingBucket,
} from '@transatlantic/shared';
import { formatMoney } from '../common/money/money.util';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

const DEFAULT_RANGE_DAYS = 30;
/** How many days an unresolved OperationalException must sit before it counts as "stale" on the alerts strip. */
const STALE_EXCEPTION_THRESHOLD_DAYS = 7;
/** Shipment statuses that never resolve further — used identically to Stage 3J's customer-portal "isActiveShipment" heuristic, kept as its own small copy here rather than reaching into apps/web (this is a backend, server-side equivalent). */
const TERMINAL_SHIPMENT_STATUSES: ShipmentStatus[] = [ShipmentStatus.COMPLETED, ShipmentStatus.CANCELLED];
const ITEM_TERMINAL_HANDOFF: ShipmentItemStatus[] = [ShipmentItemStatus.PICKED_UP, ShipmentItemStatus.DELIVERED];
/** Payable-ish invoice statuses for "open invoices"/"outstanding" purposes — includes OVERDUE defensively even though nothing in this codebase currently ever sets it (see this class's own doc comment). */
const OPEN_INVOICE_STATUSES: InvoiceStatus[] = [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];
/** TrackingEvent types that represent an item physically leaving a warehouse — used to compute warehouse dwell time. */
const WAREHOUSE_DEPARTURE_EVENT_TYPES: TrackingEventType[] = [
  TrackingEventType.DEPARTED_ORIGIN,
  TrackingEventType.OUT_FOR_DELIVERY,
  TrackingEventType.PICKED_UP,
  TrackingEventType.ASSIGNED_TO_CONTAINER,
  TrackingEventType.ASSIGNED_TO_MANIFEST,
];

/**
 * Stage 4: read-only aggregation service behind the Owner/Manager
 * Analytics dashboard (/dashboard/reports) and the Dashboard Overview
 * tiles. Every method takes `tenantId` as its first parameter, sourced by
 * AnalyticsController from the caller's verified JWT exactly like every
 * other service in this codebase — never a query param — and every
 * Prisma query includes it directly in its `where` clause. This is the
 * single highest-risk area of this whole module: an aggregate
 * groupBy/aggregate query is exactly the shape of query that's easy to
 * accidentally leave unscoped, so there are no shared/reusable
 * "unscoped" query builders here — each method is self-contained and
 * always includes tenantId explicitly.
 *
 * Money handling: every revenue/balance figure is grouped and returned
 * per currency (`CurrencyAmount[]`), never summed across currencies —
 * same discipline Stage 3J's customer-portal Overview established,
 * because two invoices on one tenant could in principle be issued in
 * different currencies.
 *
 * `InvoiceStatus.OVERDUE` is a real enum value but nothing in this
 * codebase ever transitions an invoice to it (confirmed by inspection —
 * no write path exists anywhere). Every "overdue/outstanding" figure in
 * this service is therefore computed LIVE from `dueDate < now()`, never
 * from the stored `status` column.
 *
 * No scheduled/materialized-rollup infrastructure exists in this
 * codebase (no @nestjs/schedule usage anywhere) — every figure here is
 * computed live at request time. Acceptable at this data scale; a future
 * stage could add caching if query latency ever actually becomes a
 * problem.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------
  // /analytics/overview — open to all DASHBOARD_ROLES, no financial data
  // -----------------------------------------------------------------

  async getOverview(tenantId: string): Promise<AnalyticsOverviewResponse> {
    const [activeShipments, totalCustomers, openInvoices, containersInTransit] = await Promise.all([
      this.prisma.shipment.count({ where: { tenantId, status: { notIn: TERMINAL_SHIPMENT_STATUSES } } }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.invoice.count({ where: { tenantId, status: { in: OPEN_INVOICE_STATUSES } } }),
      // "In transit" here covers both DEPARTED (just left) and IN_TRANSIT
      // (mid-voyage) — both read to an owner as "on the way," not just the
      // single literal IN_TRANSIT status value.
      this.prisma.container.count({
        where: { tenantId, status: { in: [ContainerStatus.DEPARTED, ContainerStatus.IN_TRANSIT] } },
      }),
    ]);
    return { activeShipments, totalCustomers, openInvoices, containersInTransit };
  }

  // -----------------------------------------------------------------
  // /analytics/alerts — "needs attention now," deliberately NOT scoped
  // by any date range (see AnalyticsAlertsResponse's own doc comment)
  // -----------------------------------------------------------------

  async getAlerts(tenantId: string): Promise<AnalyticsAlertsResponse> {
    const now = new Date();

    const overdueInvoices = await this.prisma.invoice.findMany({
      where: { tenantId, status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] }, dueDate: { lt: now } },
      select: { total: true, amountPaid: true, currency: true },
    });
    const overdueBalances = overdueInvoices
      .map((inv) => ({ currency: inv.currency, amount: inv.total.minus(inv.amountPaid) }))
      .filter((row) => row.amount.greaterThan(0));

    const staleExceptions = await this.prisma.operationalException.count({
      where: {
        tenantId,
        resolvedAt: null,
        createdAt: { lt: new Date(now.getTime() - STALE_EXCEPTION_THRESHOLD_DAYS * 24 * 60 * 60 * 1000) },
      },
    });

    return {
      overdueInvoices: {
        count: overdueBalances.length,
        amounts: this.sumDecimalsByCurrency(overdueBalances),
      },
      staleExceptions: { count: staleExceptions, staleThresholdDays: STALE_EXCEPTION_THRESHOLD_DAYS },
    };
  }

  // -----------------------------------------------------------------
  // /analytics/revenue
  // -----------------------------------------------------------------

  async getRevenue(tenantId: string, query: AnalyticsQueryDto): Promise<AnalyticsRevenueResponse> {
    const { start, end } = this.resolveDateRange(query);

    const payments = await this.prisma.payment.findMany({
      where: { tenantId, status: 'COMPLETED', paidAt: { gte: start, lte: end } },
      select: { amount: true, currency: true, paidAt: true, method: true, source: true },
    });

    const totalRevenue = this.sumDecimalsByCurrency(payments.map((p) => ({ currency: p.currency, amount: p.amount })));

    const byMethod = new Map<string, { currency: string; amount: Prisma.Decimal }[]>();
    const bySource = new Map<string, { currency: string; amount: Prisma.Decimal }[]>();
    const byDay = new Map<string, { currency: string; amount: Prisma.Decimal }[]>();
    for (const p of payments) {
      this.pushInto(byMethod, p.method, p.currency, p.amount);
      this.pushInto(bySource, p.source, p.currency, p.amount);
      const day = (p.paidAt ?? new Date()).toISOString().slice(0, 10);
      this.pushInto(byDay, day, p.currency, p.amount);
    }

    // Outstanding balance/aging is deliberately a live snapshot, not
    // bounded by the requested date range — an owner picking "Last Month"
    // still wants to see everything currently owed, not a fictional
    // "outstanding balance as of a past month" this schema has no way to
    // reconstruct.
    const openInvoices = await this.prisma.invoice.findMany({
      where: { tenantId, status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] } },
      select: { total: true, amountPaid: true, currency: true, dueDate: true },
    });
    const outstandingRows = openInvoices
      .map((inv) => ({ currency: inv.currency, amount: inv.total.minus(inv.amountPaid), dueDate: inv.dueDate }))
      .filter((row) => row.amount.greaterThan(0));
    const outstandingBalance = this.sumDecimalsByCurrency(outstandingRows);
    const outstandingAging = this.bucketAging(outstandingRows);

    const issuedInvoices = await this.prisma.invoice.findMany({
      where: { tenantId, status: { not: InvoiceStatus.DRAFT }, issuedAt: { gte: start, lte: end } },
      select: { total: true, currency: true },
    });
    const avgInvoiceValue = this.averageDecimalsByCurrency(issuedInvoices.map((i) => ({ currency: i.currency, amount: i.total })));

    return {
      totalRevenue,
      outstandingBalance,
      avgInvoiceValue,
      revenueTrend: Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => ({ date, amounts: this.sumDecimalsByCurrency(rows) })),
      revenueByMethod: Array.from(byMethod.entries()).map(([method, rows]) => ({
        method: method as AnalyticsRevenueResponse['revenueByMethod'][number]['method'],
        amounts: this.sumDecimalsByCurrency(rows),
      })),
      revenueBySource: Array.from(bySource.entries()).map(([source, rows]) => ({
        source: source as AnalyticsRevenueResponse['revenueBySource'][number]['source'],
        amounts: this.sumDecimalsByCurrency(rows),
      })),
      outstandingAging,
    };
  }

  // -----------------------------------------------------------------
  // /analytics/operations — shipments + mode mix + warehouse + containers
  // -----------------------------------------------------------------

  async getOperations(tenantId: string, query: AnalyticsQueryDto): Promise<AnalyticsOperationsResponse> {
    const { start, end } = this.resolveDateRange(query);

    const shipments = await this.prisma.shipment.findMany({
      where: {
        tenantId,
        createdAt: { gte: start, lte: end },
        ...(query.shipmentMode ? { shipmentMode: query.shipmentMode } : {}),
        ...(query.warehouseId
          ? { OR: [{ originWarehouseId: query.warehouseId }, { destinationWarehouseId: query.warehouseId }] }
          : {}),
      },
      select: { id: true, status: true, shipmentMode: true, createdAt: true },
    });

    const modeCounts = new Map<string, number>();
    const dayCounts = new Map<string, number>();
    let completed = 0;
    let cancelled = 0;
    for (const s of shipments) {
      modeCounts.set(s.shipmentMode, (modeCounts.get(s.shipmentMode) ?? 0) + 1);
      const day = s.createdAt.toISOString().slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      if (s.status === ShipmentStatus.COMPLETED) completed += 1;
      if (s.status === ShipmentStatus.CANCELLED) cancelled += 1;
    }
    const active = shipments.filter((s) => !TERMINAL_SHIPMENT_STATUSES.includes(s.status)).length;

    // The warehouseId filter must reach every part of this response that's
    // actually about a warehouse, not just the shipments list above — a
    // section literally called "warehouse throughput" ignoring the
    // Warehouse filter would be a bug, not a design choice. Containers are
    // filtered by their own `warehouseId` (the location they were/are
    // being loaded at) for the same reason.
    const [warehouses, containers] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { tenantId, isActive: true, ...(query.warehouseId ? { id: query.warehouseId } : {}) },
        select: { id: true, name: true },
      }),
      this.prisma.container.findMany({
        where: { tenantId, createdAt: { lte: end }, ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) },
        select: {
          id: true,
          containerNumber: true,
          containerType: true,
          status: true,
          items: { where: { removedAt: null }, select: { id: true } },
        },
      }),
    ]);

    const containerStatusCounts = new Map<string, number>();
    for (const c of containers) {
      containerStatusCounts.set(c.status, (containerStatusCounts.get(c.status) ?? 0) + 1);
    }

    const warehouseThroughput = await Promise.all(
      warehouses.map((wh) => this.computeWarehouseThroughput(tenantId, wh.id, wh.name, start, end)),
    );

    return {
      totalShipments: shipments.length,
      activeShipments: active,
      completedShipments: completed,
      cancelledShipments: cancelled,
      shipmentVolumeTrend: Array.from(dayCounts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
      shipmentModeMix: Array.from(modeCounts.entries()).map(([mode, count]) => ({
        mode: mode as AnalyticsOperationsResponse['shipmentModeMix'][number]['mode'],
        count,
      })),
      warehouseThroughput,
      containerStatusBreakdown: Array.from(containerStatusCounts.entries()).map(([status, count]) => ({
        status: status as AnalyticsOperationsResponse['containerStatusBreakdown'][number]['status'],
        count,
      })),
      containerLoadingLevels: containers
        .filter((c) => c.items.length > 0)
        .map((c) => ({
          containerId: c.id,
          containerNumber: c.containerNumber,
          containerType: c.containerType as AnalyticsOperationsResponse['containerLoadingLevels'][number]['containerType'],
          status: c.status as AnalyticsOperationsResponse['containerLoadingLevels'][number]['status'],
          itemsLoaded: c.items.length,
        })),
    };
  }

  /**
   * Received/processed/dispatched counts come straight from TrackingEvent
   * rows at this warehouse in range. `avgTimeInWarehouseHours` pairs each
   * RECEIVED_AT_WAREHOUSE event with whatever TrackingEvent happened next
   * for that same item (any type — the item's actual next real-world
   * movement, not a guess at which event type "should" follow), and
   * averages the gap. Capped to the first 200 receipts in range per
   * warehouse — a per-item follow-up lookup — to keep this bounded; fine
   * at this application's current data scale, worth revisiting with a
   * single windowed query if this ever needs to scale further.
   */
  private async computeWarehouseThroughput(
    tenantId: string,
    warehouseId: string,
    warehouseName: string,
    start: Date,
    end: Date,
  ) {
    const [received, processed, dispatched] = await Promise.all([
      this.prisma.trackingEvent.count({
        where: { tenantId, warehouseId, eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE, occurredAt: { gte: start, lte: end } },
      }),
      this.prisma.trackingEvent.count({
        where: { tenantId, warehouseId, eventType: TrackingEventType.PROCESSED, occurredAt: { gte: start, lte: end } },
      }),
      this.prisma.trackingEvent.count({
        where: { tenantId, warehouseId, eventType: { in: WAREHOUSE_DEPARTURE_EVENT_TYPES }, occurredAt: { gte: start, lte: end } },
      }),
    ]);

    const receipts = await this.prisma.trackingEvent.findMany({
      where: {
        tenantId,
        warehouseId,
        eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE,
        occurredAt: { gte: start, lte: end },
        shipmentItemId: { not: null },
      },
      select: { shipmentItemId: true, occurredAt: true },
      take: 200,
    });

    const dwellHours: number[] = [];
    for (const receipt of receipts) {
      const next = await this.prisma.trackingEvent.findFirst({
        where: { tenantId, shipmentItemId: receipt.shipmentItemId, occurredAt: { gt: receipt.occurredAt } },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      });
      if (next) {
        dwellHours.push((next.occurredAt.getTime() - receipt.occurredAt.getTime()) / (60 * 60 * 1000));
      }
    }

    return {
      warehouseId,
      warehouseName,
      received,
      processed,
      dispatched,
      avgTimeInWarehouseHours: dwellHours.length > 0 ? this.round2(dwellHours.reduce((a, b) => a + b, 0) / dwellHours.length) : null,
    };
  }

  // -----------------------------------------------------------------
  // /analytics/destinations
  // -----------------------------------------------------------------

  async getDestinations(tenantId: string, query: AnalyticsQueryDto): Promise<AnalyticsDestinationsResponse> {
    const { start, end } = this.resolveDateRange(query);

    const shipments = await this.prisma.shipment.findMany({
      where: {
        tenantId,
        createdAt: { gte: start, lte: end },
        ...(query.shipmentMode ? { shipmentMode: query.shipmentMode } : {}),
        // Same warehouseId scoping as getOperations — a shipment's
        // origin/destination warehouse is exactly as "meaningfully
        // applicable" here as it is there; this section is shipment-derived
        // data too, so silently ignoring the filter would be the same bug.
        ...(query.warehouseId
          ? { OR: [{ originWarehouseId: query.warehouseId }, { destinationWarehouseId: query.warehouseId }] }
          : {}),
      },
      select: {
        id: true,
        originCountry: true,
        destinationCountry: true,
        routeId: true,
        route: { select: { name: true, transitDaysEstimate: true } },
        invoices: { where: { status: { not: InvoiceStatus.DRAFT } }, select: { total: true, currency: true } },
      },
    });

    const byDestination = new Map<
      string,
      { originCountry: string; destinationCountry: string; count: number; revenueRows: { currency: string; amount: Prisma.Decimal }[] }
    >();
    for (const s of shipments) {
      const key = `${s.originCountry}→${s.destinationCountry}`;
      const bucket = byDestination.get(key) ?? {
        originCountry: s.originCountry,
        destinationCountry: s.destinationCountry,
        count: 0,
        revenueRows: [],
      };
      bucket.count += 1;
      bucket.revenueRows.push(...s.invoices.map((i) => ({ currency: i.currency, amount: i.total })));
      byDestination.set(key, bucket);
    }
    const topDestinations = Array.from(byDestination.values())
      .sort((a, b) => b.count - a.count)
      .map((b) => ({
        originCountry: b.originCountry,
        destinationCountry: b.destinationCountry,
        shipmentCount: b.count,
        revenue: this.sumDecimalsByCurrency(b.revenueRows),
      }));

    const [deliveries, returns] = await Promise.all([
      this.prisma.pickupDeliveryRecord.count({
        where: { tenantId, type: { in: [HandoffType.PICKUP, HandoffType.DELIVERY] }, handledAt: { gte: start, lte: end } },
      }),
      this.prisma.trackingEvent.count({
        where: { tenantId, eventType: TrackingEventType.RETURNED_TO_WAREHOUSE, occurredAt: { gte: start, lte: end } },
      }),
    ]);
    const deliverySuccessRate = deliveries + returns > 0 ? this.round2((deliveries / (deliveries + returns)) * 100) : null;

    // Shipment-level DEPARTED_ORIGIN -> ARRIVED_DESTINATION pairs give
    // actual transit time; only shipments with both events in range count.
    const transitEvents = await this.prisma.trackingEvent.findMany({
      where: {
        tenantId,
        shipmentItemId: null,
        eventType: { in: [TrackingEventType.DEPARTED_ORIGIN, TrackingEventType.ARRIVED_DESTINATION] },
        occurredAt: { gte: start, lte: end },
      },
      select: { shipmentId: true, eventType: true, occurredAt: true },
    });
    const departedByShipment = new Map<string, Date>();
    const arrivedByShipment = new Map<string, Date>();
    for (const e of transitEvents) {
      if (e.eventType === TrackingEventType.DEPARTED_ORIGIN) departedByShipment.set(e.shipmentId, e.occurredAt);
      if (e.eventType === TrackingEventType.ARRIVED_DESTINATION) arrivedByShipment.set(e.shipmentId, e.occurredAt);
    }
    const shipmentById = new Map(shipments.map((s) => [s.id, s]));
    const transitDaysByShipment: { shipmentId: string; days: number; arrivedMonth: string; routeId: string | null }[] = [];
    for (const [shipmentId, arrivedAt] of arrivedByShipment) {
      const departedAt = departedByShipment.get(shipmentId);
      if (!departedAt) continue;
      const days = (arrivedAt.getTime() - departedAt.getTime()) / (24 * 60 * 60 * 1000);
      transitDaysByShipment.push({
        shipmentId,
        days,
        arrivedMonth: arrivedAt.toISOString().slice(0, 10),
        routeId: shipmentById.get(shipmentId)?.routeId ?? null,
      });
    }
    const avgTransitDays =
      transitDaysByShipment.length > 0
        ? this.round2(transitDaysByShipment.reduce((a, b) => a + b.days, 0) / transitDaysByShipment.length)
        : null;

    const trendByDay = new Map<string, number[]>();
    for (const row of transitDaysByShipment) {
      const arr = trendByDay.get(row.arrivedMonth) ?? [];
      arr.push(row.days);
      trendByDay.set(row.arrivedMonth, arr);
    }
    const transitTimeTrend = Array.from(trendByDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, days]) => ({ date, avgDays: this.round2(days.reduce((a, b) => a + b, 0) / days.length) }));

    const routeGroups = new Map<string, { routeId: string | null; routeName: string | null; days: number[]; estimatedTransitDays: number | null }>();
    for (const row of transitDaysByShipment) {
      const key = row.routeId ?? 'unassigned';
      const shipment = shipmentById.get(row.shipmentId);
      const group = routeGroups.get(key) ?? {
        routeId: row.routeId,
        routeName: row.routeId ? (shipment?.route?.name ?? null) : null,
        days: [],
        estimatedTransitDays: row.routeId ? (shipment?.route?.transitDaysEstimate ?? null) : null,
      };
      group.days.push(row.days);
      routeGroups.set(key, group);
    }
    const routePerformance = Array.from(routeGroups.values()).map((g) => ({
      routeId: g.routeId,
      routeName: g.routeName,
      shipmentCount: g.days.length,
      avgActualTransitDays: this.round2(g.days.reduce((a, b) => a + b, 0) / g.days.length),
      estimatedTransitDays: g.estimatedTransitDays,
    }));

    return { topDestinations, deliverySuccessRate, avgTransitDays, transitTimeTrend, routePerformance };
  }

  // -----------------------------------------------------------------
  // /analytics/customers
  // -----------------------------------------------------------------

  async getCustomers(tenantId: string, query: AnalyticsQueryDto): Promise<AnalyticsCustomersResponse> {
    const { start, end } = this.resolveDateRange(query);

    const [newCustomers, allCustomers, shipmentsInRange] = await Promise.all([
      this.prisma.customer.count({ where: { tenantId, createdAt: { gte: start, lte: end } } }),
      this.prisma.customer.findMany({ where: { tenantId, createdAt: { lte: end } }, select: { id: true, createdAt: true } }),
      this.prisma.shipment.findMany({
        where: { tenantId, createdAt: { gte: start, lte: end } },
        select: { customerId: true },
      }),
    ]);

    const dayCounts = new Map<string, number>();
    for (const c of allCustomers) {
      if (c.createdAt >= start && c.createdAt <= end) {
        const day = c.createdAt.toISOString().slice(0, 10);
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      }
    }
    const sortedDays = Array.from(dayCounts.entries()).sort(([a], [b]) => a.localeCompare(b));
    const baselineCumulative = allCustomers.filter((c) => c.createdAt < start).length;
    let running = baselineCumulative;
    const growthTrend = sortedDays.map(([date, newCount]) => {
      running += newCount;
      return { date, newCustomers: newCount, cumulativeCustomers: running };
    });

    const activeCustomerIds = new Set(shipmentsInRange.map((s) => s.customerId));
    const activeCustomers = activeCustomerIds.size;
    const totalCustomers = await this.prisma.customer.count({ where: { tenantId } });
    const dormantCustomers = Math.max(0, totalCustomers - activeCustomers);

    const shipmentCounts = new Map<string, number>();
    for (const s of shipmentsInRange) {
      shipmentCounts.set(s.customerId, (shipmentCounts.get(s.customerId) ?? 0) + 1);
    }
    const revenueRows = await this.prisma.invoice.findMany({
      where: { tenantId, status: { not: InvoiceStatus.DRAFT }, issuedAt: { gte: start, lte: end } },
      select: { customerId: true, total: true, currency: true },
    });
    const revenueByCustomer = new Map<string, { currency: string; amount: Prisma.Decimal }[]>();
    for (const r of revenueRows) {
      this.pushInto(revenueByCustomer, r.customerId, r.currency, r.total);
    }
    const candidateCustomerIds = new Set([...shipmentCounts.keys(), ...revenueByCustomer.keys()]);
    const customerRecords = await this.prisma.customer.findMany({
      where: { tenantId, id: { in: Array.from(candidateCustomerIds) } },
      select: { id: true, firstName: true, lastName: true, customerNumber: true },
    });
    const topCustomers = customerRecords
      .map((c) => ({
        customerId: c.id,
        customerName: `${c.firstName} ${c.lastName}`,
        customerNumber: c.customerNumber,
        shipmentCount: shipmentCounts.get(c.id) ?? 0,
        // Ranked by shipment count, not revenue — revenue is shown per
        // currency and can't be safely collapsed into one cross-currency
        // sort key (see this class's own money-handling doc comment).
        revenue: this.sumDecimalsByCurrency(revenueByCustomer.get(c.id) ?? []),
      }))
      .sort((a, b) => b.shipmentCount - a.shipmentCount)
      .slice(0, 10);

    return { newCustomers, activeCustomers, dormantCustomers, growthTrend, topCustomers };
  }

  // -----------------------------------------------------------------
  // /analytics/exceptions
  // -----------------------------------------------------------------

  async getExceptions(tenantId: string, query: AnalyticsQueryDto): Promise<AnalyticsExceptionsResponse> {
    const { start, end } = this.resolveDateRange(query);

    const exceptions = await this.prisma.operationalException.findMany({
      where: { tenantId, createdAt: { gte: start, lte: end } },
      select: { type: true, createdAt: true, resolvedAt: true },
    });

    const openExceptions = exceptions.filter((e) => !e.resolvedAt).length;
    const resolutionHours = exceptions
      .filter((e) => e.resolvedAt)
      .map((e) => (e.resolvedAt!.getTime() - e.createdAt.getTime()) / (60 * 60 * 1000));
    const avgResolutionHours = resolutionHours.length > 0 ? this.round2(resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length) : null;

    const byType = new Map<string, { open: number; resolved: number }>();
    for (const e of exceptions) {
      const bucket = byType.get(e.type) ?? { open: 0, resolved: 0 };
      if (e.resolvedAt) bucket.resolved += 1;
      else bucket.open += 1;
      byType.set(e.type, bucket);
    }

    return {
      openExceptions,
      avgResolutionHours,
      exceptionsByType: Array.from(byType.entries()).map(([type, counts]) => ({
        type: type as AnalyticsExceptionsResponse['exceptionsByType'][number]['type'],
        ...counts,
      })),
    };
  }

  // -----------------------------------------------------------------
  // internals
  // -----------------------------------------------------------------

  /** Defaults to the last DEFAULT_RANGE_DAYS days when either bound is omitted, inclusive of the full `to` day. */
  private resolveDateRange(query: AnalyticsQueryDto): { start: Date; end: Date } {
    const end = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
    const start = query.from
      ? new Date(`${query.from}T00:00:00.000Z`)
      : new Date(end.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  private pushInto(map: Map<string, { currency: string; amount: Prisma.Decimal }[]>, key: string, currency: string, amount: Prisma.Decimal): void {
    const arr = map.get(key) ?? [];
    arr.push({ currency, amount });
    map.set(key, arr);
  }

  /** Sums Decimal amounts grouped by currency — the one place every revenue figure in this service funnels through, so "never sum across currencies" is enforced in exactly one place. */
  private sumDecimalsByCurrency(rows: { currency: string; amount: Prisma.Decimal }[]): CurrencyAmount[] {
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      totals.set(row.currency, (totals.get(row.currency) ?? new Prisma.Decimal(0)).plus(row.amount));
    }
    return Array.from(totals.entries()).map(([currency, amount]) => ({ currency, amount: formatMoney(amount) }));
  }

  private averageDecimalsByCurrency(rows: { currency: string; amount: Prisma.Decimal }[]): CurrencyAmount[] {
    const grouped = new Map<string, Prisma.Decimal[]>();
    for (const row of rows) {
      const arr = grouped.get(row.currency) ?? [];
      arr.push(row.amount);
      grouped.set(row.currency, arr);
    }
    return Array.from(grouped.entries()).map(([currency, amounts]) => {
      const sum = amounts.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
      return { currency, amount: formatMoney(sum.dividedBy(amounts.length)) };
    });
  }

  /** Buckets outstanding-balance rows by days-overdue (dueDate vs now), computed live — see this class's own doc comment on why InvoiceStatus.OVERDUE is never trusted. */
  private bucketAging(rows: { currency: string; amount: Prisma.Decimal; dueDate: Date | null }[]): OutstandingAgingBucket[] {
    const now = Date.now();
    const buckets: Record<OutstandingAgingBucket['bucket'], { currency: string; amount: Prisma.Decimal }[]> = {
      current: [],
      '1-30': [],
      '31-60': [],
      '61-90': [],
      '90+': [],
    };
    for (const row of rows) {
      const daysOverdue = row.dueDate ? Math.floor((now - row.dueDate.getTime()) / (24 * 60 * 60 * 1000)) : -1;
      const key: OutstandingAgingBucket['bucket'] =
        daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+';
      buckets[key].push({ currency: row.currency, amount: row.amount });
    }
    return (Object.keys(buckets) as OutstandingAgingBucket['bucket'][]).map((bucket) => ({
      bucket,
      count: buckets[bucket].length,
      amounts: this.sumDecimalsByCurrency(buckets[bucket]),
    }));
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
