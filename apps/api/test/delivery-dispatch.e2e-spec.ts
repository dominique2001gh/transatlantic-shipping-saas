import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for the Delivery/Driver Dispatch milestone:
 *   - WarehouseService.dispatchItem() — RECEIVED_DESTINATION_WAREHOUSE ->
 *     OUT_FOR_DELIVERY, the flexible driver/courier requirement, the hard
 *     wrong-warehouse reject, duplicate/invalid-transition safety.
 *   - WarehouseService.deliverItem() — OUT_FOR_DELIVERY -> DELIVERED, a
 *     terminal handoff exactly like Customer Pickup's PICKED_UP, courier
 *     detail carried forward from the dispatch record when not resupplied.
 *   - WarehouseService.returnItem() — a failed delivery attempt, retry-
 *     eligible (back to RECEIVED_DESTINATION_WAREHOUSE) or needing review
 *     (EXCEPTION), never DELIVERED.
 *   - maybeRollupShipmentCompletion — a shipment completes via a mix of
 *     PICKED_UP and DELIVERED items, only once every applicable item has
 *     reached one of those two states.
 *
 * Customer Pickup's own suite (customer-pickup.e2e-spec.ts) is unchanged
 * and still exercised independently — this file only adds coverage, it
 * does not touch or duplicate that regression protection.
 */
describe('Delivery/Driver Dispatch (e2e)', () => {
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
    tenantA = await createTestTenant(prisma, 'DdA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'DdB', UserRole.WAREHOUSE_MANAGER);
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
  // A. Successful dispatch
  // -------------------------------------------------------------------
  describe('Dispatch', () => {
    it('dispatches a received item: -> OUT_FOR_DELIVERY, currentWarehouseId cleared, immutable DISPATCH record + tracking event', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);

      const res = await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Ama Boateng',
        recipientPhone: '+233-20-555-0100',
        deliveryAddress: '12 Ring Road East, Accra',
        courierName: 'Kwame (independent driver)',
        courierPhone: '+233-24-555-0200',
        courierReference: 'GR-1234-24',
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('OUT_FOR_DELIVERY');

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('OUT_FOR_DELIVERY');
      expect(dbItem.currentWarehouseId).toBeNull();

      const record = await prisma.pickupDeliveryRecord.findFirstOrThrow({ where: { shipmentItemId: manifest.itemId } });
      expect(record.type).toBe('DISPATCH');
      expect(record.recipientName).toBe('Ama Boateng');
      expect(record.courierName).toBe('Kwame (independent driver)');
      expect(record.deliveryAddress).toBe('12 Ring Road East, Accra');
      expect(record.warehouseId).toBe(tenantA.warehouseId);

      const events = await prisma.trackingEvent.findMany({
        where: { shipmentItemId: manifest.itemId },
        orderBy: { occurredAt: 'asc' },
      });
      expect(events.map((e) => e.eventType)).toContain('RECEIVED_DESTINATION_WAREHOUSE');
      expect(events.map((e) => e.eventType)).toContain('OUT_FOR_DELIVERY');
      expect(events.filter((e) => e.eventType === 'OUT_FOR_DELIVERY')).toHaveLength(1);

      // The item leaving custody must not still count as this warehouse's inventory.
      const inventoryRes = await request(app.getHttpServer())
        .get(`/warehouse/inventory?warehouseId=${tenantA.warehouseId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(inventoryRes.body.some((i: { id: string }) => i.id === manifest.itemId)).toBe(false);
    });

    it('rejects dispatch with neither driverUserId nor courierName', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      const res = await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Someone' });
      expect(res.status).toBe(400);

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('RECEIVED_DESTINATION_WAREHOUSE'); // untouched
    });

    it('rejects dispatch of an item not yet received at the destination warehouse', async () => {
      const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1); // ARRIVED_DESTINATION only
      const res = await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Someone',
        courierName: 'DHL Ghana',
      });
      expect(res.status).toBe(409);
    });

    it('rejects dispatch from a warehouse other than the one physically holding the item', async () => {
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
      const res = await dispatch(app, tokenA, manifest.itemId, otherWarehouse.id, {
        recipientName: 'Someone',
        courierName: 'DHL Ghana',
      });
      expect(res.status).toBe(409);

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('RECEIVED_DESTINATION_WAREHOUSE');
      expect(dbItem.currentWarehouseId).toBe(tenantA.warehouseId);
    });

    it('rejects a duplicate dispatch of an item already OUT_FOR_DELIVERY', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      const first = await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Someone',
        courierName: 'DHL Ghana',
      });
      expect(first.status).toBe(201);

      const second = await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Someone',
        courierName: 'DHL Ghana',
      });
      expect(second.status).toBe(409);

      const records = await prisma.pickupDeliveryRecord.findMany({ where: { shipmentItemId: manifest.itemId } });
      expect(records).toHaveLength(1);
    });

    it('rejects dispatch of an item already PICKED_UP', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      const pickupRes = await pickup(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama Boateng' });
      expect(pickupRes.status).toBe(201);

      const res = await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Someone',
        courierName: 'DHL Ghana',
      });
      expect(res.status).toBe(409);
    });

    it('rejects dispatch of an item already DELIVERED', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama', courierName: 'DHL Ghana' });
      await deliver(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama Boateng' });

      const res = await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Someone',
        courierName: 'DHL Ghana',
      });
      expect(res.status).toBe(409);
    });

    it("cross-tenant denial: Tenant B cannot dispatch Tenant A's item", async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      const res = await dispatch(app, tokenB, manifest.itemId, tenantB.warehouseId, {
        recipientName: 'Someone',
        courierName: 'DHL Ghana',
      });
      expect(res.status).toBe(404);
    });

    describe('RBAC', () => {
      it('rejects ACCOUNTANT and CUSTOMER from dispatching an item', async () => {
        const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
        for (const token of [accountantToken, customerToken]) {
          const res = await dispatch(app, token, manifest.itemId, tenantA.warehouseId, {
            recipientName: 'Someone',
            courierName: 'DHL Ghana',
          });
          expect(res.status).toBe(403);
        }
      });

      it('allows WAREHOUSE_STAFF and DESTINATION_AGENT to dispatch an item', async () => {
        const m1 = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
        const staffRes = await dispatch(app, staffToken, m1.itemId, tenantA.warehouseId, {
          recipientName: 'Someone',
          courierName: 'DHL Ghana',
        });
        expect(staffRes.status).toBe(201);

        const m2 = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
        const agentRes = await dispatch(app, destinationAgentToken, m2.itemId, tenantA.warehouseId, {
          recipientName: 'Someone',
          courierName: 'DHL Ghana',
        });
        expect(agentRes.status).toBe(201);
      });
    });
  });

  // -------------------------------------------------------------------
  // B. Successful delivery
  // -------------------------------------------------------------------
  describe('Deliver', () => {
    it('confirms delivery of a dispatched item: -> DELIVERED, DELIVERY record created, shipment rolls up to COMPLETED', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Ama Boateng',
        courierName: 'Kwame',
      });

      const res = await deliver(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Ama Boateng',
        recipientPhone: '+233-20-555-0100',
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DELIVERED');

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('DELIVERED');
      expect(dbItem.currentWarehouseId).toBeNull();

      const deliveryRecord = await prisma.pickupDeliveryRecord.findFirstOrThrow({
        where: { shipmentItemId: manifest.itemId, type: 'DELIVERY' },
      });
      expect(deliveryRecord.recipientName).toBe('Ama Boateng');
      // Courier not resupplied — carried forward from the DISPATCH record.
      expect(deliveryRecord.courierName).toBe('Kwame');

      const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).toBe('COMPLETED');

      const events = await prisma.trackingEvent.findMany({
        where: { shipmentItemId: manifest.itemId },
        orderBy: { occurredAt: 'asc' },
      });
      expect(events.map((e) => e.eventType)).toContain('OUT_FOR_DELIVERY');
      expect(events.map((e) => e.eventType)).toContain('DELIVERED');
    });

    it('rejects delivery confirmation of an item that was never dispatched', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1); // RECEIVED, never dispatched
      const res = await deliver(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Someone' });
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate delivery confirmation, with no duplicate record or event', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama', courierName: 'DHL' });
      const first = await deliver(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama Boateng' });
      expect(first.status).toBe(201);

      const second = await deliver(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama Boateng' });
      expect(second.status).toBe(409);

      const events = await prisma.trackingEvent.findMany({
        where: { shipmentItemId: manifest.itemId, eventType: 'DELIVERED' },
      });
      expect(events).toHaveLength(1);
    });

    it("cross-tenant denial: Tenant B cannot confirm delivery of Tenant A's item", async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama', courierName: 'DHL' });
      const res = await deliver(app, tokenB, manifest.itemId, tenantB.warehouseId, { recipientName: 'Someone' });
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // C. Failed attempt / return to warehouse
  // -------------------------------------------------------------------
  describe('Return (failed delivery attempt)', () => {
    it('returns a retry-eligible failed attempt: -> RECEIVED_DESTINATION_WAREHOUSE, currentWarehouseId restored, RETURNED_TO_WAREHOUSE event, eligible for a fresh dispatch', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama', courierName: 'DHL' });

      const res = await returnAttempt(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        failureReason: 'Recipient unavailable, will retry tomorrow',
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('RECEIVED_DESTINATION_WAREHOUSE');

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('RECEIVED_DESTINATION_WAREHOUSE');
      expect(dbItem.currentWarehouseId).toBe(tenantA.warehouseId);

      const events = await prisma.trackingEvent.findMany({
        where: { shipmentItemId: manifest.itemId },
        orderBy: { occurredAt: 'asc' },
      });
      const types = events.map((e) => e.eventType);
      // Original dispatch + failed-attempt history both preserved, not erased.
      expect(types).toContain('OUT_FOR_DELIVERY');
      expect(types).toContain('RETURNED_TO_WAREHOUSE');

      // Eligible for a fresh dispatch immediately.
      const redispatch = await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        recipientName: 'Ama Boateng',
        courierName: 'A different courier this time',
      });
      expect(redispatch.status).toBe(201);

      // And a walk-in pickup would have been equally valid from this
      // state — checked by returning a second item and picking it up
      // instead of redispatching.
      const manifest2 = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await dispatch(app, tokenA, manifest2.itemId, tenantA.warehouseId, { recipientName: 'X', courierName: 'DHL' });
      await returnAttempt(app, tokenA, manifest2.itemId, tenantA.warehouseId, { failureReason: 'Wrong address' });
      const pickupInstead = await pickup(app, tokenA, manifest2.itemId, tenantA.warehouseId, { recipientName: 'Kofi Owusu' });
      expect(pickupInstead.status).toBe(201);
    });

    it('records a needs-review failure as EXCEPTION, never DELIVERED, with currentWarehouseId restored', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama', courierName: 'DHL' });

      const res = await returnAttempt(app, tokenA, manifest.itemId, tenantA.warehouseId, {
        failureReason: 'Package damaged in transit',
        hasException: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('EXCEPTION');
      expect(res.body.status).not.toBe('DELIVERED');

      const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: manifest.itemId } });
      expect(dbItem.status).toBe('EXCEPTION');
      expect(dbItem.currentWarehouseId).toBe(tenantA.warehouseId); // still physically present, just held for review
    });

    it('rejects returning an item that was never dispatched', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      const res = await returnAttempt(app, tokenA, manifest.itemId, tenantA.warehouseId, { failureReason: 'n/a' });
      expect(res.status).toBe(409);
    });

    it('rejects returning an item that has already been delivered', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 1);
      await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama', courierName: 'DHL' });
      await deliver(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Ama Boateng' });

      const res = await returnAttempt(app, tokenA, manifest.itemId, tenantA.warehouseId, { failureReason: 'n/a' });
      expect(res.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------
  // D. Multi-item mixed handoff
  // -------------------------------------------------------------------
  describe('Shipment completion rollup with mixed handoff', () => {
    it('completes only after one item is PICKED_UP and the other is DELIVERED', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 2);
      const [itemA, itemB] = manifest.itemIds;

      await pickup(app, tokenA, itemA, tenantA.warehouseId, { recipientName: 'Ama Boateng' });

      let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).not.toBe('COMPLETED');
      expect(dbShipment.status).toBe('ARRIVED_DESTINATION');

      await dispatch(app, tokenA, itemB, tenantA.warehouseId, { recipientName: 'Kofi Owusu', courierName: 'DHL Ghana' });

      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).not.toBe('COMPLETED'); // one picked up, one still out for delivery

      await deliver(app, tokenA, itemB, tenantA.warehouseId, { recipientName: 'Kofi Owusu' });

      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).toBe('COMPLETED');

      const completionEvent = await prisma.trackingEvent.findFirstOrThrow({
        where: { shipmentId: manifest.shipmentId, eventType: 'COMPLETED' },
      });
      expect(completionEvent.status).toBe('COMPLETED');
    });

    it('does not complete while one item is stuck in EXCEPTION after a failed delivery review', async () => {
      const manifest = await createReceivedOceanManifest(app, tokenA, tenantA, 2);
      const [itemA, itemB] = manifest.itemIds;

      await pickup(app, tokenA, itemA, tenantA.warehouseId, { recipientName: 'Ama Boateng' });
      await dispatch(app, tokenA, itemB, tenantA.warehouseId, { recipientName: 'Kofi Owusu', courierName: 'DHL Ghana' });
      await returnAttempt(app, tokenA, itemB, tenantA.warehouseId, { failureReason: 'Damaged', hasException: true });

      const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: manifest.shipmentId } });
      expect(dbShipment.status).not.toBe('COMPLETED'); // itemB's unresolved exception must keep blocking completion
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated rather than shared with
// customer-pickup.e2e-spec.ts, matching this test suite's existing
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
  opts: { recipientName: string },
) {
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
  opts: { recipientName: string; courierName?: string; recipientPhone?: string; deliveryAddress?: string; courierPhone?: string; courierReference?: string },
) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/dispatch`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
}

async function deliver(
  app: INestApplication,
  token: string,
  itemId: string,
  warehouseId: string,
  opts: { recipientName: string; recipientPhone?: string },
) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/deliver`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
}

async function returnAttempt(
  app: INestApplication,
  token: string,
  itemId: string,
  warehouseId: string,
  opts: { failureReason: string; hasException?: boolean },
) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/return`)
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
      containerNumber: `E2E-DD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        description: 'E2E delivery-dispatch test box',
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
 * Full pipeline to the exact precondition Delivery Dispatch needs — same
 * shape as customer-pickup.e2e-spec.ts's own helper of this name.
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
