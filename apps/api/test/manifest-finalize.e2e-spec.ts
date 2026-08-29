import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for Milestone 3E-C (manifest finalization
 * ONLY). Proves DRAFT -> FINALIZED works, validation/eligibility
 * re-checks, locking, the snapshot, audit fields, and — just as
 * important — that nothing here ever creates a departure/in-transit
 * status or event. Departure itself is 3E-D and is not tested here
 * because the endpoint doesn't exist yet.
 */
describe('Manifest finalization (e2e)', () => {
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
    tenantA = await createTestTenant(prisma, 'FinA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'FinB', UserRole.WAREHOUSE_MANAGER);
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

  it('1. finalizes an Ocean manifest with an eligible sealed LOADED container', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'OCEAN_FCL',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'Houston, TX',
      destinationLocation: 'Tema, Ghana',
      carrierName: 'Maersk',
      vesselName: 'Maersk Atlantic',
      voyageNumber: 'V-2026-014',
    });
    const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
    await assignContainer(app, tokenA, manifest.id, container.id);

    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('FINALIZED');
    expect(res.body.finalizedAt).not.toBeNull();
    expect(res.body.finalizedByUser.id).toBeDefined();

    const dbContainer = await prisma.container.findUniqueOrThrow({ where: { id: container.id } });
    expect(dbContainer.status).toBe('LOADED'); // still LOADED, not DEPARTED
  });

  it('2. finalizes an Air manifest with eligible direct items, advancing them to LOADED', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'Houston, TX',
      destinationLocation: 'Accra, Ghana',
      carrierName: 'Delta Cargo',
      flightNumber: 'DL-4471',
    });
    const item = await createReadyItem(app, tokenA, tenantA);
    await assignItem(app, tokenA, manifest.id, item.itemId);

    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('FINALIZED');

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.itemId } });
    expect(dbItem.status).toBe('LOADED');
  });

  it('3. rejects finalizing an empty manifest (Ocean and Air)', async () => {
    const oceanManifest = await createManifest(app, tokenA, {
      shipmentMode: 'OCEAN_FCL',
      carrierName: 'Maersk',
      vesselName: 'X',
      voyageNumber: 'Y',
      originLocation: 'A',
      destinationLocation: 'B',
    });
    const oceanRes = await request(app.getHttpServer())
      .post(`/manifests/${oceanManifest.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(oceanRes.status).toBe(400);

    const airManifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      carrierName: 'Delta',
      flightNumber: 'DL-1',
      originLocation: 'A',
      destinationLocation: 'B',
    });
    const airRes = await request(app.getHttpServer())
      .post(`/manifests/${airManifest.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(airRes.status).toBe(400);
  });

  it('4. rejects finalizing when required transport information is missing', async () => {
    const manifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
    const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
    await assignContainer(app, tokenA, manifest.id, container.id);

    // No carrierName/vesselName/voyageNumber/destinationLocation set on this manifest.
    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(res.status).toBe(400);
  });

  it('5. rejects finalizing if an assigned item has regressed to EXCEPTION since assignment', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'A',
      destinationLocation: 'B',
      carrierName: 'Delta',
      flightNumber: 'DL-1',
    });
    const item = await createReadyItem(app, tokenA, tenantA);
    await assignItem(app, tokenA, manifest.id, item.itemId);

    // No live API path lets an ASSIGNED_TO_MANIFEST item regress — this
    // directly manipulates the DB to prove finalize()'s defensive
    // re-check catches an eligibility regression regardless.
    await prisma.shipmentItem.update({ where: { id: item.itemId }, data: { status: 'EXCEPTION' } });

    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(res.status).toBe(409);

    const dbManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.id } });
    expect(dbManifest.status).toBe('DRAFT'); // untouched
  });

  it("6. rejects finalizing another tenant's manifest (404, never confirms it exists)", async () => {
    const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR' });
    const res = await request(app.getHttpServer())
      .post(`/manifests/${manifest.id}/finalize`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send();
    expect(res.status).toBe(404);
  });

  describe('7. RBAC', () => {
    it('rejects WAREHOUSE_STAFF from finalizing', async () => {
      const manifest = await createManifest(app, tokenA, {
        shipmentMode: 'AIR',
        originWarehouseId: tenantA.warehouseId,
        originLocation: 'A',
        destinationLocation: 'B',
        carrierName: 'Delta',
        flightNumber: 'DL-1',
      });
      const item = await createReadyItem(app, tokenA, tenantA);
      await assignItem(app, tokenA, manifest.id, item.itemId);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/finalize`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send();
      expect(res.status).toBe(403);
    });

    it('rejects ACCOUNTANT (read-only) from finalizing', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR' });
      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/finalize`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send();
      expect(res.status).toBe(403);
    });

    it('rejects CUSTOMER entirely', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR' });
      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/finalize`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send();
      expect(res.status).toBe(403);
    });

    it('allows WAREHOUSE_MANAGER to finalize', async () => {
      const manifest = await createManifest(app, tokenA, {
        shipmentMode: 'AIR',
        originWarehouseId: tenantA.warehouseId,
        originLocation: 'A',
        destinationLocation: 'B',
        carrierName: 'Delta',
        flightNumber: 'DL-1',
      });
      const item = await createReadyItem(app, tokenA, tenantA);
      await assignItem(app, tokenA, manifest.id, item.itemId);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/finalize`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(201);
    });
  });

  describe('8-9. locking after FINALIZED', () => {
    it('rejects assigning a new container/item after finalization', async () => {
      const manifest = await createManifest(app, tokenA, {
        shipmentMode: 'OCEAN_FCL',
        originWarehouseId: tenantA.warehouseId,
        originLocation: 'A',
        destinationLocation: 'B',
        carrierName: 'Maersk',
        vesselName: 'X',
        voyageNumber: 'Y',
      });
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
      await assignContainer(app, tokenA, manifest.id, container.id);
      await finalizeManifest(app, tokenA, manifest.id);

      const secondContainer = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/containers/${secondContainer.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(409);
    });

    it('rejects unassigning an already-assigned container/item after finalization', async () => {
      const manifest = await createManifest(app, tokenA, {
        shipmentMode: 'AIR',
        originWarehouseId: tenantA.warehouseId,
        originLocation: 'A',
        destinationLocation: 'B',
        carrierName: 'Delta',
        flightNumber: 'DL-1',
      });
      const item = await createReadyItem(app, tokenA, tenantA);
      await assignItem(app, tokenA, manifest.id, item.itemId);
      await finalizeManifest(app, tokenA, manifest.id);

      const res = await request(app.getHttpServer())
        .delete(`/manifests/${manifest.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(409);
    });
  });

  it('10. finalizing twice is rejected without duplicate side effects', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'A',
      destinationLocation: 'B',
      carrierName: 'Delta',
      flightNumber: 'DL-1',
    });
    const item = await createReadyItem(app, tokenA, tenantA);
    await assignItem(app, tokenA, manifest.id, item.itemId);
    await finalizeManifest(app, tokenA, manifest.id);

    const firstManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.id } });

    const secondRes = await request(app.getHttpServer())
      .post(`/manifests/${manifest.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send();
    expect(secondRes.status).toBe(409);

    const afterSecondAttempt = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.id } });
    expect(afterSecondAttempt.finalizedAt?.getTime()).toBe(firstManifest.finalizedAt?.getTime());

    const loadedEvents = await prisma.trackingEvent.findMany({
      where: { shipmentItemId: item.itemId, eventType: 'LOADED' },
    });
    expect(loadedEvents).toHaveLength(1); // not duplicated
  });

  it('11. snapshot accurately represents the finalized contents', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'OCEAN_FCL',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'Houston, TX',
      destinationLocation: 'Tema, Ghana',
      carrierName: 'Maersk',
      vesselName: 'Maersk Atlantic',
      voyageNumber: 'V-2026-014',
    });
    const container = await createAndFinalizeContainer(app, tokenA, tenantA, 2);
    await assignContainer(app, tokenA, manifest.id, container.id);
    await finalizeManifest(app, tokenA, manifest.id);

    const dbManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.id } });
    const snapshot = dbManifest.snapshotJson as Record<string, unknown>;
    expect(snapshot.manifestNumber).toBe(manifest.manifestNumber);
    expect(snapshot.carrierName).toBe('Maersk');
    expect(snapshot.vesselName).toBe('Maersk Atlantic');
    expect(snapshot.voyageNumber).toBe('V-2026-014');
    expect(snapshot.destinationLocation).toBe('Tema, Ghana');
    const containers = snapshot.containers as unknown[];
    expect(containers).toHaveLength(1);
    const summary = snapshot.summary as { containerCount: number; itemCount: number };
    expect(summary.containerCount).toBe(1);
    expect(summary.itemCount).toBe(2);
  });

  it('12. records finalizedAt and finalizedByUserId', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'A',
      destinationLocation: 'B',
      carrierName: 'Delta',
      flightNumber: 'DL-1',
    });
    const item = await createReadyItem(app, tokenA, tenantA);
    await assignItem(app, tokenA, manifest.id, item.itemId);
    await finalizeManifest(app, tokenA, manifest.id);

    const dbManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.id } });
    expect(dbManifest.finalizedAt).not.toBeNull();
    expect(dbManifest.finalizedByUserId).toBe(tenantA.user.id);
  });

  it('13. never creates a departure status or event anywhere', async () => {
    const oceanManifest = await createManifest(app, tokenA, {
      shipmentMode: 'OCEAN_FCL',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'A',
      destinationLocation: 'B',
      carrierName: 'Maersk',
      vesselName: 'X',
      voyageNumber: 'Y',
    });
    const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
    await assignContainer(app, tokenA, oceanManifest.id, container.id);
    const oceanResult = await finalizeManifest(app, tokenA, oceanManifest.id);

    const airManifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      originLocation: 'A',
      destinationLocation: 'B',
      carrierName: 'Delta',
      flightNumber: 'DL-1',
    });
    const item = await createReadyItem(app, tokenA, tenantA);
    await assignItem(app, tokenA, airManifest.id, item.itemId);
    await finalizeManifest(app, tokenA, airManifest.id);

    expect(oceanResult.status).toBe('FINALIZED');
    expect(airManifest).toBeDefined();

    const dbOceanManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: oceanManifest.id } });
    const dbAirManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: airManifest.id } });
    expect(dbOceanManifest.status).toBe('FINALIZED');
    expect(dbAirManifest.status).toBe('FINALIZED');
    expect(dbOceanManifest.departedAt).toBeNull();
    expect(dbAirManifest.departedAt).toBeNull();

    const dbContainer = await prisma.container.findUniqueOrThrow({ where: { id: container.id } });
    expect(dbContainer.status).toBe('LOADED');

    const dbAirItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.itemId } });
    expect(dbAirItem.status).toBe('LOADED');
    expect(dbAirItem.status).not.toBe('DEPARTED_ORIGIN');

    const departureEvents = await prisma.trackingEvent.findMany({
      where: {
        tenantId: tenantA.tenantId,
        OR: [{ eventType: 'DEPARTED_ORIGIN' }, { eventType: 'IN_TRANSIT' }, { status: 'DEPARTED' }],
      },
    });
    expect(departureEvents).toHaveLength(0);
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
        description: 'E2E manifest finalize test box',
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
): Promise<{ itemId: string; itemCode: string; shipmentId: string }> {
  const shipment = await createSingleShipment(app, token, tenant.customerId, 1);
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

async function createAndFinalizeContainer(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  itemCount: number,
): Promise<{ id: string; shipmentId: string }> {
  const container = await createContainer(app, token, { warehouseId: tenant.warehouseId });
  let shipmentId = '';
  for (let i = 0; i < itemCount; i++) {
    const item = await createReadyItem(app, token, tenant);
    shipmentId = item.shipmentId;
    const loadRes = await request(app.getHttpServer())
      .post(`/containers/${container.id}/items/${item.itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scanned: false });
    if (loadRes.status !== 201) {
      throw new Error(`Load into container failed: ${loadRes.status} ${JSON.stringify(loadRes.body)}`);
    }
  }
  const finalizeRes = await request(app.getHttpServer())
    .post(`/containers/${container.id}/finalize`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (finalizeRes.status !== 201) {
    throw new Error(`Finalize container failed: ${finalizeRes.status} ${JSON.stringify(finalizeRes.body)}`);
  }
  return { id: container.id, shipmentId };
}
