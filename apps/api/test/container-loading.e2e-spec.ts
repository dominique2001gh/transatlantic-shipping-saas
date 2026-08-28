import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for Milestone 3D (Load Container /
 * Consolidation), against the real Nest app, real Prisma, real Postgres.
 * Covers the happy path (load -> finalize), every rejection path
 * (unprocessed/on-hold/wrong-warehouse/duplicate/no-warehouse/finalized),
 * unload + container/shipment status reversion, the finalize role gate,
 * mixed-customer containers, soft route/destination warnings, cross-tenant
 * denial, and the shipment-level CONSOLIDATED/LOADED rollup in both
 * directions.
 */
describe('Load Container / Consolidation workflow (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;
  let tokenB: string;
  let staffToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'LoadA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'LoadB', UserRole.WAREHOUSE_MANAGER);
    const staffUser = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);

    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
    tokenB = await login(app, tenantB.user.email, tenantB.user.password);
    staffToken = await login(app, staffUser.email, staffUser.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  it('happy path: books a container, loads two ready items from different shipments, and finalizes it', async () => {
    const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
    expect(container.status).toBe('BOOKED');

    const item1 = await createReadyItem(app, tokenA, tenantA);
    const item2 = await createReadyItem(app, tokenA, tenantA);

    const loadRes1 = await request(app.getHttpServer())
      .post(`/containers/${container.id}/items/${item1.itemId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ scanned: true, scanIdentifier: item1.itemCode });
    expect(loadRes1.status).toBe(201);
    expect(loadRes1.body.status).toBe('LOADING');
    expect(loadRes1.body.summary.itemCount).toBe(1);

    const loadRes2 = await request(app.getHttpServer())
      .post(`/containers/${container.id}/items/${item2.itemId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ scanned: false });
    expect(loadRes2.status).toBe(201);
    expect(loadRes2.body.summary.itemCount).toBe(2);

    const dbItem1 = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item1.itemId } });
    expect(dbItem1.status).toBe('ASSIGNED_TO_CONTAINER');

    const shipment1 = await prisma.shipment.findUniqueOrThrow({ where: { id: item1.shipmentId } });
    expect(shipment1.status).toBe('CONSOLIDATED');

    const finalizeRes = await request(app.getHttpServer())
      .post(`/containers/${container.id}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sealNumber: 'SEAL-123' });
    expect(finalizeRes.status).toBe(201);
    expect(finalizeRes.body.status).toBe('LOADED');
    expect(finalizeRes.body.sealNumber).toBe('SEAL-123');

    const dbItem1After = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item1.itemId } });
    expect(dbItem1After.status).toBe('LOADED');
    const shipment1After = await prisma.shipment.findUniqueOrThrow({ where: { id: item1.shipmentId } });
    expect(shipment1After.status).toBe('LOADED');
  });

  describe('load-eligibility rejections', () => {
    it('rejects a REGISTERED item (not yet received)', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
      const res = await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${shipment.items[0].id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(res.status).toBe(409);
    });

    it('rejects a RECEIVED_ORIGIN_WAREHOUSE item (not yet processed)', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      const res = await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${shipment.items[0].id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(res.status).toBe(409);
    });

    it('rejects an EXCEPTION/HOLD item', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await request(app.getHttpServer())
        .post(`/warehouse/items/${shipment.items[0].id}/process`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          warehouseId: tenantA.warehouseId,
          condition: 'DAMAGED',
          result: 'HOLD',
          hasException: true,
          exceptionDescription: 'Damaged',
          scanned: false,
        });
      const res = await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${shipment.items[0].id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(res.status).toBe(409);
    });

    it("rejects loading at a warehouse other than the item's current location", async () => {
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
      const container = await createContainer(app, tokenA, { warehouseId: otherWarehouse.id });
      const item = await createReadyItem(app, tokenA, tenantA); // physically at tenantA.warehouseId
      const res = await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(res.status).toBe(409);
    });

    it('rejects loading into a container with no warehouse assigned', async () => {
      const container = await createContainer(app, tokenA, {});
      const item = await createReadyItem(app, tokenA, tenantA);
      const res = await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate load without creating a duplicate ContainerItem row', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      await loadItem(app, tokenA, container.id, item.itemId);

      const dupRes = await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(dupRes.status).toBe(409);

      const rows = await prisma.containerItem.count({ where: { containerId: container.id, shipmentItemId: item.itemId } });
      expect(rows).toBe(1);
    });
  });

  describe('unload and status reversion', () => {
    it('unloading an item reverts it to PROCESSED and the container row is soft-removed, not deleted', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      await loadItem(app, tokenA, container.id, item.itemId);

      const unloadRes = await request(app.getHttpServer())
        .delete(`/containers/${container.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'Wrong container' });
      expect(unloadRes.status).toBe(200);

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.itemId } });
      expect(dbItem.status).toBe('PROCESSED');

      const containerItem = await prisma.containerItem.findFirstOrThrow({
        where: { containerId: container.id, shipmentItemId: item.itemId },
      });
      expect(containerItem.removedAt).not.toBeNull();
      expect(containerItem.removalReason).toBe('Wrong container');
    });

    it('reverts container from LOADING back to BOOKED once its last active item is removed', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      await loadItem(app, tokenA, container.id, item.itemId);

      let dbContainer = await prisma.container.findUniqueOrThrow({ where: { id: container.id } });
      expect(dbContainer.status).toBe('LOADING');

      await request(app.getHttpServer())
        .delete(`/containers/${container.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      dbContainer = await prisma.container.findUniqueOrThrow({ where: { id: container.id } });
      expect(dbContainer.status).toBe('BOOKED');
    });

    it('reverts shipment from CONSOLIDATED back to READY_FOR_CONSOLIDATION once its last assigned item is removed', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      await loadItem(app, tokenA, container.id, item.itemId);

      let shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: item.shipmentId } });
      expect(shipment.status).toBe('CONSOLIDATED');

      await request(app.getHttpServer())
        .delete(`/containers/${container.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: item.shipmentId } });
      expect(shipment.status).toBe('READY_FOR_CONSOLIDATION');
    });
  });

  describe('finalize', () => {
    it('rejects finalize from WAREHOUSE_STAFF (403) but allows WAREHOUSE_MANAGER', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      await loadItem(app, tokenA, container.id, item.itemId);

      const staffRes = await request(app.getHttpServer())
        .post(`/containers/${container.id}/finalize`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({});
      expect(staffRes.status).toBe(403);

      const managerRes = await request(app.getHttpServer())
        .post(`/containers/${container.id}/finalize`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(managerRes.status).toBe(201);
    });

    it('rejects finalizing a container that was never loaded (still BOOKED)', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const res = await request(app.getHttpServer())
        .post(`/containers/${container.id}/finalize`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(409);
    });

    it('rejects load/unload once the container is finalized', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const item = await createReadyItem(app, tokenA, tenantA);
      await loadItem(app, tokenA, container.id, item.itemId);
      await request(app.getHttpServer())
        .post(`/containers/${container.id}/finalize`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      const anotherItem = await createReadyItem(app, tokenA, tenantA);
      const loadAfterRes = await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${anotherItem.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });
      expect(loadAfterRes.status).toBe(409);

      const unloadAfterRes = await request(app.getHttpServer())
        .delete(`/containers/${container.id}/items/${item.itemId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(unloadAfterRes.status).toBe(409);
    });
  });

  it('supports mixed-customer containers: two different customers in one container, no cross-leakage', async () => {
    const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });

    const customer2 = await prisma.customer.create({
      data: {
        tenantId: tenantA.tenantId,
        customerNumber: `E2E-CUST2-${Date.now()}`,
        firstName: 'Second',
        lastName: 'Customer',
        email: `second-${Date.now()}@example.test`,
      },
    });

    const item1 = await createReadyItem(app, tokenA, tenantA); // tenantA.customerId
    const shipment2 = await createSingleShipment(app, tokenA, customer2.id, 1);
    await receiveItem(app, tokenA, shipment2.items[0].id, tenantA.warehouseId);
    await processOnce(app, tokenA, shipment2.items[0].id, tenantA.warehouseId);

    await loadItem(app, tokenA, container.id, item1.itemId);
    await loadItem(app, tokenA, container.id, shipment2.items[0].id);

    const res = await request(app.getHttpServer())
      .get(`/containers/${container.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.customerCount).toBe(2);
    expect(res.body.summary.itemCount).toBe(2);
  });

  it('surfaces (but does not block) a destination mismatch against the container route', async () => {
    const route = await prisma.route.create({
      data: {
        tenantId: tenantA.tenantId,
        name: 'Test Route',
        originCountry: 'US',
        destinationCountry: 'Nigeria',
        shipmentMode: 'OCEAN_LCL',
      },
    });
    const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId, routeId: route.id });
    const item = await createReadyItem(app, tokenA, tenantA); // shipment destinationCountry 'GH' (see helper)

    const res = await request(app.getHttpServer())
      .post(`/containers/${container.id}/items/${item.itemId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ scanned: false });
    expect(res.status).toBe(201); // not blocked
    expect(res.body.destinationWarning).toContain('does not match');
  });

  it('cross-tenant denial: Tenant B cannot view, load, unload, or finalize Tenant A\'s container', async () => {
    const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
    const item = await createReadyItem(app, tokenA, tenantA);

    const viewRes = await request(app.getHttpServer())
      .get(`/containers/${container.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(viewRes.status).toBe(404);

    const loadRes = await request(app.getHttpServer())
      .post(`/containers/${container.id}/items/${item.itemId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ scanned: false });
    expect(loadRes.status).toBe(404);

    await loadItem(app, tokenA, container.id, item.itemId);
    const unloadRes = await request(app.getHttpServer())
      .delete(`/containers/${container.id}/items/${item.itemId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({});
    expect(unloadRes.status).toBe(404);

    const finalizeRes = await request(app.getHttpServer())
      .post(`/containers/${container.id}/finalize`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({});
    expect(finalizeRes.status).toBe(404);
  });

  describe('shipment rollup with a multi-item shipment', () => {
    it('stays CONSOLIDATED (not LOADED) if only some of a shipment\'s items are loaded and finalized', async () => {
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 2);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await receiveItem(app, tokenA, shipment.items[1].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[1].id, tenantA.warehouseId);

      await loadItem(app, tokenA, container.id, shipment.items[0].id); // only item 0
      await request(app.getHttpServer())
        .post(`/containers/${container.id}/finalize`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('CONSOLIDATED');
      expect(dbShipment.status).not.toBe('LOADED');
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
        description: 'E2E container test box',
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

/** Creates, receives, and processes-to-READY a fresh single item. Returns its id/code/shipmentId. */
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
  opts: { warehouseId?: string; routeId?: string },
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

async function loadItem(app: INestApplication, token: string, containerId: string, itemId: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/containers/${containerId}/items/${itemId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ scanned: false });
  if (res.status !== 201) {
    throw new Error(`Load failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}
