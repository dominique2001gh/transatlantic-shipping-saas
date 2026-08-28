import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for Milestone 3C (Process/Inspect), against
 * the real Nest app, real Prisma, real Postgres — nothing mocked. Covers
 * the happy path, the damage/hold path, the CRITICAL STATUS RULE,
 * duplicate-scan protection, deliberate/auditable reinspection, invalid
 * codes, cross-tenant denial, RBAC, tracking-history append-only
 * behavior, and the shipment-level rollup to READY_FOR_CONSOLIDATION.
 */
describe('Process/Inspect workflow (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;
  let tokenB: string;
  let customerUserToken: string;
  let staffToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'ProcA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'ProcB', UserRole.WAREHOUSE_MANAGER);

    const customerUser = await createUserInTenant(prisma, tenantA.tenantId, 'Cust', UserRole.CUSTOMER);
    const staffUser = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);
    const adminUser = await createUserInTenant(prisma, tenantA.tenantId, 'Admin', UserRole.TENANT_ADMIN);

    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
    tokenB = await login(app, tenantB.user.email, tenantB.user.password);
    customerUserToken = await login(app, customerUser.email, customerUser.password);
    staffToken = await login(app, staffUser.email, staffUser.password);
    adminToken = await login(app, adminUser.email, adminUser.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  it('rejects processing an item that has not been received yet', async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA, { receive: false });
    const res = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(processBody(tenantA.warehouseId, { condition: 'GOOD', result: 'READY' }));
    expect(res.status).toBe(409);
  });

  it('happy path: processes a received item as READY and records everything required', async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);

    const res = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(
        processBody(tenantA.warehouseId, {
          condition: 'GOOD',
          result: 'READY',
          weight: 42.5,
          weightUnit: 'LB',
          length: 10,
          width: 8,
          height: 6,
          dimensionUnit: 'IN',
          notes: 'Looks fine',
          scanned: true,
          scanIdentifier: item.itemCode,
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PROCESSED');
    expect(res.body.condition).toBe('GOOD');
    expect(res.body.weight).toBe('42.5');
    expect(res.body.lastInspection.result).toBe('READY');

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(dbItem.status).toBe('PROCESSED');
    expect(dbItem.condition).toBe('GOOD');
    expect(dbItem.lastInspectedAt).not.toBeNull();
    expect(dbItem.lastInspectedByUserId).toBe(tenantA.user.id);
    expect(Number(dbItem.weight)).toBe(42.5);

    const inspections = await prisma.itemInspection.findMany({ where: { shipmentItemId: item.id } });
    expect(inspections).toHaveLength(1);
    expect(inspections[0].tenantId).toBe(tenantA.tenantId);
    expect(inspections[0].warehouseId).toBe(tenantA.warehouseId);
    expect(inspections[0].inspectedByUserId).toBe(tenantA.user.id);
    expect(inspections[0].trackingEventId).not.toBeNull();

    const event = await prisma.trackingEvent.findUniqueOrThrow({
      where: { id: inspections[0].trackingEventId! },
    });
    expect(event.eventType).toBe('PROCESSED');
    expect(event.source).toBe('BARCODE_SCAN');
    expect(event.scanIdentifier).toBe(item.itemCode);
    expect((event.metadata as Record<string, unknown>).condition).toBe('GOOD');
  });

  it('damage/hold path: a damaged item with an exception is placed on EXCEPTION, never PROCESSED', async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
    const res = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(
        processBody(tenantA.warehouseId, {
          condition: 'DAMAGED',
          result: 'HOLD',
          hasException: true,
          exceptionDescription: 'Crushed corner, contents visible',
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('EXCEPTION');
    expect(res.body.lastInspection.hasException).toBe(true);
    expect(res.body.lastInspection.exceptionDescription).toBe('Crushed corner, contents visible');
  });

  it('CRITICAL RULE: rejects READY when condition is DAMAGED', async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
    const res = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(processBody(tenantA.warehouseId, { condition: 'DAMAGED', result: 'READY' }));
    expect(res.status).toBe(400);

    const dbItem = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(dbItem.status).toBe('RECEIVED_ORIGIN_WAREHOUSE'); // unchanged — rejected before any write
  });

  it('CRITICAL RULE: rejects READY when hasException is true, regardless of condition', async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
    const res = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(
        processBody(tenantA.warehouseId, {
          condition: 'GOOD',
          result: 'READY',
          hasException: true,
          exceptionDescription: 'Wrong item count in box',
        }),
      );
    expect(res.status).toBe(400);
  });

  it('requires an exception description when hasException is true', async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
    const res = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(processBody(tenantA.warehouseId, { condition: 'GOOD', result: 'HOLD', hasException: true }));
    expect(res.status).toBe(400);
  });

  it('rejects processing at a warehouse other than the item\'s current location', async () => {
    const otherWarehouse = await prisma.warehouse.create({
      data: {
        tenantId: tenantA.tenantId,
        name: 'Second Warehouse',
        code: `E2E-OTHER-${Date.now()}`,
        addressLine1: '2 Test Street',
        city: 'Testville',
        country: 'US',
      },
    });
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
    const res = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(processBody(otherWarehouse.id, { condition: 'GOOD', result: 'READY' }));
    expect(res.status).toBe(409);
  });

  it('duplicate scan protection: rejects reprocessing an already-processed item without reinspection', async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
    await processOnce(app, tokenA, item.id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });

    // Scan resolves to the current state instead of a blank slate.
    const scanRes = await request(app.getHttpServer())
      .get(`/warehouse/scan?code=${encodeURIComponent(item.itemCode)}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.status).toBe('PROCESSED');
    expect(scanRes.body.lastInspection.result).toBe('READY');

    // A second, non-deliberate process call is rejected — no duplicate record.
    const dupRes = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(processBody(tenantA.warehouseId, { condition: 'GOOD', result: 'READY' }));
    expect(dupRes.status).toBe(409);

    const inspections = await prisma.itemInspection.findMany({ where: { shipmentItemId: item.id } });
    expect(inspections).toHaveLength(1);
  });

  it('deliberate reinspection is allowed, auditable, and appends rather than overwrites history', async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
    await processOnce(app, tokenA, item.id, tenantA.warehouseId, {
      condition: 'GOOD',
      result: 'READY',
      notes: 'first pass',
    });

    const reinspectRes = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(
        processBody(tenantA.warehouseId, {
          condition: 'MINOR_DAMAGE',
          result: 'HOLD',
          hasException: true,
          exceptionDescription: 'Found a dent on reinspection',
          notes: 'second pass',
          reinspection: true,
        }),
      );
    expect(reinspectRes.status).toBe(201);
    expect(reinspectRes.body.status).toBe('EXCEPTION');

    const inspections = await prisma.itemInspection.findMany({
      where: { shipmentItemId: item.id },
      orderBy: { inspectedAt: 'asc' },
    });
    expect(inspections).toHaveLength(2);
    expect(inspections[0].result).toBe('READY');
    expect(inspections[0].notes).toBe('first pass'); // first record untouched
    expect(inspections[1].result).toBe('HOLD');
    expect(inspections[1].notes).toBe('second pass');

    const events = await prisma.trackingEvent.findMany({
      where: { shipmentItemId: item.id, eventType: { in: ['PROCESSED', 'EXCEPTION'] } },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('PROCESSED');
    expect(events[1].eventType).toBe('EXCEPTION');
  });

  it('returns a generic 404 for an item code that does not exist', async () => {
    const res = await request(app.getHttpServer())
      .get(`/warehouse/scan?code=${encodeURIComponent(`DOES-NOT-EXIST-${Date.now()}`)}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it("cross-tenant denial: Tenant B cannot scan or process Tenant A's item", async () => {
    const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);

    const scanRes = await request(app.getHttpServer())
      .get(`/warehouse/scan?code=${encodeURIComponent(item.itemCode)}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(scanRes.status).toBe(404);

    const processRes = await request(app.getHttpServer())
      .post(`/warehouse/items/${item.id}/process`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send(processBody(tenantB.warehouseId, { condition: 'GOOD', result: 'READY' }));
    expect(processRes.status).toBe(404);
  });

  describe('RBAC', () => {
    it('allows WAREHOUSE_STAFF and TENANT_ADMIN to process', async () => {
      const staffItem = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
      const staffRes = await request(app.getHttpServer())
        .post(`/warehouse/items/${staffItem.id}/process`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send(processBody(tenantA.warehouseId, { condition: 'GOOD', result: 'READY' }));
      expect(staffRes.status).toBe(201);

      const adminItem = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
      const adminRes = await request(app.getHttpServer())
        .post(`/warehouse/items/${adminItem.id}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(processBody(tenantA.warehouseId, { condition: 'GOOD', result: 'READY' }));
      expect(adminRes.status).toBe(201);
    });

    it('rejects a CUSTOMER user', async () => {
      const item = await createAndOptionallyReceiveItem(app, tokenA, tenantA);
      const res = await request(app.getHttpServer())
        .post(`/warehouse/items/${item.id}/process`)
        .set('Authorization', `Bearer ${customerUserToken}`)
        .send(processBody(tenantA.warehouseId, { condition: 'GOOD', result: 'READY' }));
      expect(res.status).toBe(403);
    });
  });

  describe('shipment-level rollup', () => {
    it('advances to READY_FOR_CONSOLIDATION only once every item is PROCESSED', async () => {
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 2);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await receiveItem(app, tokenA, shipment.items[1].id, tenantA.warehouseId);

      await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });

      let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('PROCESSING'); // one item done, one still outstanding

      await processOnce(app, tokenA, shipment.items[1].id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });

      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('READY_FOR_CONSOLIDATION');
    });

    it('never reaches READY_FOR_CONSOLIDATION while any item is on EXCEPTION/HOLD', async () => {
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 2);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await receiveItem(app, tokenA, shipment.items[1].id, tenantA.warehouseId);

      await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });
      await processOnce(app, tokenA, shipment.items[1].id, tenantA.warehouseId, {
        condition: 'DAMAGED',
        result: 'HOLD',
        hasException: true,
        exceptionDescription: 'Damaged in transit to warehouse',
      });

      const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('PROCESSING');
      expect(dbShipment.status).not.toBe('READY_FOR_CONSOLIDATION');
    });

    it('downgrades READY_FOR_CONSOLIDATION back to PROCESSING when a reinspection puts an item on hold', async () => {
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 2);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await receiveItem(app, tokenA, shipment.items[1].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });
      await processOnce(app, tokenA, shipment.items[1].id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });

      let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('READY_FOR_CONSOLIDATION');

      // Deliberate reinspection finds a problem on one already-processed item.
      const reinspectRes = await request(app.getHttpServer())
        .post(`/warehouse/items/${shipment.items[0].id}/process`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(
          processBody(tenantA.warehouseId, {
            condition: 'DAMAGED',
            result: 'HOLD',
            hasException: true,
            exceptionDescription: 'Found damage on reinspection after consolidation-ready',
            reinspection: true,
          }),
        );
      expect(reinspectRes.status).toBe(201);

      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('PROCESSING');

      const downgradeEvent = await prisma.trackingEvent.findFirst({
        where: { shipmentId: shipment.id, shipmentItemId: null, status: 'PROCESSING', source: 'SYSTEM' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(downgradeEvent).not.toBeNull();
      expect(downgradeEvent?.eventType).toBe('EXCEPTION');
    });

    it('recovers to READY_FOR_CONSOLIDATION once the held item is reinspected back to READY', async () => {
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 2);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await receiveItem(app, tokenA, shipment.items[1].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });
      await processOnce(app, tokenA, shipment.items[1].id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });
      // Downgrade it.
      await request(app.getHttpServer())
        .post(`/warehouse/items/${shipment.items[0].id}/process`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(
          processBody(tenantA.warehouseId, {
            condition: 'DAMAGED',
            result: 'HOLD',
            hasException: true,
            exceptionDescription: 'Temporary hold',
            reinspection: true,
          }),
        );
      let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('PROCESSING');

      // Correct it back to READY.
      const recoverRes = await request(app.getHttpServer())
        .post(`/warehouse/items/${shipment.items[0].id}/process`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(processBody(tenantA.warehouseId, { condition: 'GOOD', result: 'READY', reinspection: true }));
      expect(recoverRes.status).toBe(201);

      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('READY_FOR_CONSOLIDATION');

      // Both the downgrade and the recovery are separate, non-overwritten shipment-level SYSTEM events.
      const rollupEvents = await prisma.trackingEvent.findMany({
        where: {
          shipmentId: shipment.id,
          shipmentItemId: null,
          source: 'SYSTEM',
          status: { in: ['PROCESSING', 'READY_FOR_CONSOLIDATION'] },
        },
        orderBy: { occurredAt: 'asc' },
      });
      const statusSequence = rollupEvents.map((e) => e.status);
      expect(statusSequence).toContain('READY_FOR_CONSOLIDATION');
      expect(statusSequence.filter((s) => s === 'READY_FOR_CONSOLIDATION')).toHaveLength(2); // reached it twice
      expect(statusSequence.filter((s) => s === 'PROCESSING').length).toBeGreaterThanOrEqual(2); // started + downgraded
    });

    it('never touches a shipment that has already progressed past READY_FOR_CONSOLIDATION', async () => {
      const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
      await processOnce(app, tokenA, shipment.items[0].id, tenantA.warehouseId, { condition: 'GOOD', result: 'READY' });

      let dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('READY_FOR_CONSOLIDATION');

      // Simulate the shipment having legitimately progressed further (future Container Loading milestone).
      await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'CONSOLIDATED' } });

      // Reinspect the item into EXCEPTION — must NOT drag an already-consolidated shipment backward.
      const res = await request(app.getHttpServer())
        .post(`/warehouse/items/${shipment.items[0].id}/process`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(
          processBody(tenantA.warehouseId, {
            condition: 'DAMAGED',
            result: 'HOLD',
            hasException: true,
            exceptionDescription: 'Found after consolidation',
            reinspection: true,
          }),
        );
      expect(res.status).toBe(201);

      dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(dbShipment.status).toBe('CONSOLIDATED'); // unchanged — never downgraded
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

function processBody(
  warehouseId: string,
  overrides: Partial<{
    condition: string;
    result: string;
    weight: number;
    weightUnit: string;
    length: number;
    width: number;
    height: number;
    dimensionUnit: string;
    hasException: boolean;
    exceptionDescription: string;
    notes: string;
    scanned: boolean;
    scanIdentifier: string;
    reinspection: boolean;
  }>,
) {
  return {
    warehouseId,
    scanned: false,
    ...overrides,
  };
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
        description: 'E2E process test box',
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

/** Creates a fresh one-item shipment and, unless `receive: false`, receives that item too. */
async function createAndOptionallyReceiveItem(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  opts: { receive?: boolean } = {},
): Promise<{ id: string; itemCode: string }> {
  const shipment = await createSingleShipment(app, token, tenant.customerId, 1);
  const item = shipment.items[0];
  if (opts.receive !== false) {
    await receiveItem(app, token, item.id, tenant.warehouseId);
  }
  return item;
}

async function processOnce(
  app: INestApplication,
  token: string,
  itemId: string,
  warehouseId: string,
  overrides: Partial<{
    condition: string;
    result: string;
    hasException: boolean;
    exceptionDescription: string;
    notes: string;
  }>,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/process`)
    .set('Authorization', `Bearer ${token}`)
    .send(processBody(warehouseId, overrides));
  if (res.status !== 201) {
    throw new Error(`Process failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}
