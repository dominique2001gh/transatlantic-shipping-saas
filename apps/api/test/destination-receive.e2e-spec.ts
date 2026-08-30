import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for Milestone 3F: Destination Receive.
 * Covers all three pieces:
 *   - ManifestsService.arrive() — DEPARTED -> ARRIVED, cascading
 *     ARRIVED_DESTINATION to items (and containers, for Ocean).
 *   - ContainersService.openForUnloading()/closeUnloading() —
 *     ARRIVED -> UNLOADING -> CLOSED, with a discrepancy summary that
 *     never silently hides outstanding/exception items.
 *   - WarehouseService.destinationReceiveItem() — the individual,
 *     staff-scanned per-item receive, with the critical guarantee that
 *     RECEIVED_DESTINATION_WAREHOUSE never implies Ready for
 *     Pickup/Delivery, and that damaged/missing cargo goes to EXCEPTION
 *     instead of silently advancing.
 */
describe('Destination Receive (e2e)', () => {
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
    tenantA = await createTestTenant(prisma, 'DrA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'DrB', UserRole.WAREHOUSE_MANAGER);
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

  // -------------------------------------------------------------------
  // Regression: a pre-existing bug found while writing this milestone's
  // own multi-item tests (see WarehouseService.ITEM_PROCESSED_OR_LATER).
  // Kept as its own describe block since it's about origin-side
  // consolidation, not destination receiving itself.
  // -------------------------------------------------------------------
  describe('Regression: multi-item consolidation rollup (interleaved process/load order)', () => {
    it('reaches READY_FOR_CONSOLIDATION even when items are processed and loaded interleaved, not in two clean batches', async () => {
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 2);
      const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });

      // Deliberately interleaved: process+load item1 fully (moving it past
      // PROCESSED to ASSIGNED_TO_CONTAINER) before item2 is even received —
      // a completely normal floor-staff sequence, and exactly the ordering
      // that used to leave the shipment stuck at PROCESSING forever.
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${shipment.items[0].id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });

      await receiveItem(app, tokenA, shipment.items[1].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[1].id, tenantA.warehouseId);
      await request(app.getHttpServer())
        .post(`/containers/${container.id}/items/${shipment.items[1].id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ scanned: false });

      // Both items are fully loaded (past PROCESSED); the shipment must
      // have advanced beyond PROCESSING despite the interleaving.
      const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('CONSOLIDATED');
      expect(dbShipment.status).not.toBe('PROCESSING');
    });
  });

  // -------------------------------------------------------------------
  // Manifest arrival
  // -------------------------------------------------------------------
  describe('Manifest arrival', () => {
    it('arrives an Ocean manifest: container -> ARRIVED, item -> ARRIVED_DESTINATION, shipment -> ARRIVED_DESTINATION', async () => {
      const manifest = await createDepartedOceanManifest(app, tokenA, tenantA, 1);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.manifestId}/arrive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ARRIVED');
      expect(res.body.arrivedAt).not.toBeNull();
      expect(res.body.arrivedByUser.id).toBeDefined();

      const dbContainer = await prisma.container.findUniqueOrThrow({ where: { id: manifest.containerId } });
      expect(dbContainer.status).toBe('ARRIVED');
      expect(dbContainer.actualArrival).not.toBeNull();

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('ARRIVED_DESTINATION');

      const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).toBe('ARRIVED_DESTINATION');
    });

    it('arrives an Air manifest: item -> ARRIVED_DESTINATION, shipment -> ARRIVED_DESTINATION, no container touched', async () => {
      const manifest = await createDepartedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);

      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.manifestId}/arrive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ARRIVED');

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemIds[0] } });
      expect(dbItem.status).toBe('ARRIVED_DESTINATION');

      const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentIds[0] } });
      expect(dbShipment.status).toBe('ARRIVED_DESTINATION');
    });

    it('rejects arriving a manifest that has not yet DEPARTED', async () => {
      const manifest = await createManifest(app, tokenA, { shipmentMode: 'AIR' });
      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.id}/arrive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(409);
    });

    it('rejects arriving an already-ARRIVED manifest, with no duplicate events', async () => {
      const manifest = await createDepartedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
      await request(app.getHttpServer())
        .post(`/manifests/${manifest.manifestId}/arrive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      const secondRes = await request(app.getHttpServer())
        .post(`/manifests/${manifest.manifestId}/arrive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(secondRes.status).toBe(409);

      const arrivedEvents = await prisma.trackingEvent.findMany({
        where: { shipmentItemId: manifest.itemIds[0], eventType: 'ARRIVED_DESTINATION' },
      });
      expect(arrivedEvents).toHaveLength(1);
    });

    it("cross-tenant denial: Tenant B cannot arrive Tenant A's manifest", async () => {
      const manifest = await createDepartedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
      const res = await request(app.getHttpServer())
        .post(`/manifests/${manifest.manifestId}/arrive`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send();
      expect(res.status).toBe(404);

      const dbManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.manifestId } });
      expect(dbManifest.status).toBe('DEPARTED'); // untouched
    });

    it('does not prematurely arrive a shipment split across two manifests, and completes once the second arrives', async () => {
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
      await departManifest(app, tokenA, manifest1.id);
      await request(app.getHttpServer())
        .post(`/manifests/${manifest1.id}/arrive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      // Only item 0 arrived — item 1 is still sitting PROCESSED, unassigned.
      let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).not.toBe('ARRIVED_DESTINATION');
      const dbItem1 = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: shipment.items[1].id } });
      expect(dbItem1.status).toBe('PROCESSED');

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
      await departManifest(app, tokenA, manifest2.id);
      await request(app.getHttpServer())
        .post(`/manifests/${manifest2.id}/arrive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('ARRIVED_DESTINATION'); // now both items arrived
    });

    describe('RBAC', () => {
      it('rejects WAREHOUSE_STAFF, ACCOUNTANT, and CUSTOMER from arriving a manifest', async () => {
        const m1 = await createDepartedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
        for (const token of [staffToken, accountantToken, customerToken]) {
          const res = await request(app.getHttpServer())
            .post(`/manifests/${m1.manifestId}/arrive`)
            .set('Authorization', `Bearer ${token}`)
            .send();
          expect(res.status).toBe(403);
        }
      });

      it('allows WAREHOUSE_MANAGER and DESTINATION_AGENT to arrive a manifest', async () => {
        const m1 = await createDepartedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
        const res1 = await request(app.getHttpServer())
          .post(`/manifests/${m1.manifestId}/arrive`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send();
        expect(res1.status).toBe(201);

        const m2 = await createDepartedAirManifest(app, tokenA, tenantA, [tenantA.customerId]);
        const res2 = await request(app.getHttpServer())
          .post(`/manifests/${m2.manifestId}/arrive`)
          .set('Authorization', `Bearer ${destinationAgentToken}`)
          .send();
        expect(res2.status).toBe(201);
      });
    });
  });

  // -------------------------------------------------------------------
  // Container unloading (open / close)
  // -------------------------------------------------------------------
  describe('Container unloading', () => {
    it('opens an ARRIVED container for unloading -> UNLOADING', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
      const res = await request(app.getHttpServer())
        .post(`/containers/${manifest.containerId}/open`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('UNLOADING');
    });

    it('rejects opening a container that has not ARRIVED yet', async () => {
      const manifest = await createDepartedOceanManifest(app, tokenA, tenantA, 1); // DEPARTED, not ARRIVED
      const res = await request(app.getHttpServer())
        .post(`/containers/${manifest.containerId}/open`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(409);
    });

    it('closes an UNLOADING container -> CLOSED, and the discrepancy summary reflects partial receiving accurately', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 2);
      await openContainer(app, tokenA, manifest.containerId);

      // Only receive one of the two items before closing.
      await destinationReceive(app, tokenA, manifest.itemIds[0], tenantA.warehouseId, { condition: 'GOOD' });

      const res = await request(app.getHttpServer())
        .post(`/containers/${manifest.containerId}/close`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CLOSED');
      expect(res.body.destinationSummary).toEqual({ receivedCount: 1, outstandingCount: 1, exceptionCount: 0 });
    });

    it('rejects closing a container that is not UNLOADING', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1); // ARRIVED, not opened yet
      const res = await request(app.getHttpServer())
        .post(`/containers/${manifest.containerId}/close`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();
      expect(res.status).toBe(409);
    });

    describe('RBAC', () => {
      it('allows WAREHOUSE_STAFF to open but not close; WAREHOUSE_MANAGER can do both', async () => {
        const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
        const openRes = await request(app.getHttpServer())
          .post(`/containers/${manifest.containerId}/open`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send();
        expect(openRes.status).toBe(201);

        const closeRes = await request(app.getHttpServer())
          .post(`/containers/${manifest.containerId}/close`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send();
        expect(closeRes.status).toBe(403);

        const managerCloseRes = await request(app.getHttpServer())
          .post(`/containers/${manifest.containerId}/close`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send();
        expect(managerCloseRes.status).toBe(201);
      });

      it('allows DESTINATION_AGENT to both open and close', async () => {
        const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
        const openRes = await request(app.getHttpServer())
          .post(`/containers/${manifest.containerId}/open`)
          .set('Authorization', `Bearer ${destinationAgentToken}`)
          .send();
        expect(openRes.status).toBe(201);

        const closeRes = await request(app.getHttpServer())
          .post(`/containers/${manifest.containerId}/close`)
          .set('Authorization', `Bearer ${destinationAgentToken}`)
          .send();
        expect(closeRes.status).toBe(201);
      });
    });
  });

  // -------------------------------------------------------------------
  // Item-level destination receiving
  // -------------------------------------------------------------------
  describe('Item destination receiving', () => {
    it('receives a good-condition item -> RECEIVED_DESTINATION_WAREHOUSE, and moves currentWarehouseId to the destination warehouse', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
      const destinationWarehouse = await prisma.warehouse.create({
        data: {
          tenantId: tenantA.tenantId,
          name: 'Destination WH',
          code: `DEST-${Date.now()}`,
          addressLine1: '1 Dest St',
          city: 'Accra',
          country: 'GH',
          isDestinationWarehouse: true,
        },
      });

      const res = await destinationReceive(app, tokenA, manifest.itemId, destinationWarehouse.id, {
        condition: 'GOOD',
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('RECEIVED_DESTINATION_WAREHOUSE');

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('RECEIVED_DESTINATION_WAREHOUSE');
      // The targeted ShipmentsService.createTrackingEvent fix: currentWarehouseId
      // must move to the destination warehouse even though receivedAt was
      // already stamped at origin (Milestone 3B) — this is exactly the gap
      // that was closed as part of this milestone.
      expect(dbItem.currentWarehouseId).toBe(destinationWarehouse.id);
    });

    it('rejects receiving an item that has not reached ARRIVED_DESTINATION', async () => {
      const manifest = await createDepartedOceanManifest(app, tokenA, tenantA, 1); // DEPARTED_ORIGIN, not arrived
      const res = await destinationReceive(app, tokenA, manifest.itemId, tenantA.warehouseId, { condition: 'GOOD' });
      expect(res.status).toBe(409);
    });

    it('rejects re-receiving an already-received item, with no duplicate events or inspection rows', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
      await destinationReceive(app, tokenA, manifest.itemId, tenantA.warehouseId, { condition: 'GOOD' });

      const secondRes = await destinationReceive(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        condition: 'GOOD',
      });
      expect(secondRes.status).toBe(409);

      const events = await prisma.trackingEvent.findMany({
        where: { shipmentItemId: manifest.itemId, eventType: 'RECEIVED_DESTINATION_WAREHOUSE' },
      });
      expect(events).toHaveLength(1);
      // ItemInspection is deliberately shared with origin processing
      // (Milestone 3C) — a fully-processed, destination-received item
      // legitimately has TWO rows (one per stage), so this checks only
      // the one tied to the destination-receive TrackingEvent stays at
      // exactly one, not that the item has never been inspected before.
      const destinationInspections = await prisma.itemInspection.findMany({
        where: { shipmentItemId: manifest.itemId, trackingEvent: { eventType: 'RECEIVED_DESTINATION_WAREHOUSE' } },
      });
      expect(destinationInspections).toHaveLength(1);
    });

    it('a damaged item goes to EXCEPTION, never RECEIVED_DESTINATION_WAREHOUSE', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
      const res = await destinationReceive(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        condition: 'DAMAGED',
        hasException: true,
        exceptionDescription: 'Crushed box, contents visible',
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('EXCEPTION');

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('EXCEPTION');
      expect(dbItem.status).not.toBe('RECEIVED_DESTINATION_WAREHOUSE');
    });

    it('a "missing" item is recorded manually as EXCEPTION and never silently marked received', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
      const res = await request(app.getHttpServer())
        .post(`/warehouse/items/${manifest.itemId}/destination-receive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          warehouseId: tenantA.warehouseId,
          condition: 'OTHER',
          hasException: true,
          exceptionDescription: 'Not present in container — appears missing',
          scanned: false,
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('EXCEPTION');

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('EXCEPTION');
    });

    it('exceptionDescription is required when hasException is true', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
      const res = await destinationReceive(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        condition: 'DAMAGED',
        hasException: true,
      });
      expect(res.status).toBe(400);
    });

    it('CRITICAL: every item individually RECEIVED_DESTINATION_WAREHOUSE never advances the shipment past ARRIVED_DESTINATION — Ready for Pickup/Delivery is a later milestone', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 2);
      let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).toBe('ARRIVED_DESTINATION');

      for (const itemId of manifest.itemIds) {
        const res = await destinationReceive(app, tokenA, itemId, tenantA.warehouseId, { condition: 'GOOD' });
        expect(res.status).toBe(201);
      }

      // All items are now individually received...
      const items = await prisma.shipmentItem.findMany({ where: { id: { in: manifest.itemIds } } });
      expect(items.every((i) => i.status === 'RECEIVED_DESTINATION_WAREHOUSE')).toBe(true);

      // ...but the shipment must still be exactly ARRIVED_DESTINATION, not
      // READY_FOR_PICKUP or anything further — this is the explicit
      // requirement reinforced for Milestone 3F.
      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).toBe('ARRIVED_DESTINATION');
      expect(dbShipment.status).not.toBe('READY_FOR_PICKUP');
    });

    it('appends RECEIVED_DESTINATION_WAREHOUSE without erasing prior history', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
      await destinationReceive(app, tokenA, manifest.itemId, tenantA.warehouseId, { condition: 'GOOD' });

      const events = await prisma.trackingEvent.findMany({
        where: { shipmentItemId: manifest.itemId },
        orderBy: { occurredAt: 'asc' },
      });
      const types = events.map((e) => e.eventType);
      expect(types).toContain('ITEM_REGISTERED');
      expect(types).toContain('RECEIVED_AT_WAREHOUSE');
      expect(types).toContain('PROCESSED');
      expect(types).toContain('LOADED');
      expect(types).toContain('DEPARTED_ORIGIN');
      expect(types).toContain('ARRIVED_DESTINATION');
      expect(types).toContain('RECEIVED_DESTINATION_WAREHOUSE');
    });

    describe('RBAC', () => {
      it('rejects ACCOUNTANT and CUSTOMER from destination-receiving an item', async () => {
        const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
        for (const token of [accountantToken, customerToken]) {
          const res = await destinationReceive(app, token, manifest.itemId, tenantA.warehouseId, {
            condition: 'GOOD',
          });
          expect(res.status).toBe(403);
        }
      });

      it('allows WAREHOUSE_STAFF and DESTINATION_AGENT to destination-receive an item', async () => {
        const m1 = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
        const staffRes = await destinationReceive(app, staffToken, m1.itemId, tenantA.warehouseId, {
          condition: 'GOOD',
        });
        expect(staffRes.status).toBe(201);

        const m2 = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
        const agentRes = await destinationReceive(app, destinationAgentToken, m2.itemId, tenantA.warehouseId, {
          condition: 'GOOD',
        });
        expect(agentRes.status).toBe(201);
      });
    });

    it("cross-tenant denial: Tenant B cannot destination-receive Tenant A's item", async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
      const res = await destinationReceive(app, tokenB, manifest.itemId, tenantB.warehouseId, { condition: 'GOOD' });
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

async function departManifest(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/depart`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (res.status !== 201) {
    throw new Error(`Depart failed: ${res.status} ${JSON.stringify(res.body)}`);
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

async function openContainer(app: INestApplication, token: string, containerId: string) {
  const res = await request(app.getHttpServer())
    .post(`/containers/${containerId}/open`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (res.status !== 201) {
    throw new Error(`Open container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function destinationReceive(
  app: INestApplication,
  token: string,
  itemId: string,
  warehouseId: string,
  opts: { condition: string; hasException?: boolean; exceptionDescription?: string },
) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/destination-receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
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
        description: 'E2E destination-receive test box',
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
      containerNumber: `E2E-DR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      containerType: 'TWENTY_FT',
      ...opts,
    });
  if (res.status !== 201) {
    throw new Error(`Container creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Books+loads+finalizes a container with `itemCount` fresh READY items
 * (all for the same customer/shipment when itemCount > 1), assigns it to
 * a new finalized Ocean manifest, then departs it. Ends with the
 * manifest DEPARTED (not yet ARRIVED) — the "before this milestone's
 * arrive action" starting point.
 */
async function createDepartedOceanManifest(
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
    originLocation: 'Houston, TX',
    destinationLocation: 'Tema, Ghana',
    carrierName: 'Maersk',
    vesselName: 'Maersk Atlantic',
    voyageNumber: `V-${Date.now()}`,
  });
  await assignContainer(app, token, manifest.id, container.id);
  await finalizeManifest(app, token, manifest.id);
  await departManifest(app, token, manifest.id);

  return {
    manifestId: manifest.id,
    containerId: container.id,
    itemId: shipment.items[0].id,
    itemIds: shipment.items.map((i) => i.id),
    shipmentId: shipment.id,
  };
}

/** Same as createDepartedOceanManifest, plus the arrive() call — the "ready to open/receive" starting point most tests need. */
async function createArrivedOceanManifest(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  itemCount: number,
) {
  const manifest = await createDepartedOceanManifest(app, token, tenant, itemCount);
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifest.manifestId}/arrive`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (res.status !== 201) {
    throw new Error(`Arrive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return manifest;
}

/** Creates+receives+processes+assigns+finalizes+departs one item per customerId on a new Air manifest. */
async function createDepartedAirManifest(
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
    flightNumber: `DL-${Date.now()}`,
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
  await departManifest(app, token, manifest.id);

  return { manifestId: manifest.id, itemIds, shipmentIds };
}
