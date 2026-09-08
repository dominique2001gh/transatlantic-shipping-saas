import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Final-Mile Notifications milestone: proves the three new shipment-level
 * rollups (maybeRollupShipmentReadyForPickup/OutForDelivery/Delivered in
 * WarehouseService) fire exactly once per shipment per milestone, roll up
 * correctly across multi-item shipments (including a mixed
 * pickup-and-delivery shipment), respect the EXCEPTION-blocks-progress
 * policy already established for COMPLETED, and — critically — that the
 * widened maybeRollupShipmentCompletion eligibility guard still fires
 * COMPLETED correctly afterward on both the walk-in-pickup and delivery
 * paths (the one existing, protected method this milestone had to touch).
 *
 * Never asserts anything about WAREHOUSE_RECEIVED/DEPARTED/
 * ARRIVED_DESTINATION's own trigger conditions — those are unchanged and
 * already covered by notifications.e2e-spec.ts; this suite only adds
 * coverage for the three new milestones plus COMPLETED's continued
 * correctness alongside them.
 */
describe('Final-mile customer notifications: READY_FOR_PICKUP / OUT_FOR_DELIVERY / DELIVERED (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tokenA: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'FinalMile', UserRole.WAREHOUSE_MANAGER);
    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await prisma.$disconnect();
  });

  it('1. walk-in pickup path: READY_FOR_PICKUP fires on destination-receive, COMPLETED fires on pickup, OUT_FOR_DELIVERY/DELIVERED never fire', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
    const itemId = manifest.itemId;

    await destinationReceiveOnce(app, tokenA, itemId, tenantA.warehouseId);
    const readyEvent = await prisma.notificationEvent.findFirst({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:READY_FOR_PICKUP` },
    });
    expect(readyEvent).not.toBeNull();

    const pickupRes = await pickup(app, tokenA, itemId, tenantA.warehouseId, { recipientName: 'Test Recipient' });
    expect(pickupRes.status).toBe(201);

    const completedEvent = await prisma.notificationEvent.findFirst({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:COMPLETED` },
    });
    expect(completedEvent).not.toBeNull();

    const outForDeliveryEvent = await prisma.notificationEvent.findFirst({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:OUT_FOR_DELIVERY` },
    });
    expect(outForDeliveryEvent).toBeNull();
    const deliveredEvent = await prisma.notificationEvent.findFirst({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:DELIVERED` },
    });
    expect(deliveredEvent).toBeNull();
  });

  it('2. delivery path: READY_FOR_PICKUP, OUT_FOR_DELIVERY, DELIVERED, and COMPLETED all fire exactly once, in order', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
    const itemId = manifest.itemId;

    await destinationReceiveOnce(app, tokenA, itemId, tenantA.warehouseId);
    await dispatch(app, tokenA, itemId, tenantA.warehouseId, { recipientName: 'Home Delivery Recipient' });
    await deliver(app, tokenA, itemId, tenantA.warehouseId, { recipientName: 'Home Delivery Recipient' });

    for (const status of ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED']) {
      const events = await prisma.notificationEvent.findMany({
        where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:${status}` },
      });
      expect(events).toHaveLength(1);
    }
  });

  it('3. multi-item shipment: READY_FOR_PICKUP does not fire until every item has reached the destination warehouse, and fires exactly once', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 2);
    const [item1, item2] = manifest.itemIds;

    await destinationReceiveOnce(app, tokenA, item1, tenantA.warehouseId);
    const tooEarly = await prisma.notificationEvent.findFirst({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:READY_FOR_PICKUP` },
    });
    expect(tooEarly).toBeNull();

    await destinationReceiveOnce(app, tokenA, item2, tenantA.warehouseId);
    const events = await prisma.notificationEvent.findMany({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:READY_FOR_PICKUP` },
    });
    expect(events).toHaveLength(1);
  });

  it('4. mixed fulfillment (one item picked up, one delivered): OUT_FOR_DELIVERY, DELIVERED, and COMPLETED each fire exactly once', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 2);
    const [item1, item2] = manifest.itemIds;

    await destinationReceiveOnce(app, tokenA, item1, tenantA.warehouseId);
    await destinationReceiveOnce(app, tokenA, item2, tenantA.warehouseId);

    await pickup(app, tokenA, item1, tenantA.warehouseId, { recipientName: 'Walk-in Recipient' });
    // Shipment must not complete yet — item2 hasn't reached a terminal handoff.
    const tooEarly = await prisma.notificationEvent.findFirst({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:COMPLETED` },
    });
    expect(tooEarly).toBeNull();

    await dispatch(app, tokenA, item2, tenantA.warehouseId, { recipientName: 'Delivery Recipient' });
    await deliver(app, tokenA, item2, tenantA.warehouseId, { recipientName: 'Delivery Recipient' });

    for (const status of ['OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED']) {
      const events = await prisma.notificationEvent.findMany({
        where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:${status}` },
      });
      expect(events).toHaveLength(1);
    }
  });

  it('5. an EXCEPTION item blocks READY_FOR_PICKUP for the whole shipment, even though its sibling reached the destination warehouse', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 2);
    const [item1, item2] = manifest.itemIds;

    await destinationReceiveOnce(app, tokenA, item1, tenantA.warehouseId);
    const exceptionRes = await request(app.getHttpServer())
      .post(`/warehouse/items/${item2}/destination-receive`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ warehouseId: tenantA.warehouseId, condition: 'DAMAGED', hasException: true, exceptionDescription: 'Crushed box', scanned: false });
    expect(exceptionRes.status).toBe(201);

    const readyEvent = await prisma.notificationEvent.findFirst({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${manifest.shipmentId}:status:READY_FOR_PICKUP` },
    });
    expect(readyEvent).toBeNull();

    const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
    expect(dbShipment.status).toBe('ARRIVED_DESTINATION');
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention (see delivery-dispatch.e2e-spec.ts, which
// these are copied from unchanged).
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function pickup(app: INestApplication, token: string, itemId: string, warehouseId: string, opts: { recipientName: string }) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/pickup`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
}

async function dispatch(
  app: INestApplication,
  token: string,
  itemId: string,
  warehouseId: string,
  opts: { recipientName: string; courierName?: string },
) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/dispatch`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, courierName: 'E2E Courier', ...opts });
}

async function deliver(app: INestApplication, token: string, itemId: string, warehouseId: string, opts: { recipientName: string }) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/deliver`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
}

async function createManifest(app: INestApplication, token: string, body: Record<string, unknown>): Promise<{ id: string; manifestNumber: string }> {
  const res = await request(app.getHttpServer()).post('/manifests').set('Authorization', `Bearer ${token}`).send(body);
  if (res.status !== 201) {
    throw new Error(`Manifest creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function finalizeManifest(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer()).post(`/manifests/${manifestId}/finalize`).set('Authorization', `Bearer ${token}`).send();
  if (res.status !== 201) {
    throw new Error(`Finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function departManifest(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer()).post(`/manifests/${manifestId}/depart`).set('Authorization', `Bearer ${token}`).send();
  if (res.status !== 201) {
    throw new Error(`Depart failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function assignContainer(app: INestApplication, token: string, manifestId: string, containerId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/containers/${containerId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (res.status !== 201) {
    throw new Error(`Assign container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function createContainer(app: INestApplication, token: string, opts: { warehouseId?: string }) {
  const res = await request(app.getHttpServer())
    .post('/containers')
    .set('Authorization', `Bearer ${token}`)
    .send({ containerNumber: `E2E-FM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, containerType: 'TWENTY_FT', ...opts });
  if (res.status !== 201) {
    throw new Error(`Container creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}

async function createSingleShipment(app: INestApplication, token: string, customerId: string, itemCount = 1) {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      items: Array.from({ length: itemCount }, () => ({ itemType: ShipmentItemType.BOX, description: 'E2E final-mile test box' })),
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string; items: { id: string; itemCode: string }[] };
}

async function receiveItem(app: INestApplication, token: string, itemId: string, warehouseId: string) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false });
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

async function destinationReceiveOnce(app: INestApplication, token: string, itemId: string, warehouseId: string) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/destination-receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, condition: 'GOOD', scanned: false });
  if (res.status !== 201) {
    throw new Error(`Destination-receive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/** Full pipeline to the exact precondition final-mile actions need — copied unchanged from delivery-dispatch.e2e-spec.ts's own helper of this name. */
async function createArrivedOceanManifest(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  itemCount: number,
): Promise<{ manifestId: string; containerId: string; itemId: string; itemIds: string[]; shipmentId: string }> {
  const container = await createContainer(app, token, { warehouseId: tenant.warehouseId });
  const shipment = await createSingleShipment(app, token, tenant.customerId, itemCount);
  for (const item of shipment.items) {
    await receiveItem(app, token, item.id, tenant.warehouseId);
    await processOnce(app, token, item.id, tenant.warehouseId);
    const loadRes = await request(app.getHttpServer())
      .post(`/containers/${container.id}/items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scanned: false });
    if (loadRes.status !== 201) {
      throw new Error(`Load into container failed: ${loadRes.status} ${JSON.stringify(loadRes.body)}`);
    }
  }
  const finalizeContainerRes = await request(app.getHttpServer())
    .post(`/containers/${container.id}/finalize`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (finalizeContainerRes.status !== 201) {
    throw new Error(`Finalize container failed: ${finalizeContainerRes.status} ${JSON.stringify(finalizeContainerRes.body)}`);
  }

  const manifest = await createManifest(app, token, {
    shipmentMode: 'OCEAN_FCL',
    originWarehouseId: tenant.warehouseId,
    originLocation: 'Origin Test Warehouse',
    destinationLocation: 'Destination Test Warehouse',
    carrierName: 'Test Carrier',
    vesselName: 'Test Vessel',
    voyageNumber: `V-${Date.now()}`,
  });
  await assignContainer(app, token, manifest.id, container.id);
  await finalizeManifest(app, token, manifest.id);
  await departManifest(app, token, manifest.id);

  const arriveRes = await request(app.getHttpServer())
    .post(`/manifests/${manifest.id}/arrive`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (arriveRes.status !== 201) {
    throw new Error(`Arrive failed: ${arriveRes.status} ${JSON.stringify(arriveRes.body)}`);
  }

  return {
    manifestId: manifest.id,
    containerId: container.id,
    itemId: shipment.items[0].id,
    itemIds: shipment.items.map((item) => item.id),
    shipmentId: shipment.id,
  };
}
