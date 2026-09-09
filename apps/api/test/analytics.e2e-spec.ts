import { INestApplication } from '@nestjs/common';
import { ContainerStatus, PrismaClient, TrackingEventType, UserRole } from '@prisma/client';
import request from 'supertest';
import {
  createTestTenant,
  createUserInTenant,
  deleteTestTenant,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Stage 4: Owner/Manager Analytics.
 *
 * Proves the three things that actually matter for an aggregation
 * module like this one:
 *   1. Tenant isolation — an aggregate groupBy/aggregate query is exactly
 *      the shape of query that's easy to accidentally leave unscoped, so
 *      this is the highest-priority thing to prove, not an afterthought.
 *   2. Role authorization — ANALYTICS_ROLES (OWNER/ADMIN/MANAGER) only for
 *      every route except /analytics/overview, which stays open to all
 *      DASHBOARD_ROLES.
 *   3. Aggregation correctness against known, precisely-seeded amounts —
 *      not just "doesn't crash," but the actual returned numbers match
 *      hand-computed expectations, including the money-handling
 *      invariants (never sum across currencies, live-computed overdue
 *      state rather than trusting the unused InvoiceStatus.OVERDUE value,
 *      date-range inclusion/exclusion).
 */
describe('Analytics: tenant isolation, role authorization, aggregation correctness (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let ownerTokenA: string;
  let adminTokenA: string;
  let managerTokenA: string;
  let warehouseStaffTokenA: string;
  let accountantTokenA: string;
  let ownerTokenB: string;
  let warehouseTwoIdA: string;

  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const elevenDaysAgo = new Date(now.getTime() - 11 * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'AnalyticsA', UserRole.TENANT_OWNER);
    tenantB = await createTestTenant(prisma, 'AnalyticsB', UserRole.TENANT_OWNER);
    ownerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    ownerTokenB = await login(app, tenantB.user.email, tenantB.user.password);

    const adminA = await createUserInTenant(prisma, tenantA.tenantId, 'Admin', UserRole.TENANT_ADMIN);
    adminTokenA = await login(app, adminA.email, adminA.password);
    const managerA = await createUserInTenant(prisma, tenantA.tenantId, 'Manager', UserRole.WAREHOUSE_MANAGER);
    managerTokenA = await login(app, managerA.email, managerA.password);
    const warehouseStaffA = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);
    warehouseStaffTokenA = await login(app, warehouseStaffA.email, warehouseStaffA.password);
    const accountantA = await createUserInTenant(prisma, tenantA.tenantId, 'Accountant', UserRole.ACCOUNTANT);
    accountantTokenA = await login(app, accountantA.email, accountantA.password);

    // --- Tenant A: precisely known financial data ---
    // Invoice 1: $1000 total, $500 paid, due 10 days ago (10 days
    // overdue -> the "1-30" aging bucket), status PARTIALLY_PAID (never
    // OVERDUE — nothing in this codebase ever sets that value; the aging
    // bucket must be computed live from dueDate, which is exactly what
    // this fixture is designed to prove).
    const invoice1 = await prisma.invoice.create({
      data: {
        tenantId: tenantA.tenantId,
        customerId: tenantA.customerId,
        invoiceNumber: 'ANALYTICS-TEST-INV-001',
        status: 'PARTIALLY_PAID',
        subtotal: '1000.00',
        tax: '0.00',
        total: '1000.00',
        amountPaid: '500.00',
        currency: 'USD',
        dueDate: tenDaysAgo,
        issuedAt: now,
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantA.tenantId,
        invoiceId: invoice1.id,
        customerId: tenantA.customerId,
        amount: '500.00',
        currency: 'USD',
        method: 'CARD',
        status: 'COMPLETED',
        source: 'ONLINE',
        paidAt: now,
      },
    });

    // Invoice 2: fully paid, a different currency — proves currencies are
    // never summed together.
    const invoice2 = await prisma.invoice.create({
      data: {
        tenantId: tenantA.tenantId,
        customerId: tenantA.customerId,
        invoiceNumber: 'ANALYTICS-TEST-INV-002',
        status: 'PAID',
        subtotal: '300.00',
        tax: '0.00',
        total: '300.00',
        amountPaid: '300.00',
        currency: 'GHS',
        issuedAt: now,
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantA.tenantId,
        invoiceId: invoice2.id,
        customerId: tenantA.customerId,
        amount: '300.00',
        currency: 'GHS',
        method: 'MOBILE_MONEY',
        status: 'COMPLETED',
        source: 'MANUAL',
        paidAt: now,
      },
    });

    // Invoice 3: paid 60 days ago — outside the default 30-day window,
    // proves date-range exclusion.
    const invoice3 = await prisma.invoice.create({
      data: {
        tenantId: tenantA.tenantId,
        customerId: tenantA.customerId,
        invoiceNumber: 'ANALYTICS-TEST-INV-003',
        status: 'PAID',
        subtotal: '9999.00',
        tax: '0.00',
        total: '9999.00',
        amountPaid: '9999.00',
        currency: 'USD',
        issuedAt: sixtyDaysAgo,
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantA.tenantId,
        invoiceId: invoice3.id,
        customerId: tenantA.customerId,
        amount: '9999.00',
        currency: 'USD',
        method: 'BANK_TRANSFER',
        status: 'COMPLETED',
        source: 'MANUAL',
        paidAt: sixtyDaysAgo,
      },
    });

    // A stale, unresolved operational exception (11 days old, past the
    // 7-day stale threshold) — proves the alerts strip.
    await prisma.operationalException.create({
      data: {
        tenantId: tenantA.tenantId,
        type: 'DELAYED',
        message: 'Analytics test fixture exception',
        createdAt: elevenDaysAgo,
      },
    });

    // --- Tenant B: a completely different known amount, for isolation ---
    const invoiceB = await prisma.invoice.create({
      data: {
        tenantId: tenantB.tenantId,
        customerId: tenantB.customerId,
        invoiceNumber: 'ANALYTICS-TEST-INV-B001',
        status: 'PAID',
        subtotal: '4242.00',
        tax: '0.00',
        total: '4242.00',
        amountPaid: '4242.00',
        currency: 'USD',
        issuedAt: now,
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantB.tenantId,
        invoiceId: invoiceB.id,
        customerId: tenantB.customerId,
        amount: '4242.00',
        currency: 'USD',
        method: 'CASH',
        status: 'COMPLETED',
        source: 'MANUAL',
        paidAt: now,
      },
    });

    // --- Warehouse-filter regression fixture ---
    // Two distinct warehouses for tenant A, one shipment and one container
    // each, so the warehouse filter can be proven to actually discriminate
    // between them — not just "return a subset of the same thing," which
    // is exactly the class of bug found manually: warehouseThroughput and
    // the container queries in AnalyticsService.getOperations, and the
    // shipments query in getDestinations, ignored `query.warehouseId`
    // entirely and always returned every warehouse/container/destination
    // regardless of the filter.
    const warehouseTwo = await prisma.warehouse.create({
      data: {
        tenantId: tenantA.tenantId,
        name: 'Second Warehouse',
        code: 'WH2',
        addressLine1: '2 Second St',
        city: 'Secondville',
        country: 'US',
        isDestinationWarehouse: true,
      },
    });
    warehouseTwoIdA = warehouseTwo.id;

    await prisma.shipment.create({
      data: {
        tenantId: tenantA.tenantId,
        customerId: tenantA.customerId,
        trackingNumber: 'ANALYTICS-TEST-WH2-SHIPMENT',
        shipmentMode: 'AIR',
        originCountry: 'US',
        destinationCountry: 'Kenya',
        originWarehouseId: warehouseTwo.id,
        status: 'PROCESSING',
        createdAt: now,
      },
    });
    await prisma.container.create({
      data: {
        tenantId: tenantA.tenantId,
        containerNumber: 'ANALYTICS-TEST-WH2-CONTAINER',
        containerType: 'TWENTY_FT',
        status: 'BOOKED',
        warehouseId: warehouseTwo.id,
      },
    });

    await prisma.shipment.create({
      data: {
        tenantId: tenantA.tenantId,
        customerId: tenantA.customerId,
        trackingNumber: 'ANALYTICS-TEST-WH1-SHIPMENT',
        shipmentMode: 'AIR',
        originCountry: 'US',
        destinationCountry: 'Tanzania',
        originWarehouseId: tenantA.warehouseId,
        status: 'PROCESSING',
        createdAt: now,
      },
    });
    await prisma.container.create({
      data: {
        tenantId: tenantA.tenantId,
        containerNumber: 'ANALYTICS-TEST-WH1-CONTAINER',
        containerType: 'TWENTY_FT',
        status: 'BOOKED',
        warehouseId: tenantA.warehouseId,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  // -------------------------------------------------------------------
  // Role authorization
  // -------------------------------------------------------------------
  describe('Role authorization', () => {
    it('unauthenticated requests get 401 on every route', async () => {
      for (const path of ['overview', 'alerts', 'revenue', 'operations', 'destinations', 'customers', 'exceptions']) {
        const res = await request(app.getHttpServer()).get(`/analytics/${path}`);
        expect(res.status).toBe(401);
      }
    });

    it('/analytics/overview is open to any DASHBOARD_ROLES member, including WAREHOUSE_STAFF and ACCOUNTANT', async () => {
      for (const token of [ownerTokenA, adminTokenA, managerTokenA, warehouseStaffTokenA, accountantTokenA]) {
        const res = await request(app.getHttpServer()).get('/analytics/overview').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
      }
    });

    it('every other /analytics/* route is ANALYTICS_ROLES-only: OWNER, ADMIN, MANAGER pass', async () => {
      for (const token of [ownerTokenA, adminTokenA, managerTokenA]) {
        for (const path of ['alerts', 'revenue', 'operations', 'destinations', 'customers', 'exceptions']) {
          const res = await request(app.getHttpServer()).get(`/analytics/${path}`).set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(200);
        }
      }
    });

    it('WAREHOUSE_STAFF and ACCOUNTANT get 403 on every financial/operational analytics route', async () => {
      for (const token of [warehouseStaffTokenA, accountantTokenA]) {
        for (const path of ['alerts', 'revenue', 'operations', 'destinations', 'customers', 'exceptions']) {
          const res = await request(app.getHttpServer()).get(`/analytics/${path}`).set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(403);
        }
      }
    });

    it('a CUSTOMER token gets 403 on every /analytics/* route, including overview', async () => {
      const customerToken = await loginAsPortalCustomer(app, prisma, tenantA.tenantId);
      for (const path of ['overview', 'revenue']) {
        const res = await request(app.getHttpServer()).get(`/analytics/${path}`).set('Authorization', `Bearer ${customerToken}`);
        expect(res.status).toBe(403);
      }
    });
  });

  // -------------------------------------------------------------------
  // Tenant isolation
  // -------------------------------------------------------------------
  describe('Tenant isolation', () => {
    it("tenant A's revenue never includes tenant B's $4242 payment, and vice versa", async () => {
      const resA = await request(app.getHttpServer())
        .get('/analytics/revenue?from=2020-01-01')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(resA.status).toBe(200);
      const totalsA = resA.body.totalRevenue as { currency: string; amount: string }[];
      expect(totalsA.find((t) => t.amount === '4242.00')).toBeUndefined();

      const resB = await request(app.getHttpServer())
        .get('/analytics/revenue?from=2020-01-01')
        .set('Authorization', `Bearer ${ownerTokenB}`);
      expect(resB.status).toBe(200);
      const totalsB = resB.body.totalRevenue as { currency: string; amount: string }[];
      expect(totalsB).toEqual([{ currency: 'USD', amount: '4242.00' }]);
      // Tenant B must never see tenant A's USD 500 + 9999 or GHS 300.
      expect(totalsB.find((t) => t.currency === 'GHS')).toBeUndefined();
    });

    it("tenant B's customer count/overview never reflects tenant A's 5 customers", async () => {
      const resB = await request(app.getHttpServer()).get('/analytics/overview').set('Authorization', `Bearer ${ownerTokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.totalCustomers).toBe(1); // only tenantB's own fixture customer
    });
  });

  // -------------------------------------------------------------------
  // Aggregation correctness
  // -------------------------------------------------------------------
  describe('Revenue aggregation correctness', () => {
    it('totalRevenue sums COMPLETED payments per currency, never across currencies, within the default 30-day window', async () => {
      const res = await request(app.getHttpServer()).get('/analytics/revenue').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      const totals = (res.body.totalRevenue as { currency: string; amount: string }[]).sort((a, b) => a.currency.localeCompare(b.currency));
      // The 60-day-old $9999 payment must NOT appear in the default 30-day window.
      expect(totals).toEqual([
        { currency: 'GHS', amount: '300.00' },
        { currency: 'USD', amount: '500.00' },
      ]);
    });

    it('an explicit date range covering the 60-day-old payment includes it', async () => {
      const res = await request(app.getHttpServer())
        .get('/analytics/revenue?from=2020-01-01')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      const usd = (res.body.totalRevenue as { currency: string; amount: string }[]).find((t) => t.currency === 'USD');
      expect(usd?.amount).toBe('10499.00'); // 500 + 9999
    });

    it('outstandingBalance and outstandingAging reflect the live, unpaid $500 remainder — never bounded by the date-range filter', async () => {
      // A narrow range that would exclude everything if outstanding were
      // date-bounded — it must not be, since "what's currently owed" has
      // no meaningful historical snapshot in this schema.
      const res = await request(app.getHttpServer())
        .get('/analytics/revenue?from=2026-01-01&to=2026-01-02')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.outstandingBalance).toEqual([{ currency: 'USD', amount: '500.00' }]);

      const bucket130 = res.body.outstandingAging.find((b: { bucket: string }) => b.bucket === '1-30');
      expect(bucket130.count).toBe(1);
      expect(bucket130.amounts).toEqual([{ currency: 'USD', amount: '500.00' }]);
      // The 10-days-overdue invoice must land in exactly one bucket
      // ('1-30'), never double-counted into 'current' as well.
      const bucketCurrent = res.body.outstandingAging.find((b: { bucket: string }) => b.bucket === 'current');
      expect(bucketCurrent.amounts).toEqual([]);
    });

    it('revenueByMethod and revenueBySource break down correctly without cross-currency summing', async () => {
      const res = await request(app.getHttpServer()).get('/analytics/revenue').set('Authorization', `Bearer ${ownerTokenA}`);
      const card = res.body.revenueByMethod.find((m: { method: string }) => m.method === 'CARD');
      expect(card.amounts).toEqual([{ currency: 'USD', amount: '500.00' }]);
      const online = res.body.revenueBySource.find((s: { source: string }) => s.source === 'ONLINE');
      expect(online.amounts).toEqual([{ currency: 'USD', amount: '500.00' }]);
    });
  });

  describe('Alerts (live, never date-range-bounded)', () => {
    it('overdueInvoices reflects the $500 partially-paid, past-due invoice', async () => {
      const res = await request(app.getHttpServer()).get('/analytics/alerts').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.overdueInvoices.count).toBe(1);
      expect(res.body.overdueInvoices.amounts).toEqual([{ currency: 'USD', amount: '500.00' }]);
    });

    it('staleExceptions counts the 11-day-old unresolved exception (past the 7-day threshold)', async () => {
      const res = await request(app.getHttpServer()).get('/analytics/alerts').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.staleExceptions.count).toBeGreaterThanOrEqual(1);
      expect(res.body.staleExceptions.staleThresholdDays).toBe(7);
    });
  });

  describe('Exceptions section', () => {
    it('a wide date range shows the seeded exception as open with no resolution time yet', async () => {
      const res = await request(app.getHttpServer())
        .get('/analytics/exceptions?from=2020-01-01')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.openExceptions).toBeGreaterThanOrEqual(1);
      const delayed = res.body.exceptionsByType.find((t: { type: string }) => t.type === 'DELAYED');
      expect(delayed.open).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Warehouse filter (regression — manually found bug: warehouseThroughput/containers/destinations previously ignored it)', () => {
    it('operations.warehouseThroughput shows ONLY the filtered warehouse, never every warehouse', async () => {
      const res = await request(app.getHttpServer())
        .get(`/analytics/operations?from=2020-01-01&warehouseId=${warehouseTwoIdA}`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      const ids = res.body.warehouseThroughput.map((w: { warehouseId: string }) => w.warehouseId);
      expect(ids).toEqual([warehouseTwoIdA]);
    });

    it('operations.containerStatusBreakdown only includes containers physically at the filtered warehouse', async () => {
      const filtered = await request(app.getHttpServer())
        .get(`/analytics/operations?from=2020-01-01&warehouseId=${warehouseTwoIdA}`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(filtered.status).toBe(200);
      expect(filtered.body.containerStatusBreakdown).toEqual([{ status: 'BOOKED', count: 1 }]);

      const other = await request(app.getHttpServer())
        .get(`/analytics/operations?from=2020-01-01&warehouseId=${tenantA.warehouseId}`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      // Tenant A's original warehouse also has exactly one BOOKED container
      // of its own — proving this isn't just "always shows 1", it's the
      // *correct* one for each filter value.
      expect(other.body.containerStatusBreakdown).toEqual([{ status: 'BOOKED', count: 1 }]);
    });

    it('operations shows BOTH warehouses when no warehouseId filter is applied', async () => {
      const res = await request(app.getHttpServer())
        .get('/analytics/operations?from=2020-01-01')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      const ids = (res.body.warehouseThroughput as { warehouseId: string }[]).map((w) => w.warehouseId).sort();
      expect(ids).toEqual([tenantA.warehouseId, warehouseTwoIdA].sort());
    });

    it("destinations.topDestinations respects the warehouse filter — the other warehouse's destination is excluded", async () => {
      const res = await request(app.getHttpServer())
        .get(`/analytics/destinations?from=2020-01-01&warehouseId=${warehouseTwoIdA}`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      const countries = (res.body.topDestinations as { destinationCountry: string }[]).map((d) => d.destinationCountry);
      expect(countries).toContain('Kenya'); // this warehouse's own shipment
      expect(countries).not.toContain('Tanzania'); // the OTHER warehouse's shipment must not leak in
    });

    it('destinations shows both destinations when no warehouseId filter is applied', async () => {
      const res = await request(app.getHttpServer())
        .get('/analytics/destinations?from=2020-01-01')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      const countries = (res.body.topDestinations as { destinationCountry: string }[]).map((d) => d.destinationCountry);
      expect(countries).toContain('Kenya');
      expect(countries).toContain('Tanzania');
    });
  });
});

/**
 * Executive Dashboard (GET /analytics/executive) — deliberately its own
 * top-level describe with its own fresh tenants, not sharing tenantA/
 * tenantB above (those are already torn down by the outer describe's own
 * afterAll before this one's tests run). Proves the same three things as
 * the suite above, plus the live-vs-period split unique to this endpoint:
 *   1. Role authorization — identical ANALYTICS_ROLES gate as every other
 *      route except /analytics/overview (this route is NOT open to
 *      DASHBOARD_ROLES — it carries real financial figures).
 *   2. Tenant isolation.
 *   3. Correctness: `activeShipments`/`openInvoices`/`outstandingBalance`/
 *      `containerMovement`/`attention` never move when the date range
 *      changes (live state); `revenue`/`completedShipments`/
 *      `warehouseActivity`/both trends do respect it (period-bound).
 *   4. Multi-currency safety (never summed across currencies).
 *   5. Empty state (a tenant with no activity yet returns all-zero/empty,
 *      never a crash or a fabricated non-zero value).
 */
describe('Executive Dashboard: GET /analytics/executive (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantExec: TestTenantFixture;
  let tenantOther: TestTenantFixture;
  let tenantEmpty: TestTenantFixture;
  let ownerToken: string;
  let adminToken: string;
  let managerToken: string;
  let warehouseStaffToken: string;
  let ownerTokenOther: string;
  let ownerTokenEmpty: string;

  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const today = now.toISOString().slice(0, 10);

  beforeAll(async () => {
    app = await createTestApp();

    tenantExec = await createTestTenant(prisma, 'ExecDashA', UserRole.TENANT_OWNER);
    tenantOther = await createTestTenant(prisma, 'ExecDashB', UserRole.TENANT_OWNER);
    tenantEmpty = await createTestTenant(prisma, 'ExecDashEmpty', UserRole.TENANT_OWNER);
    ownerToken = await login(app, tenantExec.user.email, tenantExec.user.password);
    ownerTokenOther = await login(app, tenantOther.user.email, tenantOther.user.password);
    ownerTokenEmpty = await login(app, tenantEmpty.user.email, tenantEmpty.user.password);

    const admin = await createUserInTenant(prisma, tenantExec.tenantId, 'Admin', UserRole.TENANT_ADMIN);
    adminToken = await login(app, admin.email, admin.password);
    const manager = await createUserInTenant(prisma, tenantExec.tenantId, 'Manager', UserRole.WAREHOUSE_MANAGER);
    managerToken = await login(app, manager.email, manager.password);
    const warehouseStaff = await createUserInTenant(prisma, tenantExec.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);
    warehouseStaffToken = await login(app, warehouseStaff.email, warehouseStaff.password);

    // --- Financial: one overdue USD invoice + one fully-paid GHS invoice ---
    // proves outstandingBalance/openInvoices (live) and multi-currency
    // revenue (period), never cross-summed.
    const invoiceUsd = await prisma.invoice.create({
      data: {
        tenantId: tenantExec.tenantId,
        customerId: tenantExec.customerId,
        invoiceNumber: 'EXEC-TEST-INV-USD',
        status: 'PARTIALLY_PAID',
        subtotal: '1000.00',
        tax: '0.00',
        total: '1000.00',
        amountPaid: '500.00',
        currency: 'USD',
        dueDate: fiveDaysAgo,
        issuedAt: now,
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantExec.tenantId,
        invoiceId: invoiceUsd.id,
        customerId: tenantExec.customerId,
        amount: '500.00',
        currency: 'USD',
        method: 'CARD',
        status: 'COMPLETED',
        source: 'ONLINE',
        paidAt: now,
      },
    });
    const invoiceGhs = await prisma.invoice.create({
      data: {
        tenantId: tenantExec.tenantId,
        customerId: tenantExec.customerId,
        invoiceNumber: 'EXEC-TEST-INV-GHS',
        status: 'PAID',
        subtotal: '300.00',
        tax: '0.00',
        total: '300.00',
        amountPaid: '300.00',
        currency: 'GHS',
        issuedAt: now,
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantExec.tenantId,
        invoiceId: invoiceGhs.id,
        customerId: tenantExec.customerId,
        amount: '300.00',
        currency: 'GHS',
        method: 'MOBILE_MONEY',
        status: 'COMPLETED',
        source: 'MANUAL',
        paidAt: now,
      },
    });

    // --- A stale, unresolved exception -> "Requires Attention" ---
    await prisma.operationalException.create({
      data: { tenantId: tenantExec.tenantId, type: 'DELAYED', message: 'Executive dashboard test fixture', createdAt: tenDaysAgo },
    });

    // --- Shipments: one active (live), one completed (period) ---
    await prisma.shipment.create({
      data: {
        tenantId: tenantExec.tenantId,
        customerId: tenantExec.customerId,
        trackingNumber: 'EXEC-TEST-ACTIVE',
        shipmentMode: 'AIR',
        originCountry: 'US',
        destinationCountry: 'Ghana',
        status: 'PROCESSING',
        createdAt: now,
      },
    });
    const completedShipment = await prisma.shipment.create({
      data: {
        tenantId: tenantExec.tenantId,
        customerId: tenantExec.customerId,
        trackingNumber: 'EXEC-TEST-COMPLETED',
        shipmentMode: 'AIR',
        originCountry: 'US',
        destinationCountry: 'Ghana',
        status: 'COMPLETED',
        createdAt: now,
      },
    });

    // --- TrackingEvents: known warehouse-activity counts, in and out of range ---
    const eventTypes: { eventType: TrackingEventType; occurredAt: Date }[] = [
      { eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE, occurredAt: now },
      { eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE, occurredAt: now },
      { eventType: TrackingEventType.PROCESSED, occurredAt: now },
      { eventType: TrackingEventType.LOADED, occurredAt: now },
      { eventType: TrackingEventType.RECEIVED_DESTINATION_WAREHOUSE, occurredAt: now },
      { eventType: TrackingEventType.DELIVERED, occurredAt: now },
      { eventType: TrackingEventType.PICKED_UP, occurredAt: now },
      // Outside "today" but inside a wide range — proves date-range exclusion.
      { eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE, occurredAt: sixtyDaysAgo },
    ];
    for (const e of eventTypes) {
      await prisma.trackingEvent.create({
        data: {
          tenantId: tenantExec.tenantId,
          shipmentId: completedShipment.id,
          eventType: e.eventType,
          source: 'MANUAL',
          occurredAt: e.occurredAt,
        },
      });
    }

    // --- Containers: one per bucket, plus a CLOSED one to prove exclusion ---
    const containerStatuses: ContainerStatus[] = [
      ContainerStatus.BOOKED,
      ContainerStatus.LOADING,
      ContainerStatus.DEPARTED,
      ContainerStatus.IN_TRANSIT,
      ContainerStatus.ARRIVED,
      ContainerStatus.CLOSED,
    ];
    for (const status of containerStatuses) {
      await prisma.container.create({
        data: {
          tenantId: tenantExec.tenantId,
          containerNumber: `EXEC-TEST-${status}`,
          containerType: 'TWENTY_FT',
          status,
        },
      });
    }

    // --- Tenant isolation counterpart: a different known amount ---
    const invoiceOther = await prisma.invoice.create({
      data: {
        tenantId: tenantOther.tenantId,
        customerId: tenantOther.customerId,
        invoiceNumber: 'EXEC-TEST-OTHER-INV',
        status: 'PAID',
        subtotal: '7777.00',
        tax: '0.00',
        total: '7777.00',
        amountPaid: '7777.00',
        currency: 'USD',
        issuedAt: now,
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantOther.tenantId,
        invoiceId: invoiceOther.id,
        customerId: tenantOther.customerId,
        amount: '7777.00',
        currency: 'USD',
        method: 'CASH',
        status: 'COMPLETED',
        source: 'MANUAL',
        paidAt: now,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantExec.tenantId);
    await deleteTestTenant(prisma, tenantOther.tenantId);
    await deleteTestTenant(prisma, tenantEmpty.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('Role authorization', () => {
    it('unauthenticated requests get 401', async () => {
      const res = await request(app.getHttpServer()).get('/analytics/executive');
      expect(res.status).toBe(401);
    });

    it('OWNER, ADMIN, MANAGER (ANALYTICS_ROLES) get 200', async () => {
      for (const token of [ownerToken, adminToken, managerToken]) {
        const res = await request(app.getHttpServer()).get('/analytics/executive').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
      }
    });

    it('WAREHOUSE_STAFF gets 403 — unlike /analytics/overview, this route carries financial data', async () => {
      const res = await request(app.getHttpServer()).get('/analytics/executive').set('Authorization', `Bearer ${warehouseStaffToken}`);
      expect(res.status).toBe(403);
    });

    it('a CUSTOMER token gets 403', async () => {
      const customerToken = await loginAsPortalCustomer(app, prisma, tenantExec.tenantId);
      const res = await request(app.getHttpServer()).get('/analytics/executive').set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('Tenant isolation', () => {
    it("tenantOther's executive snapshot reflects only its own $7777 revenue, never tenantExec's figures", async () => {
      const res = await request(app.getHttpServer())
        .get(`/analytics/executive?from=2020-01-01&to=${today}`)
        .set('Authorization', `Bearer ${ownerTokenOther}`);
      expect(res.status).toBe(200);
      expect(res.body.revenue).toEqual([{ currency: 'USD', amount: '7777.00' }]);
      expect(res.body.openInvoices).toBe(0); // tenantOther's invoice is fully PAID, not open
      expect(res.body.outstandingBalance).toEqual([]);
      // Never contaminated by tenantExec's GHS revenue or open invoice.
      expect(res.body.revenue.find((r: { currency: string }) => r.currency === 'GHS')).toBeUndefined();
    });
  });

  describe('Live vs. period fields', () => {
    it('activeShipments/openInvoices/outstandingBalance/containerMovement/attention are identical for "today" and a wide historical range', async () => {
      const resToday = await request(app.getHttpServer())
        .get(`/analytics/executive?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const resWide = await request(app.getHttpServer())
        .get(`/analytics/executive?from=2020-01-01&to=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(resToday.status).toBe(200);
      expect(resWide.status).toBe(200);

      expect(resToday.body.activeShipments).toBe(resWide.body.activeShipments);
      expect(resToday.body.openInvoices).toBe(resWide.body.openInvoices);
      expect(resToday.body.outstandingBalance).toEqual(resWide.body.outstandingBalance);
      expect(resToday.body.containerMovement).toEqual(resWide.body.containerMovement);
      expect(resToday.body.attention).toEqual(resWide.body.attention);

      // Sanity: the live fields actually reflect the known fixture, not just "equal to each other."
      expect(resToday.body.activeShipments).toBeGreaterThanOrEqual(1); // EXEC-TEST-ACTIVE
      expect(resToday.body.openInvoices).toBe(1); // only the PARTIALLY_PAID USD invoice
      expect(resToday.body.outstandingBalance).toEqual([{ currency: 'USD', amount: '500.00' }]);
      expect(resToday.body.attention.overdueInvoices.count).toBe(1);
      expect(resToday.body.attention.staleExceptions.count).toBeGreaterThanOrEqual(1);
    });

    it('revenue/completedShipments/warehouseActivity DO respect the requested period', async () => {
      const resToday = await request(app.getHttpServer())
        .get(`/analytics/executive?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const resWide = await request(app.getHttpServer())
        .get(`/analytics/executive?from=2020-01-01&to=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      // Multi-currency revenue for "today": never summed across currencies.
      const revenueToday = (resToday.body.revenue as { currency: string; amount: string }[]).sort((a, b) => a.currency.localeCompare(b.currency));
      expect(revenueToday).toEqual([
        { currency: 'GHS', amount: '300.00' },
        { currency: 'USD', amount: '500.00' },
      ]);

      // The 60-day-old RECEIVED_AT_WAREHOUSE event is excluded from "today"
      // but included in the wide range — proves warehouseActivity is
      // genuinely period-bound, not accidentally live.
      expect(resToday.body.warehouseActivity.received).toBe(2);
      expect(resWide.body.warehouseActivity.received).toBe(3);
      expect(resToday.body.warehouseActivity.processed).toBe(1);
      expect(resToday.body.warehouseActivity.loaded).toBe(1);
      expect(resToday.body.warehouseActivity.destinationReceived).toBe(1);
      expect(resToday.body.warehouseActivity.deliveredOrPickedUp).toBe(2); // DELIVERED + PICKED_UP combined
      expect(resToday.body.completedShipments).toBeGreaterThanOrEqual(1); // EXEC-TEST-COMPLETED
    });
  });

  describe('Container movement bucketing', () => {
    it('groups BOOKED/LOADING into loadingOrLoaded, DEPARTED/IN_TRANSIT into inTransit, ARRIVED into arrivedOrUnloading, and excludes CLOSED entirely', async () => {
      const res = await request(app.getHttpServer())
        .get(`/analytics/executive?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.containerMovement).toEqual({ loadingOrLoaded: 2, inTransit: 2, arrivedOrUnloading: 1 });
    });
  });

  describe('Empty state', () => {
    it('a tenant with no shipments/invoices/containers/exceptions yet returns all-zero/empty, not a crash or a fabricated value', async () => {
      const res = await request(app.getHttpServer())
        .get(`/analytics/executive?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${ownerTokenEmpty}`);
      expect(res.status).toBe(200);
      expect(res.body.activeShipments).toBe(0);
      expect(res.body.openInvoices).toBe(0);
      expect(res.body.outstandingBalance).toEqual([]);
      expect(res.body.revenue).toEqual([]);
      expect(res.body.completedShipments).toBe(0);
      expect(res.body.containerMovement).toEqual({ loadingOrLoaded: 0, inTransit: 0, arrivedOrUnloading: 0 });
      expect(res.body.warehouseActivity).toEqual({ received: 0, processed: 0, loaded: 0, destinationReceived: 0, deliveredOrPickedUp: 0 });
      expect(res.body.attention.overdueInvoices.count).toBe(0);
      expect(res.body.attention.staleExceptions.count).toBe(0);
      expect(res.body.shipmentVolumeTrend).toEqual([]);
      expect(res.body.revenueTrend).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention.
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function loginAsPortalCustomer(app: INestApplication, prisma: PrismaClient, tenantId: string): Promise<string> {
  const bcrypt = await import('bcrypt');
  const { randomUUID } = await import('crypto');
  const runId = randomUUID().slice(0, 8);
  const email = `analytics-portal-${runId}@example.test`;
  const password = 'TestPass123!';
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { tenantId, email, passwordHash, firstName: 'E2E', lastName: 'Portal', role: 'CUSTOMER' },
  });
  await prisma.customer.create({
    data: { tenantId, customerNumber: `E2E-ANALYTICS-${runId}`, firstName: 'E2E', lastName: 'Portal', email, userId: user.id },
  });
  return login(app, email, password);
}
