import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import {
  createCustomerWithPortalUser,
  createOrphanedCustomerUser,
  createTestTenant,
  deleteTestTenant,
  TestPortalCustomerFixture,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end proof of Stage 2C's authorization boundary: every
 * /portal/* endpoint is reachable only by an authenticated CUSTOMER, only
 * for that customer's own Customer record, only within that customer's
 * own tenant — and every other role/tenant/customer combination is
 * rejected the same way an unauthenticated or malformed request would be
 * (401/403/404), never with a partial or leaked response.
 */
describe('Customer Portal authorization & isolation (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let staffTokenA: string;

  let customerA1: TestPortalCustomerFixture;
  let customerA2: TestPortalCustomerFixture;
  let customerB1: TestPortalCustomerFixture;

  let customerA1Token: string;
  let customerA2Token: string;
  let customerB1Token: string;

  let shipmentA1: { id: string; trackingNumber: string };
  let shipmentB1: { id: string; trackingNumber: string };

  const cleanupUserIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'PortA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'PortB', UserRole.WAREHOUSE_MANAGER);
    staffTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    const staffTokenB = await login(app, tenantB.user.email, tenantB.user.password);

    customerA1 = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'A1');
    customerA2 = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'A2');
    customerB1 = await createCustomerWithPortalUser(prisma, tenantB.tenantId, 'B1');

    customerA1Token = await login(app, customerA1.user.email, customerA1.user.password);
    customerA2Token = await login(app, customerA2.user.email, customerA2.user.password);
    customerB1Token = await login(app, customerB1.user.email, customerB1.user.password);

    shipmentA1 = await createShipmentForCustomerId(app, staffTokenA, customerA1.customerId, 1);
    shipmentB1 = await createShipmentForCustomerId(app, staffTokenB, customerB1.customerId, 1);
  });

  afterAll(async () => {
    await app.close();
    // Tenant-cascade cleanup covers everything created under tenantA/tenantB
    // (both staff users, both portal customers+their linked users, both
    // shipments). PLATFORM_ADMIN test users below have tenantId = null, so
    // they fall outside that cascade and are deleted explicitly.
    for (const id of cleanupUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  describe('Unauthenticated access', () => {
    it('GET /portal/me with no token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/portal/me');
      expect(res.status).toBe(401);
    });

    it('GET /portal/shipments with no token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/portal/shipments');
      expect(res.status).toBe(401);
    });

    it('GET /portal/shipments/:id with no token → 401', async () => {
      const res = await request(app.getHttpServer()).get(`/portal/shipments/${shipmentA1.id}`);
      expect(res.status).toBe(401);
    });
  });

  describe('Valid CUSTOMER access to its own data', () => {
    it('GET /portal/me returns the caller\'s own profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/me')
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(customerA1.user.email);
      expect(res.body.firstName).toBe('E2E');
      expect(res.body.lastName).toBe('A1');
    });

    it("GET /portal/shipments lists only shipments belonging to the caller's own Customer record", async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/shipments')
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(shipmentA1.id);
      expect(res.body[0].trackingNumber).toBe(shipmentA1.trackingNumber);
    });

    it('a second, shipment-less customer in the same tenant sees an empty list — never another customer\'s shipment', async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/shipments')
        .set('Authorization', `Bearer ${customerA2Token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('GET /portal/shipments/:id returns full detail for the caller\'s own shipment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/portal/shipments/${shipmentA1.id}`)
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(shipmentA1.id);
      expect(res.body.trackingNumber).toBe(shipmentA1.trackingNumber);
      expect(Array.isArray(res.body.timeline)).toBe(true);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('Cross-customer isolation (same tenant)', () => {
    it('Customer A2 gets 404 fetching Customer A1\'s real shipment id by URL manipulation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/portal/shipments/${shipmentA1.id}`)
        .set('Authorization', `Bearer ${customerA2Token}`);
      expect(res.status).toBe(404);
    });

    it('Customer A2 gets the identical 404 shape for a genuinely nonexistent id — existence is never confirmable', async () => {
      const realId = await request(app.getHttpServer())
        .get(`/portal/shipments/${shipmentA1.id}`)
        .set('Authorization', `Bearer ${customerA2Token}`);
      const fakeId = await request(app.getHttpServer())
        .get('/portal/shipments/does-not-exist-at-all')
        .set('Authorization', `Bearer ${customerA2Token}`);
      expect(realId.status).toBe(404);
      expect(fakeId.status).toBe(404);
      expect(realId.body.message).toBe(fakeId.body.message);
    });

    // There is no endpoint that accepts an arbitrary customerId — /portal/me
    // always resolves from the caller's own JWT — so "Customer A2 fetching
    // Customer A1's profile" has no route to even attempt; the "own profile
    // only" test above is the complete proof for that surface.
  });

  describe('Cross-tenant isolation', () => {
    it('Customer in Tenant A gets 404 fetching a shipment id belonging to Tenant B', async () => {
      const res = await request(app.getHttpServer())
        .get(`/portal/shipments/${shipmentB1.id}`)
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(res.status).toBe(404);
    });

    it('Customer in Tenant B cannot see Tenant A\'s shipment in their own list', async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/shipments')
        .set('Authorization', `Bearer ${customerB1Token}`);
      expect(res.status).toBe(200);
      expect(res.body.every((s: { id: string }) => s.id !== shipmentA1.id)).toBe(true);
    });
  });

  describe('Staff/customer role boundary', () => {
    it.each([['/customers'], ['/shipments'], ['/users/staff'], ['/tenants']])(
      'a CUSTOMER token gets 403 on staff route GET %s',
      async (path) => {
        const res = await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${customerA1Token}`);
        expect(res.status).toBe(403);
      },
    );

    it('a staff token gets 403 on GET /portal/me — not silently treated as a customer identity', async () => {
      const res = await request(app.getHttpServer()).get('/portal/me').set('Authorization', `Bearer ${staffTokenA}`);
      expect(res.status).toBe(403);
    });

    it('a staff token gets 403 on GET /portal/shipments', async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/shipments')
        .set('Authorization', `Bearer ${staffTokenA}`);
      expect(res.status).toBe(403);
    });

    it('a PLATFORM_ADMIN token — the one role with legitimate cross-tenant reach elsewhere — still gets 403 on the portal', async () => {
      const runId = Date.now();
      const adminPassword = 'TestPass123!';
      const admin = await prisma.user.create({
        data: {
          tenantId: null,
          email: `platform-admin-portal-e2e-${runId}@example.test`,
          passwordHash: await bcrypt.hash(adminPassword, 10),
          firstName: 'E2E',
          lastName: 'PlatformAdmin',
          role: UserRole.PLATFORM_ADMIN,
        },
      });
      cleanupUserIds.push(admin.id);

      const adminToken = await login(app, admin.email, adminPassword);
      const meRes = await request(app.getHttpServer()).get('/portal/me').set('Authorization', `Bearer ${adminToken}`);
      const listRes = await request(app.getHttpServer())
        .get('/portal/shipments')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(meRes.status).toBe(403);
      expect(listRes.status).toBe(403);
    });
  });

  describe('CUSTOMER account with no linked Customer record', () => {
    it('fails closed with 403 on both endpoints — never falls back to tenant-wide access', async () => {
      const orphan = await createOrphanedCustomerUser(prisma, tenantA.tenantId, 'Orphan');
      const orphanToken = await login(app, orphan.email, orphan.password);

      const meRes = await request(app.getHttpServer()).get('/portal/me').set('Authorization', `Bearer ${orphanToken}`);
      expect(meRes.status).toBe(403);

      const listRes = await request(app.getHttpServer())
        .get('/portal/shipments')
        .set('Authorization', `Bearer ${orphanToken}`);
      expect(listRes.status).toBe(403);
      // In particular: never the whole tenant's shipment list.
      expect(listRes.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: shipmentA1.id })]));
    });
  });

  describe('Tenant-scoped email uniqueness (Stage 2C-1 schema change)', () => {
    it('allows the same email to exist at two different tenants', async () => {
      const email = `dual-tenant-${Date.now()}@example.test`;
      const userInA = await prisma.user.create({
        data: { tenantId: tenantA.tenantId, email, passwordHash: 'x', firstName: 'Dup', lastName: 'One', role: UserRole.CUSTOMER },
      });
      const userInB = await prisma.user.create({
        data: { tenantId: tenantB.tenantId, email, passwordHash: 'x', firstName: 'Dup', lastName: 'Two', role: UserRole.CUSTOMER },
      });
      expect(userInA.id).not.toBe(userInB.id);
      expect(userInA.email).toBe(userInB.email);
    });

    it('rejects a duplicate email within the same tenant', async () => {
      const email = `same-tenant-dup-${Date.now()}@example.test`;
      await prisma.user.create({
        data: { tenantId: tenantA.tenantId, email, passwordHash: 'x', firstName: 'Dup', lastName: 'One', role: UserRole.CUSTOMER },
      });
      await expect(
        prisma.user.create({
          data: { tenantId: tenantA.tenantId, email, passwordHash: 'x', firstName: 'Dup', lastName: 'Two', role: UserRole.CUSTOMER },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Portal shipment detail — customer-safe projection', () => {
    it('exposes the caller\'s own shipment id, but never any other internal id, staff identity, or another customer\'s data', async () => {
      const res = await request(app.getHttpServer())
        .get(`/portal/shipments/${shipmentA1.id}`)
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(shipmentA1.id);

      const raw = JSON.stringify(res.body);

      // Internal/other-party ids that must never appear.
      expect(raw).not.toContain(tenantA.tenantId);
      expect(raw).not.toContain(tenantA.warehouseId);
      expect(raw).not.toContain(customerA1.customerId);
      expect(raw).not.toContain(customerA2.customerId);
      expect(raw).not.toContain(customerB1.customerId);
      expect(raw).not.toContain(shipmentB1.id);
      expect(raw).not.toContain(staffTokenA);

      // Field names that only ever carry internal/staff/financial detail —
      // same allowlist Stage 2A's public-tracking suite checks, since this
      // is the exact same projection.
      for (const forbiddenKey of [
        'declaredValue',
        'notes',
        'metadata',
        'warehouseId',
        'customerId',
        'createdByUser',
        'scanIdentifier',
        'passwordHash',
        'tenantId',
      ]) {
        expect(raw).not.toContain(forbiddenKey);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing per-file-helpers convention.
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function createShipmentForCustomerId(
  app: INestApplication,
  staffToken: string,
  customerId: string,
  itemCount: number,
): Promise<{ id: string; trackingNumber: string }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      items: Array.from({ length: itemCount }, () => ({
        itemType: ShipmentItemType.BOX,
        description: 'Portal isolation e2e test box',
      })),
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string; trackingNumber: string };
}
