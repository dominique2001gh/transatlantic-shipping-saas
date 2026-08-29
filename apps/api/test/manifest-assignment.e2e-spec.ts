import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for Milestone 3E-B (manifest assignment &
 * eligibility rules). Covers assigning/unassigning sealed containers to
 * Ocean/RoRo manifests and direct items to Air manifests, every
 * rejection path, RBAC, and full tenant isolation. Deliberately does NOT
 * test finalize/depart/status-roll-forward — those endpoints don't exist
 * yet (later controlled steps).
 */
describe('Manifest assignment (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;
  let tokenB: string;
  let customerToken: string;
  let accountantToken: string;
  let customerServiceToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'MfA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'MfB', UserRole.WAREHOUSE_MANAGER);
    const customerUser = await createUserInTenant(prisma, tenantA.tenantId, 'Cust', UserRole.CUSTOMER);
    const accountantUser = await createUserInTenant(prisma, tenantA.tenantId, 'Acct', UserRole.ACCOUNTANT);
    const customerServiceUser = await createUserInTenant(prisma, tenantA.tenantId, 'CS', UserRole.CUSTOMER_SERVICE);

    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
    tokenB = await login(app, tenantB.user.email, tenantB.user.password);
    customerToken = await login(app, customerUser.email, customerUser.password);
    accountantToken = await login(app, accountantUser.email, accountantUser.password);
    customerServiceToken = await login(app, customerServiceUser.email, customerServiceUser.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  // -- Ocean / container assignment ---------------------------------------

  describe('Ocean: container assignment', () => {
    it('1. assigns an eligible sealed LOADED container to an Ocean manifest', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/containers/${container.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.summary.containerCount).toBe(1);
      expect(res.body.summary.itemCount).toBe(1);
      expect(res.body.containers[0].id).toBe(container.id);

      const dbContainer = await prisma.container.findUniqueOrThrow({ where: { id: container.id } });
      expect(dbContainer.manifestId).toBe(manifest.id);

      const events = await prisma.trackingEvent.findMany({
        where: { shipmentId: container.shipmentId, eventType: 'ASSIGNED_TO_MANIFEST' },
      });
      expect(events).toHaveLength(1);
      expect((events[0].metadata as Record<string, unknown>).manifestNumber).toBe(manifest.manifestNumber);
    });

    it('2. supports multiple containers assigned to the same Ocean manifest', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_LCL', originWarehouseId: tenantA.warehouseId });
      const containerX = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
      const containerY = await createAndFinalizeContainer(app, tokenA, tenantA, 2);

      await assignContainer(app, tokenA, manifest.id, containerX.id);
      const res = await assignContainer(app, tokenA, manifest.id, containerY.id);

      expect(res.summary.containerCount).toBe(2);
      expect(res.summary.itemCount).toBe(3);
    });

    it('3. rejects a container that is BOOKED/LOADING (not yet sealed)', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const bookedContainer = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/containers/${bookedContainer.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(409);
    });

    it("4. rejects a container belonging to another tenant (404, never confirms it exists)", async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL' });
      const containerB = await createAndFinalizeContainer(app, tokenB, tenantB, 1);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/containers/${containerB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it("5. rejects a container whose warehouse doesn't match the manifest's origin warehouse", async () => {
      const otherWarehouse = await prisma.warehouse.create({
        data: {
          tenantId: tenantA.tenantId,
          name: 'Other Warehouse',
          code: `E2E-OTHER-${Date.now()}`,
          addressLine1: '2 Test St',
          city: 'Testville',
          country: 'US',
        },
      });
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: otherWarehouse.id });
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1); // at tenantA.warehouseId

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/containers/${container.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(409);
    });

    it('6. rejects a container whose entire cargo destination is obviously incompatible with the manifest route', async () => {
      const route = await prisma.route.create({
        data: {
          tenantId: tenantA.tenantId,
          name: 'US -> Nigeria',
          originCountry: 'US',
          destinationCountry: 'Nigeria',
          shipmentMode: 'OCEAN_FCL',
        },
      });
      const manifest = await createManifest(app, tokenA, {
        shipmentMode: 'OCEAN_FCL',
        originWarehouseId: tenantA.warehouseId,
        routeId: route.id,
      });
      // createAndFinalizeContainer's shipments all destinationCountry 'GH', route wants 'Nigeria' — zero overlap.
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/containers/${container.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(409);
    });

    it('7. rejects assigning a container already on another active manifest (and re-assigning to the same one)', async () => {
      const manifest1 = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const manifest2 = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);

      await assignContainer(app, tokenA, manifest1.id, container.id);

      const dupOtherManifest = await request(app.getHttpServer())
        .post(`/manifests/${manifest2.id}/containers/${container.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(dupOtherManifest.status).toBe(409);

      const dupSameManifest = await request(app.getHttpServer())
        .post(`/manifests/${manifest1.id}/containers/${container.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(dupSameManifest.status).toBe(409);
    });

    it('8. unassigns a container before finalization, reverting manifestId and appending REMOVED_FROM_MANIFEST', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
      await assignContainer(app, tokenA, manifest.id, container.id);

      const res = await request(app.getHttpServer())
        .delete(`/manifests/${manifest.id}/containers/${container.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'Reassigning to a later voyage' });
      expect(res.status).toBe(200);
      expect(res.body.summary.containerCount).toBe(0);

      const dbContainer = await prisma.container.findUniqueOrThrow({ where: { id: container.id } });
      expect(dbContainer.manifestId).toBeNull();
      expect(dbContainer.status).toBe('LOADED'); // container itself is untouched, still sealed

      const removedEvent = await prisma.trackingEvent.findFirst({
        where: { shipmentId: container.shipmentId, eventType: 'REMOVED_FROM_MANIFEST' },
      });
      expect(removedEvent).not.toBeNull();
      expect(removedEvent?.notes).toBe('Reassigning to a later voyage');

      // Original assignment event is untouched — append-only, not rewritten.
      const assignedEvent = await prisma.trackingEvent.findFirst({
        where: { shipmentId: container.shipmentId, eventType: 'ASSIGNED_TO_MANIFEST' },
      });
      expect(assignedEvent).not.toBeNull();

      // Now assignable to a different manifest.
      const manifest2 = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const reassignRes = await assignContainer(app, tokenA, manifest2.id, container.id);
      expect(reassignRes.summary.containerCount).toBe(1);
    });
  });

  // -- Air / direct item assignment ----------------------------------------

  describe('Air: direct item assignment', () => {
    it('9. assigns an eligible PROCESSED item directly to an Air manifest', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: true, scanIdentifier: item.itemCode });
      expect(res.status).toBe(201);
      expect(res.body.summary.itemCount).toBe(1);
      expect(res.body.items[0].shipmentItem.id).toBe(item.itemId);

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.itemId } });
      expect(dbItem.status).toBe('ASSIGNED_TO_MANIFEST');

      const event = await prisma.trackingEvent.findFirst({
        where: { shipmentItemId: item.itemId, eventType: 'ASSIGNED_TO_MANIFEST' },
      });
      expect(event?.source).toBe('BARCODE_SCAN');
      expect(event?.scanIdentifier).toBe(item.itemCode);
    });

    it('10. supports partial shipment assignment — one item assigned, the sibling item untouched', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 2);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await receiveItem(app, tokenA, shipment.items[1].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[1].id, tenantA.warehouseId);

      await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/items/${shipment.items[0].id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });

      const dbItem0 = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: shipment.items[0].id } });
      const dbItem1 = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: shipment.items[1].id } });
      expect(dbItem0.status).toBe('ASSIGNED_TO_MANIFEST');
      expect(dbItem1.status).toBe('PROCESSED'); // untouched — can go on a different manifest/flight later
    });

    it('11. rejects HOLD/EXCEPTION and unprocessed items', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });

      // Unprocessed (still RECEIVED_ORIGIN_WAREHOUSE).
      const unprocessedShipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
      await receiveItem(app, tokenA, unprocessedShipment.items[0].id, tenantA.warehouseId);
      const unprocessedRes = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/items/${unprocessedShipment.items[0].id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(unprocessedRes.status).toBe(409);

      // HOLD/EXCEPTION.
      const heldShipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
      await receiveItem(app, tokenA, heldShipment.items[0].id, tenantA.warehouseId);
      await request(app.getHttpServer())
        .post(`/warehouse/items/${heldShipment.items[0].id}/process`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          warehouseId: tenantA.warehouseId,
          condition: 'DAMAGED',
          result: 'HOLD',
          hasException: true,
          exceptionDescription: 'Damaged',
          scanned: false,
        });
      const heldRes = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/items/${heldShipment.items[0].id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(heldRes.status).toBe(409);
    });

    it("12. rejects an item belonging to another tenant", async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR' });
      const itemB = await createReadyItem(app, tokenB, tenantB);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/items/${itemB.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(res.status).toBe(404);
    });

    it('13. rejects a duplicate assignment of the same item', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      await assignItem(app, tokenA, manifest.id, item.itemId);

      const dupRes = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(dupRes.status).toBe(409);

      const rows = await prisma.manifestItem.count({ where: { manifestId: manifest.id, shipmentItemId: item.itemId } });
      expect(rows).toBe(1);
    });

    it('14. unassigns an item before finalization, reverting it to PROCESSED', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      await assignItem(app, tokenA, manifest.id, item.itemId);

      const res = await request(app.getHttpServer())
        .delete(`/manifests/${manifest.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'Flight rescheduled' });
      expect(res.status).toBe(200);

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.itemId } });
      expect(dbItem.status).toBe('PROCESSED');

      const manifestItem = await prisma.manifestItem.findFirstOrThrow({
        where: { manifestId: manifest.id, shipmentItemId: item.itemId },
      });
      expect(manifestItem.removedAt).not.toBeNull();
      expect(manifestItem.removalReason).toBe('Flight rescheduled');

      const removedEvent = await prisma.trackingEvent.findFirst({
        where: { shipmentItemId: item.itemId, eventType: 'REMOVED_FROM_MANIFEST' },
      });
      expect(removedEvent).not.toBeNull();
    });
  });

  // -- RBAC -----------------------------------------------------------------

  describe('RBAC', () => {
    it('15a. rejects a CUSTOMER from assigning or unassigning containers or items', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);

      const assignRes = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/containers/${container.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({});
      expect(assignRes.status).toBe(403);
    });

    it('15b. rejects ACCOUNTANT from assigning (read-only)', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ scanned: false });
      expect(res.status).toBe(403);
    });

    it('15c. CUSTOMER_SERVICE can assign a container (OPERATIONS_ROLES) but not a direct air item (WAREHOUSE_ROLES only)', async () => {
      const oceanManifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
      const containerRes = await request(app.getHttpServer())
        .post(`/manifests/${oceanManifest.id}/containers/${container.id}`)
        .set('Authorization', `Bearer ${customerServiceToken}`)
        .send({});
      expect(containerRes.status).toBe(201);

      const airManifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      const itemRes = await request(app.getHttpServer())
        .post(`/manifests/${airManifest.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${customerServiceToken}`)
        .send({ scanned: false });
      expect(itemRes.status).toBe(403);
    });

    it('15d. WAREHOUSE_MANAGER (in both role sets) can assign both containers and items', async () => {
      const oceanManifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_FCL', originWarehouseId: tenantA.warehouseId });
      const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
      const containerRes = await assignContainer(app, tokenA, oceanManifest.id, container.id);
      expect(containerRes.summary.containerCount).toBe(1);

      const airManifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      const itemRes = await assignItem(app, tokenA, airManifest.id, item.itemId);
      expect(itemRes.summary.itemCount).toBe(1);
    });
  });

  it('rejects assigning a container to an AIR manifest, and an item to an OCEAN manifest', async () => {
    const airManifest = await createManifest(app, tokenA, { shipmentMode: 'AIR', originWarehouseId: tenantA.warehouseId });
    const container = await createAndFinalizeContainer(app, tokenA, tenantA, 1);
    const wrongModeContainerRes = await request(app.getHttpServer())
      .post(`/manifests/${airManifest.id}/containers/${container.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(wrongModeContainerRes.status).toBe(409);

    const oceanManifest = await createManifest(app, tokenA, { shipmentMode: 'OCEAN_LCL', originWarehouseId: tenantA.warehouseId });
    const item = await createReadyItem(app, tokenA, tenantA);
    const wrongModeItemRes = await request(app.getHttpServer())
      .post(`/manifests/${oceanManifest.id}/items/${item.itemId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ scanned: false });
    expect(wrongModeItemRes.status).toBe(409);
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
        description: 'E2E manifest test box',
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

/** Books a container, loads `itemCount` fresh READY items into it, and finalizes/seals it. */
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
