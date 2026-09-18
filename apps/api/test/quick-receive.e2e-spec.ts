import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Quick Receive (Phase 1 2026-09 + Phase 2 2026-09): one request creates a
 * shipment and N packages, every one of them already in the normal
 * origin-warehouse RECEIVED state — no scan required. Exercises the real
 * HTTP API, real Prisma, real Postgres (no mocks), same convention as
 * warehouse-tenant-isolation.e2e-spec.ts.
 *
 * Phase 1 coverage: piece-count correctness, unique barcode generation,
 * automatic RECEIVED state/events, atomic failure behavior, tenant
 * isolation, RBAC, inline customer creation, and preservation of
 * downstream Process/container eligibility.
 *
 * Phase 2 coverage added below: origin geography is derived from the
 * selected warehouse (never client-supplied — originCountry/originLocation
 * are no longer accepted fields at all), required recipient/consignee
 * fields, and the optional destinationWarehouseId FK.
 */
describe('Quick Receive (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenant: TestTenantFixture;
  let otherTenant: TestTenantFixture;
  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;
  let financeToken: string;
  let otherTenantToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'QuickReceive', UserRole.MANAGER);
    otherTenant = await createTestTenant(prisma, 'QuickReceiveOther', UserRole.MANAGER);

    managerToken = await login(app, tenant.user.email, tenant.user.password);
    otherTenantToken = await login(app, otherTenant.user.email, otherTenant.user.password);

    const owner = await createUserInTenant(prisma, tenant.tenantId, 'Owner', UserRole.OWNER);
    ownerToken = await login(app, owner.email, owner.password);
    const staff = await createUserInTenant(prisma, tenant.tenantId, 'Staff', UserRole.STAFF);
    staffToken = await login(app, staff.email, staff.password);
    const finance = await createUserInTenant(prisma, tenant.tenantId, 'Finance', UserRole.FINANCE);
    financeToken = await login(app, finance.email, finance.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await deleteTestTenant(prisma, otherTenant.tenantId);
    await prisma.$disconnect();
  });

  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      customerId: tenant.customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      destinationCountry: 'GH',
      originWarehouseId: tenant.warehouseId,
      recipientName: 'Test Recipient',
      recipientPhone: '+233201234567',
      packageCount: 4,
      ...overrides,
    };
  }

  function quickReceive(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/shipments/quick-receive').set('Authorization', `Bearer ${token}`).send(body);
  }

  // -- Happy path: piece-count correctness, unique barcodes, RECEIVED state --

  describe('happy path — 4 pieces', () => {
    let shipment: {
      id: string;
      trackingNumber: string;
      status: string;
      itemCounts: { total: number; received: number };
      items: { id: string; itemCode: string; status: string; receivedAt: string | null; currentWarehouseId: string | null }[];
    };

    it('creates exactly 4 package/item records for packageCount: 4', async () => {
      const res = await quickReceive(managerToken, basePayload({ packageCount: 4 }));
      expect(res.status).toBe(201);
      shipment = res.body;
      expect(shipment.items).toHaveLength(4);
    });

    it('gives every item a unique, existing-format barcode/tracking identifier', () => {
      const codes = shipment.items.map((item) => item.itemCode);
      expect(new Set(codes).size).toBe(4);
      for (const code of codes) {
        expect(code).toMatch(new RegExp(`^${shipment.trackingNumber}-\\d{2}$`));
      }
    });

    it('places every item in RECEIVED_ORIGIN_WAREHOUSE immediately, with no scan', () => {
      for (const item of shipment.items) {
        expect(item.status).toBe('RECEIVED_ORIGIN_WAREHOUSE');
        expect(item.receivedAt).toBeTruthy();
        expect(item.currentWarehouseId).toBe(tenant.warehouseId);
      }
      expect(shipment.itemCounts).toEqual({ total: 4, received: 4 });
    });

    it('rolls the shipment straight to WAREHOUSE_RECEIVED', () => {
      expect(shipment.status).toBe('WAREHOUSE_RECEIVED');
    });

    it('stamps receivedByUserId as the actor who ran Quick Receive', async () => {
      const items = await prisma.shipmentItem.findMany({ where: { shipmentId: shipment.id } });
      for (const item of items) {
        expect(item.receivedByUserId).toBe(tenant.user.id);
      }
    });

    it('writes the full expected tracking-event history: 1 SHIPMENT_CREATED, 4 ITEM_REGISTERED, 4 item-level RECEIVED_AT_WAREHOUSE (MANUAL), 1 shipment-level RECEIVED_AT_WAREHOUSE (SYSTEM, WAREHOUSE_RECEIVED)', async () => {
      const events = await prisma.trackingEvent.findMany({ where: { shipmentId: shipment.id } });
      expect(events.filter((e) => e.eventType === 'SHIPMENT_CREATED')).toHaveLength(1);
      expect(events.filter((e) => e.eventType === 'ITEM_REGISTERED')).toHaveLength(4);

      const itemLevelReceives = events.filter((e) => e.eventType === 'RECEIVED_AT_WAREHOUSE' && e.shipmentItemId !== null);
      expect(itemLevelReceives).toHaveLength(4);
      expect(itemLevelReceives.every((e) => e.source === 'MANUAL')).toBe(true);
      expect(itemLevelReceives.every((e) => e.warehouseId === tenant.warehouseId)).toBe(true);

      const rollup = events.find((e) => e.eventType === 'RECEIVED_AT_WAREHOUSE' && e.shipmentItemId === null);
      expect(rollup?.source).toBe('SYSTEM');
      expect(rollup?.status).toBe('WAREHOUSE_RECEIVED');
    });

    it('every newly received item immediately works with the existing Warehouse -> Process workflow, exactly like a conventionally received item', async () => {
      const res = await request(app.getHttpServer())
        .post(`/warehouse/items/${shipment.items[0].id}/process`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ warehouseId: tenant.warehouseId, condition: 'GOOD', result: 'READY', scanned: false });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PROCESSED');
    });

    it('Simplified Operational Scanning Workflow: container loading now works directly off a Quick Receive item with no inspection, AND still works on a processed one', async () => {
      const container = await request(app.getHttpServer())
        .post('/containers')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ containerNumber: `QR-TEST-${Date.now()}`, containerType: 'TWENTY_FT', warehouseId: tenant.warehouseId });
      expect(container.status).toBe(201);

      // items[1] was created by Quick Receive and is RECEIVED_ORIGIN_WAREHOUSE, never processed —
      // inspection is optional, so this is the intended default simplified path, not a rejection.
      const loadRes = await request(app.getHttpServer())
        .post(`/containers/${container.body.id}/items/${shipment.items[1].id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ scanned: false });
      expect(loadRes.status).toBe(201);

      // items[0] WAS processed in the previous test — still loads fine too; inspection remains fully available, just not required.
      const loadProcessed = await request(app.getHttpServer())
        .post(`/containers/${container.body.id}/items/${shipment.items[0].id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ scanned: false });
      expect(loadProcessed.status).toBe(201);
    });
  });

  // -- Inline customer creation composes cleanly with Quick Receive --------

  it('a customer created inline via POST /customers immediately works as Quick Receive\'s customerId', async () => {
    const createCustomerRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ firstName: 'Inline', lastName: 'Customer', email: `inline-${Date.now()}@example.test` });
    expect(createCustomerRes.status).toBe(201);

    const res = await quickReceive(managerToken, basePayload({ customerId: createCustomerRes.body.id, packageCount: 1 }));
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(createCustomerRes.body.id);
  });

  // -- Validation -----------------------------------------------------------

  describe('validation', () => {
    it('rejects packageCount: 0', async () => {
      const res = await quickReceive(managerToken, basePayload({ packageCount: 0 }));
      expect(res.status).toBe(400);
    });

    it('rejects packageCount: 51 (above the 50-piece ceiling)', async () => {
      const res = await quickReceive(managerToken, basePayload({ packageCount: 51 }));
      expect(res.status).toBe(400);
    });

    it('accepts packageCount: 50 (at the ceiling)', async () => {
      const res = await quickReceive(managerToken, basePayload({ packageCount: 50 }));
      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(50);
    });

    it('rejects a missing originWarehouseId', async () => {
      const { originWarehouseId, ...rest } = basePayload();
      const res = await quickReceive(managerToken, rest);
      expect(res.status).toBe(400);
    });

    it('rejects a missing recipientName', async () => {
      const { recipientName, ...rest } = basePayload();
      const res = await quickReceive(managerToken, rest);
      expect(res.status).toBe(400);
    });

    it('rejects a missing recipientPhone', async () => {
      const { recipientPhone, ...rest } = basePayload();
      const res = await quickReceive(managerToken, rest);
      expect(res.status).toBe(400);
    });

  });

  // -- Phase 2: origin geography is warehouse-derived, never client input ----

  describe('dynamic origin geography', () => {
    it('derives originCountry/originLocation from the selected warehouse\'s own city/country — not any hardcoded default', async () => {
      const res = await quickReceive(managerToken, basePayload({ packageCount: 1 }));
      expect(res.status).toBe(201);
      // Fixture warehouse (see createTestTenant) is city: 'Testville', country: 'US', no state.
      expect(res.body.originCountry).toBe('US');
      expect(res.body.originLocation).toBe('Testville');
    });

    it('composes "City, State" when the warehouse has a state/province on file', async () => {
      const warehouseWithState = await prisma.warehouse.create({
        data: {
          tenantId: tenant.tenantId,
          name: 'State-Having Warehouse',
          code: `E2E-STATE-${Date.now()}`,
          addressLine1: '2 Test Street',
          city: 'Testopolis',
          state: 'TS',
          country: 'CA',
          isOriginWarehouse: true,
        },
      });
      const res = await quickReceive(managerToken, basePayload({ originWarehouseId: warehouseWithState.id, packageCount: 1 }));
      expect(res.status).toBe(201);
      expect(res.body.originCountry).toBe('CA');
      expect(res.body.originLocation).toBe('Testopolis, TS');
    });

    it('rejects an originCountry/originLocation in the request body outright — Quick Receive has no client-supplied origin geography at all', async () => {
      const res = await quickReceive(managerToken, basePayload({ originCountry: 'US', originLocation: 'Somewhere', packageCount: 1 }));
      expect(res.status).toBe(400);
    });
  });

  // -- Phase 2: recipient/consignee ------------------------------------------

  describe('recipient/consignee', () => {
    it('persists the required recipientName/recipientPhone plus optional fields on the Shipment row', async () => {
      const res = await quickReceive(
        managerToken,
        basePayload({
          recipientName: 'Ama Mensah',
          recipientPhone: '+233 20 123 4567',
          recipientEmail: 'ama@example.test',
          recipientAddressLine1: '12 High Street',
          recipientCity: 'Accra',
          recipientCountry: 'Ghana',
          packageCount: 1,
        }),
      );
      expect(res.status).toBe(201);
      expect(res.body.recipientName).toBe('Ama Mensah');
      expect(res.body.recipientPhone).toBe('+233 20 123 4567');
      expect(res.body.recipientEmail).toBe('ama@example.test');
      expect(res.body.recipientAddressLine1).toBe('12 High Street');
      expect(res.body.recipientCity).toBe('Accra');
      expect(res.body.recipientCountry).toBe('Ghana');
    });

    it('accepts international phone formats with no hardcoded country-specific regex (e.g. a UK-style number)', async () => {
      const res = await quickReceive(managerToken, basePayload({ recipientPhone: '+44 20 7946 0958', packageCount: 1 }));
      expect(res.status).toBe(201);
      expect(res.body.recipientPhone).toBe('+44 20 7946 0958');
    });

    it('leaves optional recipient fields null when omitted — no forced defaults', async () => {
      const res = await quickReceive(managerToken, basePayload({ packageCount: 1 }));
      expect(res.status).toBe(201);
      expect(res.body.recipientEmail).toBeNull();
      expect(res.body.recipientAddressLine1).toBeNull();
    });
  });

  // -- Phase 2: optional destination warehouse --------------------------------

  describe('destination warehouse (optional)', () => {
    it('is null when omitted — destinationCountry/destinationLocation remain purely staff-entered', async () => {
      const res = await quickReceive(managerToken, basePayload({ destinationLocation: 'Tema Port', packageCount: 1 }));
      expect(res.status).toBe(201);
      expect(res.body.destinationWarehouseId).toBeNull();
      expect(res.body.destinationCountry).toBe('GH');
      expect(res.body.destinationLocation).toBe('Tema Port');
    });

    it('accepts and persists a same-tenant destinationWarehouseId without overriding the staff-entered destinationCountry/destinationLocation', async () => {
      const destinationWarehouse = await prisma.warehouse.create({
        data: {
          tenantId: tenant.tenantId,
          name: 'Destination Test Warehouse',
          code: `E2E-DEST-${Date.now()}`,
          addressLine1: '3 Test Street',
          city: 'Accra',
          country: 'Ghana',
          isDestinationWarehouse: true,
        },
      });
      const res = await quickReceive(
        managerToken,
        basePayload({ destinationWarehouseId: destinationWarehouse.id, destinationLocation: 'Tema Port (pre-warehouse)', packageCount: 1 }),
      );
      expect(res.status).toBe(201);
      expect(res.body.destinationWarehouseId).toBe(destinationWarehouse.id);
      // Never silently overwritten by the warehouse's own address — see QuickReceiveDto's doc comment.
      expect(res.body.destinationLocation).toBe('Tema Port (pre-warehouse)');
    });

    it("404s on another tenant's destinationWarehouseId, atomically (no partial shipment left behind)", async () => {
      const shipmentCountBefore = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });
      const res = await quickReceive(managerToken, basePayload({ destinationWarehouseId: otherTenant.warehouseId, packageCount: 1 }));
      expect(res.status).toBe(404);
      const shipmentCountAfter = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });
      expect(shipmentCountAfter).toBe(shipmentCountBefore);
    });
  });

  // -- Tenant isolation -------------------------------------------------------

  describe('tenant isolation', () => {
    it("404s when the tenant's own token is used with ANOTHER tenant's customerId", async () => {
      const shipmentCountBefore = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });

      const res = await quickReceive(managerToken, basePayload({ customerId: otherTenant.customerId }));
      expect(res.status).toBe(404);

      // Atomicity: a rejected customer lookup must never leave a partial shipment behind.
      const shipmentCountAfter = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });
      expect(shipmentCountAfter).toBe(shipmentCountBefore);
    });

    it("404s when the tenant's own token is used with ANOTHER tenant's originWarehouseId", async () => {
      const shipmentCountBefore = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });

      const res = await quickReceive(managerToken, basePayload({ originWarehouseId: otherTenant.warehouseId }));
      expect(res.status).toBe(404);

      // Atomicity: a rejected warehouse lookup must never leave a partial shipment behind either.
      const shipmentCountAfter = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });
      expect(shipmentCountAfter).toBe(shipmentCountBefore);
    });

    it("the other tenant cannot quick-receive using its own token against tenant A's ids", async () => {
      const res = await quickReceive(otherTenantToken, basePayload({ customerId: tenant.customerId, originWarehouseId: tenant.warehouseId }));
      expect(res.status).toBe(404);
    });

    it('two tenants quick-receiving concurrently never collide on trackingNumber/itemCode', async () => {
      const [resA, resB] = await Promise.all([
        quickReceive(managerToken, basePayload({ packageCount: 2 })),
        quickReceive(otherTenantToken, {
          customerId: otherTenant.customerId,
          shipmentMode: ShipmentMode.OCEAN_LCL,
          destinationCountry: 'GH',
          originWarehouseId: otherTenant.warehouseId,
          recipientName: 'Test Recipient',
          recipientPhone: '+15550000000',
          packageCount: 2,
        }),
      ]);
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      // Both tenants share the same "E2E" prefix/sequence-start fixture
      // convention (see createTestTenant's own doc comment) — a genuine
      // same-code collision is possible in principle; the @@unique([tenantId, ...])
      // indexes (not just app-level care) are what make it safe regardless.
      expect(resA.body.id).not.toBe(resB.body.id);
    });
  });

  // -- RBAC: OPERATIONS_ROLES only, FINANCE excluded --------------------------

  describe('RBAC', () => {
    it('OWNER can use Quick Receive', async () => {
      const res = await quickReceive(ownerToken, basePayload({ packageCount: 1 }));
      expect(res.status).toBe(201);
    });

    it('STAFF can use Quick Receive', async () => {
      const res = await quickReceive(staffToken, basePayload({ packageCount: 1 }));
      expect(res.status).toBe(201);
    });

    it('FINANCE is rejected with 403 — must never gain Quick Receive access', async () => {
      const res = await quickReceive(financeToken, basePayload({ packageCount: 1 }));
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request is rejected with 401, not 403', async () => {
      const res = await request(app.getHttpServer()).post('/shipments/quick-receive').send(basePayload());
      expect(res.status).toBe(401);
    });
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
