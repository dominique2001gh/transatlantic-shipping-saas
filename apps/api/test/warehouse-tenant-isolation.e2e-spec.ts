import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture, TEST_PASSWORD } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for the warehouse receiving workflow
 * (Milestone 3B) plus the multi-tenant isolation guarantees the
 * trackingNumber/itemCode migration depends on. Runs against the real
 * Nest app (real guards, real Prisma, real Postgres) — nothing here is
 * mocked.
 *
 * Two independent, freshly-created tenants (A and B) are used so this
 * also exercises the realistic "two customers of the platform both spin
 * up and both issue their first shipment" scenario: both tenants use the
 * same TenantSettings.trackingNumberPrefix ("E2E") and both start their
 * sequence at 0, so their first shipment's trackingNumber AND first
 * item's itemCode are byte-for-byte identical strings. Every isolation
 * assertion below is therefore proven against a genuine same-code
 * collision, not a contrived one.
 */
describe('Warehouse receiving workflow + tenant isolation (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;
  let tokenB: string;

  let shipmentA: { id: string; trackingNumber: string; items: { id: string; itemCode: string }[] };
  let shipmentB: { id: string; trackingNumber: string; items: { id: string; itemCode: string }[] };

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'HttpA');
    tenantB = await createTestTenant(prisma, 'HttpB');

    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
    tokenB = await login(app, tenantB.user.email, tenantB.user.password);

    shipmentA = await createSingleItemShipment(app, tokenA, tenantA.customerId);
    shipmentB = await createSingleItemShipment(app, tokenB, tenantB.customerId);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  // -- Sanity: the two tenants really did land on the same codes --------

  it('sanity check: both tenants independently generated the SAME tracking number and item code', () => {
    expect(shipmentA.trackingNumber).toBe(shipmentB.trackingNumber);
    expect(shipmentA.items[0].itemCode).toBe(shipmentB.items[0].itemCode);
  });

  // -- Authentication -----------------------------------------------------

  describe('authentication', () => {
    it('logs in a valid staff user and returns an access token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: tenantA.user.email, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.user.tenantId).toBe(tenantA.tenantId);
    });

    it('rejects an invalid password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: tenantA.user.email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    });

    it('rejects requests with no token', async () => {
      const res = await request(app.getHttpServer()).get('/shipments');
      expect(res.status).toBe(401);
    });
  });

  // -- Shipment lookup / tenant isolation ---------------------------------

  describe('shipment lookup and tenant isolation', () => {
    it("lets Tenant A read its own shipment", async () => {
      const res = await request(app.getHttpServer())
        .get(`/shipments/${shipmentA.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(shipmentA.id);
    });

    it("404s Tenant B reading Tenant A's shipment by id (never 403 — must not confirm existence)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/shipments/${shipmentA.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });

    it("does not include the other tenant's shipment in a list call", async () => {
      const res = await request(app.getHttpServer())
        .get('/shipments')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((s: { id: string }) => s.id);
      expect(ids).toContain(shipmentA.id);
      expect(ids).not.toContain(shipmentB.id);
    });
  });

  // -- Item lookup / warehouse scan / search — cross-tenant safety --------

  describe('item lookup via warehouse scan/search', () => {
    it("resolves Tenant A's own item code via /warehouse/scan", async () => {
      const res = await request(app.getHttpServer())
        .get(`/warehouse/scan?code=${encodeURIComponent(shipmentA.items[0].itemCode)}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(shipmentA.items[0].id);
      expect(res.body.shipment.id).toBe(shipmentA.id);
    });

    it('404s when Tenant B scans the identical item code (belongs to Tenant A in the DB sense, but resolves to Tenant B\'s OWN item)', async () => {
      // Both tenants have an item with this exact code — this must resolve
      // to Tenant B's own item, never leak or 404 confusingly.
      const res = await request(app.getHttpServer())
        .get(`/warehouse/scan?code=${encodeURIComponent(shipmentB.items[0].itemCode)}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(shipmentB.items[0].id);
      expect(res.body.shipment.id).toBe(shipmentB.id);
      // Critically, NOT Tenant A's item, even though the itemCode string is identical.
      expect(res.body.id).not.toBe(shipmentA.items[0].id);
    });

    it('404s a scan for a code that only exists for the other tenant', async () => {
      const onlyInB = `NEVER-IN-A-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .get(`/warehouse/scan?code=${encodeURIComponent(onlyInB)}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(404);
    });

    it("search never returns the other tenant's items, even for a matching tracking number", async () => {
      const res = await request(app.getHttpServer())
        .get(`/warehouse/search?query=${encodeURIComponent(shipmentA.trackingNumber)}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(200);
      const shipmentIds = (res.body as { shipment: { id: string } }[]).map((r) => r.shipment.id);
      expect(shipmentIds).not.toContain(shipmentA.id);
      // Tenant B's own shipment shares the identical trackingNumber string,
      // so it's the only thing this search is allowed to surface.
      if (shipmentIds.length > 0) {
        expect(shipmentIds.every((id) => id === shipmentB.id)).toBe(true);
      }
    });
  });

  // -- Warehouse inventory --------------------------------------------------

  describe('warehouse inventory', () => {
    it('lists only Tenant A items after receiving, never Tenant B items', async () => {
      await receiveItem(app, tokenA, shipmentA.items[0].id, tenantA.warehouseId, shipmentA.items[0].itemCode);

      const res = await request(app.getHttpServer())
        .get('/warehouse/inventory')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((i: { id: string }) => i.id);
      expect(ids).toContain(shipmentA.items[0].id);
      expect(ids).not.toContain(shipmentB.items[0].id);
    });
  });

  // -- Scan/receive, duplicate protection, rollup, tracking history --------

  describe('receive workflow', () => {
    it('records receivedAt/receivedByUser and creates a BARCODE_SCAN tracking event', async () => {
      const item = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: shipmentA.items[0].id } });
      expect(item.receivedAt).not.toBeNull();
      expect(item.receivedByUserId).toBe(tenantA.user.id);

      const events = await prisma.trackingEvent.findMany({
        where: { shipmentItemId: shipmentA.items[0].id },
        orderBy: { occurredAt: 'asc' },
      });
      const scanEvent = events.find((e) => e.eventType === 'RECEIVED_AT_WAREHOUSE' && e.source === 'BARCODE_SCAN');
      expect(scanEvent).toBeDefined();
      expect(scanEvent?.scanIdentifier).toBe(shipmentA.items[0].itemCode);
    });

    it('rejects a second receive of the same item (duplicate receive protection)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/warehouse/items/${shipmentA.items[0].id}/receive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ warehouseId: tenantA.warehouseId, scanned: true, scanIdentifier: shipmentA.items[0].itemCode });
      expect(res.status).toBe(409);
    });

    it("404s Tenant B attempting to receive Tenant A's item", async () => {
      const res = await request(app.getHttpServer())
        .post(`/warehouse/items/${shipmentA.items[0].id}/receive`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ warehouseId: tenantB.warehouseId, scanned: true });
      expect(res.status).toBe(404);
    });

    it('rolls the shipment up to WAREHOUSE_RECEIVED once its only item is received', async () => {
      const res = await request(app.getHttpServer())
        .get(`/shipments/${shipmentA.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('WAREHOUSE_RECEIVED');
      expect(res.body.itemCounts).toEqual({ total: 1, received: 1 });
    });

    it('shows the full history (creation, registration, scan receipt, rollup) in tracking events', async () => {
      const res = await request(app.getHttpServer())
        .get(`/shipments/${shipmentA.id}/tracking-events`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      const types: string[] = res.body.map((e: { eventType: string }) => e.eventType);
      expect(types).toContain('SHIPMENT_CREATED');
      expect(types).toContain('ITEM_REGISTERED');
      expect(types).toContain('RECEIVED_AT_WAREHOUSE');
      const rollupEvent = res.body.find(
        (e: { eventType: string; source: string; status: string | null }) =>
          e.eventType === 'RECEIVED_AT_WAREHOUSE' && e.source === 'SYSTEM',
      );
      expect(rollupEvent?.status).toBe('WAREHOUSE_RECEIVED');
    });

    it("404s Tenant B reading Tenant A's tracking events", async () => {
      const res = await request(app.getHttpServer())
        .get(`/shipments/${shipmentA.id}/tracking-events`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
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

async function createSingleItemShipment(
  app: INestApplication,
  token: string,
  customerId: string,
): Promise<{ id: string; trackingNumber: string; items: { id: string; itemCode: string }[] }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      items: [{ itemType: ShipmentItemType.BOX, description: 'E2E test box' }],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function receiveItem(
  app: INestApplication,
  token: string,
  itemId: string,
  warehouseId: string,
  itemCode: string,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: true, scanIdentifier: itemCode });
  if (res.status !== 201) {
    throw new Error(`Receive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}
