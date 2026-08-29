import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for Milestone 3E-C's departure half:
 * FINALIZED -> DEPARTED. Proves both the Ocean/container path and the
 * direct Air path advance items/containers/shipments correctly, that a
 * shipment split across two manifests never departs prematurely, full
 * RBAC/tenant isolation, and append-only tracking history.
 */
describe('Manifest departure (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;
  let tokenB: string;
  let staffToken: string;
  let customerToken: string;
  let accountantToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'DepA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'DepB', UserRole.WAREHOUSE_MANAGER);
    const staffUser = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);
    const customerUser = await createUserInTenant(prisma, tenantA.tenantId, 'Cust', UserRole.CUSTOMER);
    const accountantUser = await createUserInTenant(prisma, tenantA.tenantId, 'Acct', UserRole.ACCOUNTANT);

    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
    tokenB = await login(app, tenantB.user.email, tenantB.user.password);
    staffToken = await login(app, staffUser.email, staffUser.password);
    customerToken = await login(app, customerUser.email, customerUser.password);
    accountantToken = await login(app, accountantUser.email, accountantUser.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  it('departs an Ocean manifest: container -> DEPARTED, item -> DEPARTED_ORIGIN, shipment -> DEPARTED', async () => {
    const manifest = await createFinalizedOceanManifest(app, tokenA, tenantA, 1);

    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.manifestId}/depart`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DEPARTED');
    expect(res.body.departedAt).not.toBeNull();
    expect(res.body.departedByUser.id).toBeDefined();

    const dbContainer = await prisma.container.findUniqueOrThrow({ where: { id: manifest.containerId } });
    expect(dbContainer.status).toBe('DEPARTED');
    expect(dbContainer.departureDate).not.toBeNull();

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
    expect(dbItem.status).toBe('DEPARTED_ORIGIN');

    const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
    expect(dbShipment.status).toBe('DEPARTED');
  });

  it('departs an Air manifest: item -> DEPARTED_ORIGIN, shipment -> DEPARTED, no container touched', async () => {
    const manifest = await createFinalizedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
    const itemId = manifest.itemIds[0];
    const shipmentId = manifest.shipmentIds[0];

    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.manifestId}/depart`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DEPARTED');

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(dbItem.status).toBe('DEPARTED_ORIGIN');

    const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(dbShipment.status).toBe('DEPARTED');
  });

  it('rejects departing a DRAFT manifest', async () => {
    const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR' });
    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.id}/depart`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(res.status).toBe(409);
  });

  it('rejects departing an already-DEPARTED manifest, with no duplicate events', async () => {
    const manifest = await createFinalizedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
    await request(app.getHttpServer())
      .post(`/manifests/${manifest.manifestId}/depart`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();

    const secondRes = await request(app.getHttpServer())
      .post(`/manifests/${manifest.manifestId}/depart`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(secondRes.status).toBe(409);

    const departedEvents = await prisma.trackingEvent.findMany({
      where: { shipmentItemId: manifest.itemIds[0], eventType: 'DEPARTED_ORIGIN' },
    });
    expect(departedEvents).toHaveLength(1);
  });

  it("cross-tenant denial: Tenant B cannot depart Tenant A's manifest", async () => {
    const manifest = await createFinalizedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.manifestId}/depart`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send();
    expect(res.status).toBe(404);

    const dbManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.manifestId } });
    expect(dbManifest.status).toBe('FINALIZED'); // untouched
  });

  describe('RBAC', () => {
    it('rejects WAREHOUSE_STAFF, ACCOUNTANT, and CUSTOMER from departing', async () => {
      const m1 = await createFinalizedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
      const staffRes = await request(app.getHttpServer())
        .post(`/manifests/${m1.manifestId}/depart`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send();
      expect(staffRes.status).toBe(403);

      const acctRes = await request(app.getHttpServer())
        .post(`/manifests/${m1.manifestId}/depart`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send();
      expect(acctRes.status).toBe(403);

      const custRes = await request(app.getHttpServer())
        .post(`/manifests/${m1.manifestId}/depart`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send();
      expect(custRes.status).toBe(403);
    });

    it('allows WAREHOUSE_MANAGER to depart', async () => {
      const manifest = await createFinalizedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.manifestId}/depart`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(201);
    });
  });

  it("does not prematurely depart a shipment split across two manifests, and correctly completes once the second departs", async () => {
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 2);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    await receiveItem(app, tokenA, shipment.items[1].id, tenantA.warehouseId);
    await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    await processOnce(app, tokenA, shipment.items[1].id, tenantA.warehouseId);

    const manifest1 = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'A',
      destinationLocation: 'B',
      carrierName: 'Delta',
      flightNumber: 'DL-1',
    });
    await assignItem(app, tokenA, manifest1.id, shipment.items[0].id);
    await finalizeManifest(app, tokenA, manifest1.id);
    await request(app.getHttpServer())
      .post(`/manifests/${manifest1.id}/depart`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();

    // Only item 0 departed — item 1 is still sitting PROCESSED, unassigned,
    // so the shipment correctly stays at CONSOLIDATED (not everything is
    // even loaded yet, let alone departed) rather than jumping to DEPARTED.
    let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(dbShipment.status).toBe('CONSOLIDATED');
    expect(dbShipment.status).not.toBe('DEPARTED');
    const dbItem0 = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: shipment.items[0].id } });
    const dbItem1 = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: shipment.items[1].id } });
    expect(dbItem0.status).toBe('DEPARTED_ORIGIN');
    expect(dbItem1.status).toBe('PROCESSED');

    // Now assign+finalize+depart item 1 on a second manifest — a later flight.
    const manifest2 = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'A',
      destinationLocation: 'B',
      carrierName: 'Delta',
      flightNumber: 'DL-2',
    });
    await assignItem(app, tokenA, manifest2.id, shipment.items[1].id);
    await finalizeManifest(app, tokenA, manifest2.id);
    await request(app.getHttpServer())
      .post(`/manifests/${manifest2.id}/depart`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();

    dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(dbShipment.status).toBe('DEPARTED'); // now both items departed
  });

  it('appends DEPARTED_ORIGIN without erasing prior history (ASSIGNED_TO_MANIFEST, LOADED still present)', async () => {
    const manifest = await createFinalizedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
    await request(app.getHttpServer())
      .post(`/manifests/${manifest.manifestId}/depart`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();

    const events = await prisma.trackingEvent.findMany({
      where: { shipmentItemId: manifest.itemIds[0] },
      orderBy: { occurredAt: 'asc' },
    });
    const types = events.map((e) => e.eventType);
    expect(types).toContain('ITEM_REGISTERED');
    expect(types).toContain('RECEIVED_AT_WAREHOUSE');
    expect(types).toContain('PROCESSED');
    expect(types).toContain('ASSIGNED_TO_MANIFEST');
    expect(types).toContain('LOADED');
    expect(types).toContain('DEPARTED_ORIGIN');
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

async function createManifest(
  app: INestApplication,
  token: string,
  body: Record<string, unknown>,
): Promise<{ id: string; manifestNumber: string }> {
  const res = await request(app.getHttpServer()).post('/manifests').set('Authorization', `Bearer ${token}`).send(body);
  if (res.status !== 201) {
    throw new Error(`Manifest creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function finalizeManifest(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/finalize`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (res.status !== 201) {
    throw new Error(`Finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function assignContainer(app: INestApplication, token: string, manifestId: string, containerId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/containers/${containerId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (res.status !== 201) {
    throw new Error(`Assign container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function assignItem(app: INestApplication, token: string, manifestId: string, itemId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/items/${itemId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ scanned: false });
  if (res.status !== 201) {
    throw new Error(`Assign item failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function createSingleShipment(
  app: INestApplication,
  token: string,
  customerId: string,
  itemCount = 1,
): Promise<{ id: string; trackingNumber: string; items: { id: string; itemCode: string }[] }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      items: Array.from({ length: itemCount }, () => ({
        itemType: ShipmentItemType.BOX,
        description: 'E2E manifest departure test box',
      })),
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function receiveItem(app: INestApplication, token: string, itemId: string, warehouseId: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false });
  if (res.status !== 201) {
    throw new Error(`Receive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function processOnce(app: INestApplication, token: string, itemId: string, warehouseId: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/process`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, condition: 'GOOD', result: 'READY', scanned: false });
  if (res.status !== 201) {
    throw new Error(`Process failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function createReadyItem(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  customerId: string,
): Promise<{ itemId: string; itemCode: string; shipmentId: string }> {
  const shipment = await createSingleShipment(app, token, customerId, 1);
  const item = shipment.items[0];
  await receiveItem(app, token, item.id, tenant.warehouseId);
  await processOnce(app, token, item.id, tenant.warehouseId);
  return { itemId: item.id, itemCode: item.itemCode, shipmentId: shipment.id };
}

async function createContainer(
  app: INestApplication,
  token: string,
  opts: { warehouseId?: string },
): Promise<{ id: string; status: string }> {
  const res = await request(app.getHttpServer())
    .post('/containers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      containerNumber: `E2E-CN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      containerType: 'TWENTY_FT',
      ...opts,
    });
  if (res.status !== 201) {
    throw new Error(`Container creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** Books+loads+finalizes a container with one fresh READY item, assigns it to a new finalized Ocean manifest. */
async function createFinalizedOceanManifest(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  itemCount: number,
): Promise<{ manifestId: string; containerId: string; itemId: string; shipmentId: string }> {
  const container = await createContainer(app, token, { warehouseId: tenant.warehouseId });
  let shipmentId = '';
  let itemId = '';
  for (let i = 0; i < itemCount; i++) {
    const item = await createReadyItem(app, token, tenant, tenant.customerId);
    shipmentId = item.shipmentId;
    itemId = item.itemId;
    const loadRes = await request(app.getHttpServer())
      .post(`/containers/${container.id}/items/${item.itemId}`)
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
    originLocation: 'Houston, TX',
    destinationLocation: 'Tema, Ghana',
    carrierName: 'Maersk',
    vesselName: 'Maersk Atlantic',
    voyageNumber: 'V-1',
  });
  await assignContainer(app, token, manifest.id, container.id);
  await finalizeManifest(app, token, manifest.id);

  return { manifestId: manifest.id, containerId: container.id, itemId, shipmentId };
}

/** Creates+receives+processes+assigns+finalizes one item per customerId on a new finalized Air manifest. */
async function createFinalizedAirManifest(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  customerIds: string[],
): Promise<{ manifestId: string; itemIds: string[]; shipmentIds: string[] }> {
  const manifest = await createManifest(app, token, {
    shipmentMode: 'AIR',
    originWarehouseId: tenant.warehouseId,
    originLocation: 'Houston, TX',
    destinationLocation: 'Accra, Ghana',
    carrierName: 'Delta Cargo',
    flightNumber: 'DL-100',
  });

  const itemIds: string[] = [];
  const shipmentIds: string[] = [];
  for (const customerId of customerIds) {
    const item = await createReadyItem(app, token, tenant, customerId);
    await assignItem(app, token, manifest.id, item.itemId);
    itemIds.push(item.itemId);
    shipmentIds.push(item.shipmentId);
  }
  await finalizeManifest(app, token, manifest.id);

  return { manifestId: manifest.id, itemIds, shipmentIds };
}
