import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for the Customer Pickup milestone:
 *   - WarehouseService.pickupItem() — eligibility (must be
 *     RECEIVED_DESTINATION_WAREHOUSE), the hard wrong-warehouse reject,
 *     duplicate/stale-submit safety, and the recipient/immutable-record
 *     capture.
 *   - WarehouseService.maybeRollupShipmentCompletion() — a shipment only
 *     reaches COMPLETED once every applicable item has a terminal handoff
 *     status, never early on a partial multi-item pickup.
 *
 * Deliberately does not implement or test Delivery/Driver/Dispatch — see
 * ITEM_TERMINAL_HANDOFF's own comment for why the rollup is already
 * shaped to accept it later without changes here.
 */
describe('Customer Pickup (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;
  let tokenB: string;
  let staffToken: string;
  let destinationAgentToken: string;
  let customerToken: string;
  let accountantToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'CpA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'CpB', UserRole.WAREHOUSE_MANAGER);
    const staffUser = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);
    const destinationAgentUser = await createUserInTenant(
      prisma,
      tenantA.tenantId,
      'DestAgent',
      UserRole.DESTINATION_AGENT,
    );
    const customerUser = await createUserInTenant(prisma, tenantA.tenantId, 'Cust', UserRole.CUSTOMER);
    const accountantUser = await createUserInTenant(prisma, tenantA.tenantId, 'Acct', UserRole.ACCOUNTANT);

    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
    tokenB = await login(app, tenantB.user.email, tenantB.user.password);
    staffToken = await login(app, staffUser.email, staffUser.password);
    destinationAgentToken = await login(app, destinationAgentUser.email, destinationAgentUser.password);
    customerToken = await login(app, customerUser.email, customerUser.password);
    accountantToken = await login(app, accountantUser.email, accountantUser.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  it('picks up a received item: -> PICKED_UP, currentWarehouseId cleared, immutable record + tracking event written', async () => {
    const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);

    const res = await pickup(app, tokenA, manifest.itemId, tenantA.warehouseId, {
      recipientName: 'Ama Boateng',
      recipientPhone: '+233-20-555-0100',
      recipientIdReference: 'National ID 12345',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PICKED_UP');

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
    expect(dbItem.status).toBe('PICKED_UP');
    // Left the building — no longer "at" any warehouse (see
    // WarehouseService.pickupItem's own comment on this).
    expect(dbItem.currentWarehouseId).toBeNull();

    const record = await prisma.pickupDeliveryRecord.findFirstOrThrow({ where: { shipmentItemId: manifest.itemId } });
    expect(record.type).toBe('PICKUP');
    expect(record.recipientName).toBe('Ama Boateng');
    expect(record.recipientPhone).toBe('+233-20-555-0100');
    expect(record.warehouseId).toBe(tenantA.warehouseId);
    expect(record.trackingEventId).not.toBeNull();

    const events = await prisma.trackingEvent.findMany({
      where: { shipmentItemId: manifest.itemId },
      orderBy: { occurredAt: 'asc' },
    });
    const types = events.map((e) => e.eventType);
    // History preserved, not overwritten — everything before pickup is still there.
    expect(types).toContain('RECEIVED_DESTINATION_WAREHOUSE');
    expect(types).toContain('PICKED_UP');
    expect(events.filter((e) => e.eventType === 'PICKED_UP')).toHaveLength(1);
  });

  it('rejects pickup of an item that has not yet been received at the destination warehouse', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1); // ARRIVED_DESTINATION, not yet destination-received
    const res = await pickup(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Someone' });
    expect(res.status).toBe(409);

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
    expect(dbItem.status).toBe('ARRIVED_DESTINATION'); // untouched
  });

  it('rejects a duplicate/stale-resubmitted pickup, with no duplicate record or event', async () => {
    const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
    const first = await pickup(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama Boateng' });
    expect(first.status).toBe(201);

    const second = await pickup(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama Boateng' });
    expect(second.status).toBe(409);

    const records = await prisma.pickupDeliveryRecord.findMany({ where: { shipmentItemId: manifest.itemId } });
    expect(records).toHaveLength(1);
    const events = await prisma.trackingEvent.findMany({
      where: { shipmentItemId: manifest.itemId, eventType: 'PICKED_UP' },
    });
    expect(events).toHaveLength(1);
  });

  it('rejects pickup from a warehouse other than the one physically holding the item', async () => {
    const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
    const otherWarehouse = await prisma.warehouse.create({
      data: {
        tenantId: tenantA.tenantId,
        name: 'Other Destination WH',
        code: `OTHER-${Date.now()}`,
        addressLine1: '9 Elsewhere Rd',
        city: 'Kumasi',
        country: 'GH',
        isDestinationWarehouse: true,
      },
    });

    const res = await pickup(app, tokenA, manifest.itemId, otherWarehouse.id, { recipientName: 'Someone' });
    expect(res.status).toBe(409);

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
    expect(dbItem.status).toBe('RECEIVED_DESTINATION_WAREHOUSE'); // untouched — did not get picked up from the wrong place
    expect(dbItem.currentWarehouseId).toBe(tenantA.warehouseId);
  });

  describe('Shipment completion rollup', () => {
    it('completes a single-item shipment once its only item is picked up', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await pickup(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama Boateng' });

      const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).toBe('COMPLETED');
    });

    it('does NOT complete a multi-item shipment until every item is picked up', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 2);
      await pickup(app, tokenA, manifest.itemIds[0], tenantA.warehouseId, { recipientName: 'Ama Boateng' });

      let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).not.toBe('COMPLETED');
      expect(dbShipment.status).toBe('ARRIVED_DESTINATION'); // one item down, shipment-level status must not move yet

      await pickup(app, tokenA, manifest.itemIds[1], tenantA.warehouseId, { recipientName: 'Kofi Owusu' });

      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).toBe('COMPLETED'); // now both items are handed off
    });
  });

  describe('RBAC', () => {
    it('rejects ACCOUNTANT and CUSTOMER from picking up an item', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      for (const token of [accountantToken, customerToken]) {
        const res = await pickup(app, token, manifest.itemId, tenantA.warehouseId, { recipientName: 'Someone' });
        expect(res.status).toBe(403);
      }
    });

    it('allows WAREHOUSE_STAFF and DESTINATION_AGENT to pick up an item', async () => {
      const m1 = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      const staffRes = await pickup(app, staffToken, m1.itemId, tenantA.warehouseId, { recipientName: 'Someone' });
      expect(staffRes.status).toBe(201);

      const m2 = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      const agentRes = await pickup(app, destinationAgentToken, m2.itemId, tenantA.warehouseId, {
        recipientName: 'Someone Else',
      });
      expect(agentRes.status).toBe(201);
    });
  });

  it("cross-tenant denial: Tenant B cannot pick up Tenant A's item", async () => {
    const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
    const res = await pickup(app, tokenB, manifest.itemId, tenantB.warehouseId, { recipientName: 'Someone' });
    expect(res.status).toBe(404);

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
    expect(dbItem.status).toBe('RECEIVED_DESTINATION_WAREHOUSE'); // untouched
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated rather than shared with
// destination-receive.e2e-spec.ts, matching this test suite's existing
// per-file-helpers convention.
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function pickup(
  app: INestApplication,
  token: string,
  itemId: string,
  warehouseId: string,
  opts: { recipientName: string; recipientPhone?: string; recipientIdReference?: string; notes?: string },
) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/pickup`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
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
}

async function departManifest(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/depart`)
    .set('Authorization', `Bearer ${token}`)
    .send();
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
    .send({
      containerNumber: `E2E-CP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      containerType: 'TWENTY_FT',
      ...opts,
    });
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
      items: Array.from({ length: itemCount }, () => ({
        itemType: ShipmentItemType.BOX,
        description: 'E2E customer-pickup test box',
      })),
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

/**
 * Full pipeline to the exact precondition Customer Pickup needs: books,
 * loads, and finalizes a container with `itemCount` fresh items on one
 * shipment, ships it on a finalized+departed+arrived Ocean manifest, then
 * destination-receives every item at tenant.warehouseId (reused here as
 * the *destination* warehouse purely for test convenience — nothing in
 * this flow assumes it's literally an origin-flagged warehouse).
 */
async function createReceivedOceanManifest(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  itemCount: number,
): Promise<{ manifestId: string; containerId: string; itemId: string; itemIds: string[]; shipmentId: string }> {
  const manifest = await createArrivedOceanManifest(app, token, tenant, itemCount);
  for (const itemId of manifest.itemIds) {
    await destinationReceiveOnce(app, token, itemId, tenant.warehouseId);
  }
  return manifest;
}

/** Same shape as destination-receive.e2e-spec.ts's own helper of the same name — departs then arrives an Ocean manifest carrying `itemCount` fresh items. */
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
    itemIds: shipment.items.map((i) => i.id),
    shipmentId: shipment.id,
  };
}
