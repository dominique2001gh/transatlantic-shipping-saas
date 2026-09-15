import { INestApplication } from '@nestjs/common';
import { NotificationChannel, PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Customer Email Redesign — DB-backed integration coverage for exactly the
 * pieces the pure-function tests (shipment-customer-emails.e2e-spec.ts)
 * can't exercise on their own: tenant-branding/customer-name resolution
 * from real rows, the destination-warehouse pickup-location lookup, the
 * ETA resolution from a real Manifest, and — the one genuine behavioral
 * change in this stage — the DELIVERED/COMPLETED email dedup decision.
 *
 * Deliberately checks the `Notification` row itself (channel=EMAIL,
 * title/body — which hold the rich subject/text for a templated
 * occurrence), never the real provider — ConsoleEmailProvider is what
 * runs in this test environment (see notification-providers.module.ts),
 * so nothing here makes a real network call.
 */
describe('Customer notification emails: branding, tracking link, ETA/pickup detail, DELIVERED/COMPLETED dedup (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tokenA: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'EmailRedesign', UserRole.MANAGER);
    tokenA = await login(app, tenantA.user.email, tenantA.user.password);

    // Real branding, distinct from Trans Atlantic's, to prove tenant-aware
    // rendering rather than anything hardcoded.
    await prisma.tenant.update({
      where: { id: tenantA.tenantId },
      data: {
        name: 'E2E Branded Freight Co',
        legalName: 'E2E Branded Freight Co, LLC',
        website: 'https://e2e-branded-freight.example',
        logoUrl: 'https://e2e-branded-freight.example/logo.png',
        primaryColor: '#0f766e',
        phone: '+1 555-0199',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await prisma.$disconnect();
  });

  it('1. Shipment Received: branded, tenant-aware EMAIL with tracking link, no internal enum in title/body', async () => {
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, { destinationWarehouseId: tenantA.warehouseId });
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    const email = await findEmailNotification(prisma, tenantA.tenantId, shipment.id, 'WAREHOUSE_RECEIVED');
    expect(email).not.toBeNull();
    expect(email!.title).toBe(`We've received your shipment — ${shipment.trackingNumber}`);
    expect(email!.body).toContain(shipment.trackingNumber);
    expect(email!.body).toContain('https://e2e-branded-freight.example/track?tn=');
    expect(email!.body).not.toMatch(/\bWAREHOUSE_RECEIVED\b/);
    expect(email!.title).not.toMatch(/\bWAREHOUSE_RECEIVED\b/);
  });

  it('2. Ready for Pickup: includes the actual destination-warehouse address', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
    await destinationReceiveOnce(app, tokenA, manifest.itemId, tenantA.warehouseId);

    const email = await findEmailNotification(prisma, tenantA.tenantId, manifest.shipmentId, 'READY_FOR_PICKUP');
    expect(email).not.toBeNull();
    const trackingNumber = (await shipmentTrackingNumber(prisma, manifest.shipmentId))!;
    expect(email!.title).toBe(`Your shipment is ready for pickup — ${trackingNumber}`);
    expect(email!.body).toContain('EmailRedesign Test Warehouse');
    expect(email!.body).toContain('1 Test Street');
    expect(email!.body).not.toMatch(/hours/i);
    expect(email!.body).not.toMatch(/instructions/i);
  });

  it('3. Departed: includes an ETA when the manifest has one, humanized mode + destination always', async () => {
    const manifestRes = await request(app.getHttpServer())
      .post('/manifests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        shipmentMode: 'OCEAN_FCL',
        originWarehouseId: tenantA.warehouseId,
        originLocation: 'Origin Test Warehouse',
        destinationLocation: 'Destination Test Warehouse',
        carrierName: 'Test Carrier',
        vesselName: 'Test Vessel',
        voyageNumber: `V-ETA-${Date.now()}`,
      });
    expect(manifestRes.status).toBe(201);
    const manifestId = manifestRes.body.id as string;

    const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, {});
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    await loadIntoContainer(app, tokenA, container.id, shipment.items[0].id);
    await finalizeContainer(app, tokenA, container.id);
    await assignContainer(app, tokenA, manifestId, container.id);
    await finalizeManifest(app, tokenA, manifestId);

    const eta = new Date('2026-10-05T00:00:00.000Z');
    await prisma.manifest.update({ where: { id: manifestId }, data: { estimatedArrivalAt: eta } });

    await departManifest(app, tokenA, manifestId);

    const email = await findEmailNotification(prisma, tenantA.tenantId, shipment.id, 'DEPARTED');
    expect(email).not.toBeNull();
    expect(email!.body).toMatch(/Estimated Arrival/);
    expect(email!.body).toMatch(/Oct 5, 2026/);
    expect(email!.body).toMatch(/Ocean Freight \(LCL\)/); // the shipment's own mode (createSingleShipment's default) — independent of the manifest's own OCEAN_FCL mode
  });

  it('4. Delivery path: DELIVERED gets its own branded email; the immediately-following COMPLETED email is suppressed (EMAIL only — IN_APP still fires)', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
    await destinationReceiveOnce(app, tokenA, manifest.itemId, tenantA.warehouseId);
    await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Home Delivery Recipient' });
    await deliver(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Home Delivery Recipient' });

    const deliveredEmail = await findEmailNotification(prisma, tenantA.tenantId, manifest.shipmentId, 'DELIVERED');
    expect(deliveredEmail).not.toBeNull();
    const trackingNumber = (await shipmentTrackingNumber(prisma, manifest.shipmentId))!;
    expect(deliveredEmail!.title).toBe(`Your shipment has been delivered — ${trackingNumber}`);

    const completedEmail = await findEmailNotification(prisma, tenantA.tenantId, manifest.shipmentId, 'COMPLETED');
    expect(completedEmail).toBeNull(); // suppressed — customer already got the DELIVERED email

    const completedInApp = await findNotification(prisma, tenantA.tenantId, manifest.shipmentId, 'COMPLETED', NotificationChannel.IN_APP);
    expect(completedInApp).not.toBeNull(); // IN_APP is unaffected by the EMAIL-only suppression
  });

  it('5. Walk-in pickup path: no DELIVERED ever fires, so COMPLETED renders as the "Picked Up" email, not suppressed', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
    await destinationReceiveOnce(app, tokenA, manifest.itemId, tenantA.warehouseId);
    const pickupRes = await pickup(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Walk-in Recipient' });
    expect(pickupRes.status).toBe(201);

    const deliveredEmail = await findEmailNotification(prisma, tenantA.tenantId, manifest.shipmentId, 'DELIVERED');
    expect(deliveredEmail).toBeNull(); // driver-delivery never happened

    const completedEmail = await findEmailNotification(prisma, tenantA.tenantId, manifest.shipmentId, 'COMPLETED');
    expect(completedEmail).not.toBeNull();
    const trackingNumber = (await shipmentTrackingNumber(prisma, manifest.shipmentId))!;
    expect(completedEmail!.title).toBe(`Your shipment has been picked up — ${trackingNumber}`);
    expect(completedEmail!.body).not.toMatch(/\bCOMPLETED\b/);
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention (copied from final-mile-notifications.e2e-spec.ts
// where unchanged).
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function findNotification(
  prisma: PrismaClient,
  tenantId: string,
  shipmentId: string,
  status: string,
  channel: NotificationChannel,
) {
  return prisma.notification.findFirst({
    where: { tenantId, channel, event: { dedupeKey: `shipment:${shipmentId}:status:${status}` } },
  });
}

async function findEmailNotification(prisma: PrismaClient, tenantId: string, shipmentId: string, status: string) {
  return findNotification(prisma, tenantId, shipmentId, status, NotificationChannel.EMAIL);
}

async function shipmentTrackingNumber(prisma: PrismaClient, shipmentId: string): Promise<string | null> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { trackingNumber: true } });
  return shipment?.trackingNumber ?? null;
}

async function pickup(app: INestApplication, token: string, itemId: string, warehouseId: string, opts: { recipientName: string }) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/pickup`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
}

async function dispatch(app: INestApplication, token: string, itemId: string, warehouseId: string, opts: { recipientName: string }) {
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

async function createManifest(app: INestApplication, token: string, body: Record<string, unknown>): Promise<{ id: string }> {
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
    .send({ containerNumber: `E2E-EMAIL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, containerType: 'TWENTY_FT', ...opts });
  if (res.status !== 201) {
    throw new Error(`Container creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}

async function loadIntoContainer(app: INestApplication, token: string, containerId: string, itemId: string) {
  const res = await request(app.getHttpServer())
    .post(`/containers/${containerId}/items/${itemId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ scanned: false });
  if (res.status !== 201) {
    throw new Error(`Load into container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function finalizeContainer(app: INestApplication, token: string, containerId: string) {
  const res = await request(app.getHttpServer()).post(`/containers/${containerId}/finalize`).set('Authorization', `Bearer ${token}`).send({});
  if (res.status !== 201) {
    throw new Error(`Finalize container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function createSingleShipment(
  app: INestApplication,
  token: string,
  customerId: string,
  extra: { destinationWarehouseId?: string },
  itemCount = 1,
) {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'Ghana',
      ...extra,
      items: Array.from({ length: itemCount }, () => ({ itemType: ShipmentItemType.BOX, description: 'E2E email-redesign test box' })),
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string; trackingNumber: string; items: { id: string; itemCode: string }[] };
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

/** Full pipeline to the exact precondition final-mile actions need — copied unchanged from final-mile-notifications.e2e-spec.ts's own helper of this name. */
async function createArrivedOceanManifest(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  itemCount: number,
): Promise<{ manifestId: string; containerId: string; itemId: string; itemIds: string[]; shipmentId: string }> {
  const container = await createContainer(app, token, { warehouseId: tenant.warehouseId });
  const shipment = await createSingleShipment(app, token, tenant.customerId, { destinationWarehouseId: tenant.warehouseId }, itemCount);
  for (const item of shipment.items) {
    await receiveItem(app, token, item.id, tenant.warehouseId);
    await processOnce(app, token, item.id, tenant.warehouseId);
    await loadIntoContainer(app, token, container.id, item.id);
  }
  await finalizeContainer(app, token, container.id);

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

  const arriveRes = await request(app.getHttpServer()).post(`/manifests/${manifest.id}/arrive`).set('Authorization', `Bearer ${token}`).send();
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
