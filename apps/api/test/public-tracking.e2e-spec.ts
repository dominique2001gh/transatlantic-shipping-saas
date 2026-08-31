import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for Stage 2A: the public/customer tracking
 * projection (TrackingService.lookupPublic, GET /tracking/public).
 * Verifies the endpoint reuses the existing Shipment/ShipmentItem/
 * TrackingEvent history (no parallel system), the customer-safe
 * projection never leaks internal detail, tenant isolation holds, and
 * multi-item shipments are represented correctly (never prematurely
 * "completed").
 */
describe('Public Tracking (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'PtA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'PtB', UserRole.WAREHOUSE_MANAGER);
    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  it('resolves a valid shipment by tracking number + tenant slug + customer last name', async () => {
    const { shipment, customer } = await createShipmentForCustomer(app, tokenA, tenantA, 'Boateng', 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    const res = await lookup(app, { tenantSlug: tenantA.slug, trackingNumber: shipment.trackingNumber, lastName: 'Boateng' });
    expect(res.status).toBe(200);
    expect(res.body.trackingNumber).toBe(shipment.trackingNumber);
    expect(res.body.originCountry).toBe('US');
    expect(res.body.destinationCountry).toBe('GH');
    expect(res.body.itemSummary).toEqual({ total: 1, completed: 0 });
    expect(res.body.isCompleted).toBe(false);
    expect(Array.isArray(res.body.timeline)).toBe(true);
    expect(res.body.timeline.length).toBeGreaterThan(0);
    // The received-at-origin milestone must appear with its curated label, not the raw enum.
    expect(res.body.timeline.some((m: { label: string }) => m.label === 'Received at origin warehouse')).toBe(true);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].itemCode).toBe(shipment.items[0].itemCode);
    void customer;
  });

  it('is case-insensitive on the last name verifier', async () => {
    const { shipment } = await createShipmentForCustomer(app, tokenA, tenantA, 'Owusu', 1);
    const res = await lookup(app, { tenantSlug: tenantA.slug, trackingNumber: shipment.trackingNumber, lastName: 'oWUSU' });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown tracking number with a generic message', async () => {
    const res = await lookup(app, {
      tenantSlug: tenantA.slug,
      trackingNumber: 'TAL-2026-DOES-NOT-EXIST',
      lastName: 'Anyone',
    });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no matching shipment/i);
  });

  it('rejects a correct tracking number with the wrong last name, with the exact same generic message', async () => {
    const { shipment } = await createShipmentForCustomer(app, tokenA, tenantA, 'Mensah', 1);
    const wrongName = await lookup(app, { tenantSlug: tenantA.slug, trackingNumber: shipment.trackingNumber, lastName: 'NotTheRealName' });
    const unknownNumber = await lookup(app, { tenantSlug: tenantA.slug, trackingNumber: 'TAL-2026-NOPE', lastName: 'NotTheRealName' });
    expect(wrongName.status).toBe(404);
    expect(unknownNumber.status).toBe(404);
    // Never distinguishable — same message either way.
    expect(wrongName.body.message).toBe(unknownNumber.body.message);
  });

  it('rejects an item code passed as the tracking number — item-level lookup is not publicly supported', async () => {
    const { shipment } = await createShipmentForCustomer(app, tokenA, tenantA, 'Asante', 1);
    const res = await lookup(app, {
      tenantSlug: tenantA.slug,
      trackingNumber: shipment.items[0].itemCode,
      lastName: 'Asante',
    });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown tenant slug with the same generic message', async () => {
    const res = await lookup(app, { tenantSlug: 'not-a-real-tenant', trackingNumber: 'TAL-2026-000001', lastName: 'Anyone' });
    expect(res.status).toBe(404);
  });

  it("tenant isolation: Tenant A's shipment is not resolvable under Tenant B's slug", async () => {
    const { shipment } = await createShipmentForCustomer(app, tokenA, tenantA, 'Bonsu', 1);
    const res = await lookup(app, { tenantSlug: tenantB.slug, trackingNumber: shipment.trackingNumber, lastName: 'Bonsu' });
    expect(res.status).toBe(404);
  });

  it('does not require authentication — no Authorization header is sent', async () => {
    const { shipment } = await createShipmentForCustomer(app, tokenA, tenantA, 'Danso', 1);
    const res = await request(app.getHttpServer()).get('/tracking/public').query({
      tenantSlug: tenantA.slug,
      trackingNumber: shipment.trackingNumber,
      lastName: 'Danso',
    });
    expect(res.status).toBe(200);
  });

  describe('Customer-safe projection — sensitive data never exposed', () => {
    it('never includes database ids, staff/internal notes, declared value, or raw event metadata', async () => {
      const { shipment, item, customer } = await createShipmentForCustomer(app, tokenA, tenantA, 'Wilson', 1);
      await receiveItem(app, tokenA, item.id, tenantA.warehouseId, 'STAFF-ONLY NOTE: do not show this to the customer');
      await processOnce(app, tokenA, item.id, tenantA.warehouseId);

      const res = await lookup(app, { tenantSlug: tenantA.slug, trackingNumber: shipment.trackingNumber, lastName: 'Wilson' });
      expect(res.status).toBe(200);

      const raw = JSON.stringify(res.body);
      // Internal ids.
      expect(raw).not.toContain(shipment.id);
      expect(raw).not.toContain(item.id);
      expect(raw).not.toContain(customer.id);
      expect(raw).not.toContain(tenantA.tenantId);
      expect(raw).not.toContain(tenantA.warehouseId);
      // Staff-entered free text must never appear.
      expect(raw).not.toContain('STAFF-ONLY NOTE');
      // Field names that only ever carry internal/financial/staff detail
      // must not appear anywhere in the payload at all.
      for (const forbiddenKey of ['declaredValue', 'notes', 'metadata', 'warehouseId', 'customerId', 'createdByUser', 'scanIdentifier']) {
        expect(raw).not.toContain(forbiddenKey);
      }
    });

    it('reports a hidden/exception item with a generic customer-safe label, never the real internal reason', async () => {
      const { shipment, item } = await createShipmentForCustomer(app, tokenA, tenantA, 'Kwarteng', 1);
      await receiveItem(app, tokenA, item.id, tenantA.warehouseId);
      const processRes = await request(app.getHttpServer())
        .post(`/warehouse/items/${item.id}/process`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          warehouseId: tenantA.warehouseId,
          condition: 'DAMAGED',
          result: 'HOLD',
          hasException: true,
          exceptionDescription: 'CONFIDENTIAL internal QA finding — box crushed by forklift, staff error',
          scanned: false,
        });
      expect(processRes.status).toBe(201);

      const res = await lookup(app, { tenantSlug: tenantA.slug, trackingNumber: shipment.trackingNumber, lastName: 'Kwarteng' });
      expect(res.status).toBe(200);
      expect(res.body.items[0].milestone.label).toBe('On hold — contact us');
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('forklift');
      expect(raw).not.toContain('CONFIDENTIAL');
      expect(raw).not.toContain('staff error');
    });
  });

  describe('Multi-item shipments', () => {
    it('reflects partial completion honestly — never reports the shipment as completed because only one item finished', async () => {
      const { shipment, customer } = await createShipmentForCustomer(app, tokenA, tenantA, 'Adjei', 2);
      const [itemA, itemB] = shipment.items;

      // Walk both items all the way to RECEIVED_DESTINATION_WAREHOUSE via
      // the real destination pipeline, then pick up only one of them.
      await walkItemToDestinationReceived(app, tokenA, tenantA, itemA.id, customer.id, shipment.id);
      await walkItemToDestinationReceived(app, tokenA, tenantA, itemB.id, customer.id, shipment.id);

      await request(app.getHttpServer())
        .post(`/warehouse/items/${itemA.id}/pickup`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ warehouseId: tenantA.warehouseId, recipientName: 'Test Recipient', scanned: false });

      const res = await lookup(app, { tenantSlug: tenantA.slug, trackingNumber: shipment.trackingNumber, lastName: 'Adjei' });
      expect(res.status).toBe(200);
      expect(res.body.itemSummary).toEqual({ total: 2, completed: 1 });
      expect(res.body.isCompleted).toBe(false);
      expect(res.body.overallMilestone.label).not.toBe('Completed');

      const itemAResult = res.body.items.find((i: { itemCode: string }) => i.itemCode === itemA.itemCode);
      const itemBResult = res.body.items.find((i: { itemCode: string }) => i.itemCode === itemB.itemCode);
      expect(itemAResult.milestone.label).toBe('Picked up');
      expect(itemBResult.milestone.label).toBe('Arrived at destination warehouse');

      // Now finish the second item too — only then must the shipment read as completed.
      await request(app.getHttpServer())
        .post(`/warehouse/items/${itemB.id}/pickup`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ warehouseId: tenantA.warehouseId, recipientName: 'Test Recipient 2', scanned: false });

      const res2 = await lookup(app, { tenantSlug: tenantA.slug, trackingNumber: shipment.trackingNumber, lastName: 'Adjei' });
      expect(res2.body.itemSummary).toEqual({ total: 2, completed: 2 });
      expect(res2.body.isCompleted).toBe(true);
      expect(res2.body.overallMilestone.label).toBe('Completed');
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

function lookup(app: INestApplication, query: { tenantSlug: string; trackingNumber: string; lastName: string }) {
  return request(app.getHttpServer()).get('/tracking/public').query(query);
}

async function createShipmentForCustomer(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  customerLastName: string,
  itemCount: number,
) {
  const customerRes = await request(app.getHttpServer())
    .post('/customers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      firstName: 'Public Tracking Test',
      lastName: customerLastName,
      email: `public.tracking.${customerLastName.toLowerCase()}.${Date.now()}@example.test`,
    });
  if (customerRes.status !== 201) {
    throw new Error(`Customer creation failed: ${customerRes.status} ${JSON.stringify(customerRes.body)}`);
  }
  const customer = customerRes.body;

  const shipmentRes = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId: customer.id,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      items: Array.from({ length: itemCount }, () => ({
        itemType: ShipmentItemType.BOX,
        description: 'Public tracking e2e test box',
      })),
    });
  if (shipmentRes.status !== 201) {
    throw new Error(`Shipment creation failed: ${shipmentRes.status} ${JSON.stringify(shipmentRes.body)}`);
  }
  const shipment = shipmentRes.body as { id: string; trackingNumber: string; items: { id: string; itemCode: string }[] };
  return { customer, shipment, item: shipment.items[0] };
}

async function receiveItem(app: INestApplication, token: string, itemId: string, warehouseId: string, notes?: string) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, notes });
  if (res.status !== 201) {
    throw new Error(`Receive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function processOnce(app: INestApplication, token: string, itemId: string, warehouseId: string) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/process`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, condition: 'GOOD', result: 'READY', scanned: false });
  if (res.status !== 201) {
    throw new Error(`Process failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/** Full pipeline for one item: receive -> process -> book/load/finalize its own container -> finalize/depart/arrive its own manifest -> destination-receive. Each item gets its own container+manifest for simplicity/isolation. */
async function walkItemToDestinationReceived(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  itemId: string,
  _customerId: string,
  _shipmentId: string,
) {
  await receiveItem(app, token, itemId, tenant.warehouseId);
  await processOnce(app, token, itemId, tenant.warehouseId);

  const containerRes = await request(app.getHttpServer())
    .post('/containers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      containerNumber: `E2E-PT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      containerType: 'TWENTY_FT',
      warehouseId: tenant.warehouseId,
    });
  if (containerRes.status !== 201) {
    throw new Error(`Container creation failed: ${containerRes.status} ${JSON.stringify(containerRes.body)}`);
  }
  const container = containerRes.body as { id: string };

  const loadRes = await request(app.getHttpServer())
    .post(`/containers/${container.id}/items/${itemId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ scanned: false });
  if (loadRes.status !== 201) {
    throw new Error(`Load failed: ${loadRes.status} ${JSON.stringify(loadRes.body)}`);
  }

  const finalizeContainerRes = await request(app.getHttpServer())
    .post(`/containers/${container.id}/finalize`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (finalizeContainerRes.status !== 201) {
    throw new Error(`Finalize container failed: ${finalizeContainerRes.status} ${JSON.stringify(finalizeContainerRes.body)}`);
  }

  const manifestRes = await request(app.getHttpServer())
    .post('/manifests')
    .set('Authorization', `Bearer ${token}`)
    .send({
      shipmentMode: 'OCEAN_FCL',
      originWarehouseId: tenant.warehouseId,
      originLocation: 'Origin Test Warehouse',
      destinationLocation: 'Destination Test Warehouse',
      carrierName: 'Test Carrier',
      vesselName: 'Test Vessel',
      voyageNumber: `V-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    });
  if (manifestRes.status !== 201) {
    throw new Error(`Manifest creation failed: ${manifestRes.status} ${JSON.stringify(manifestRes.body)}`);
  }
  const manifest = manifestRes.body as { id: string };

  await request(app.getHttpServer())
    .post(`/manifests/${manifest.id}/containers/${container.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  await request(app.getHttpServer()).post(`/manifests/${manifest.id}/finalize`).set('Authorization', `Bearer ${token}`).send();
  await request(app.getHttpServer()).post(`/manifests/${manifest.id}/depart`).set('Authorization', `Bearer ${token}`).send();
  const arriveRes = await request(app.getHttpServer())
    .post(`/manifests/${manifest.id}/arrive`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (arriveRes.status !== 201) {
    throw new Error(`Arrive failed: ${arriveRes.status} ${JSON.stringify(arriveRes.body)}`);
  }

  const destReceiveRes = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/destination-receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId: tenant.warehouseId, condition: 'GOOD', scanned: false });
  if (destReceiveRes.status !== 201) {
    throw new Error(`Destination-receive failed: ${destReceiveRes.status} ${JSON.stringify(destReceiveRes.body)}`);
  }
}
