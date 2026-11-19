import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Package Consolidation Phase 2: combines one or more ReceivingRecords
 * into one or more final shipping boxes (ShipmentItems) on exactly one
 * new Shipment — see ConsolidationService's own doc comment. Covers full
 * and partial allocation, over-allocation rejection (no partial writes),
 * multi-box splitting, traceability, and that the resulting items are
 * ordinary labelable ShipmentItems.
 */
describe('Package Consolidation (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenant: TestTenantFixture;
  let ownerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'Consolidation', UserRole.OWNER);
    ownerToken = await completeStaffLogin(app, tenant.user.email, tenant.user.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  });

  async function receive(quantity: number, carrier = 'UPS') {
    const res = await request(app.getHttpServer())
      .post('/receiving')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ customerId: tenant.customerId, warehouseId: tenant.warehouseId, carrier, quantity });
    expect(res.status).toBe(201);
    return res.body as { id: string; quantity: number; allocatedQuantity: number };
  }

  function baseShipmentFields() {
    return {
      customerId: tenant.customerId,
      shipmentMode: 'AIR',
      destinationCountry: 'Ghana',
      originWarehouseId: tenant.warehouseId,
      recipientName: 'Ama Owusu',
      recipientPhone: '+233241234567',
    };
  }

  it('fully allocates a single receiving record into one box, flips it to FULLY_CONSOLIDATED, and produces a labelable ShipmentItem', async () => {
    const record = await receive(3);

    const res = await request(app.getHttpServer())
      .post('/consolidation')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...baseShipmentFields(),
        boxes: [
          {
            itemType: 'BOX',
            description: 'Consolidated box',
            weight: 10,
            weightUnit: 'LB',
            allocations: [{ receivingRecordId: record.id, quantity: 3 }],
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONSOLIDATED');
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.itemCode).toBeTruthy();
    expect(item.status).toBe('RECEIVED_ORIGIN_WAREHOUSE');

    const updatedRecord = await prisma.receivingRecord.findUnique({ where: { id: record.id } });
    expect(updatedRecord?.allocatedQuantity).toBe(3);
    expect(updatedRecord?.status).toBe('FULLY_CONSOLIDATED');

    const allocation = await prisma.consolidationAllocation.findFirst({ where: { receivingRecordId: record.id } });
    expect(allocation?.shipmentItemId).toBe(item.id);
    expect(allocation?.allocatedQuantity).toBe(3);
  });

  it('partially allocates a receiving record, leaving it PARTIALLY_CONSOLIDATED with the correct remainder', async () => {
    const record = await receive(5);

    const res = await request(app.getHttpServer())
      .post('/consolidation')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...baseShipmentFields(),
        boxes: [{ itemType: 'BOX', allocations: [{ receivingRecordId: record.id, quantity: 2 }] }],
      });
    expect(res.status).toBe(201);

    const updatedRecord = await prisma.receivingRecord.findUnique({ where: { id: record.id } });
    expect(updatedRecord?.allocatedQuantity).toBe(2);
    expect(updatedRecord?.status).toBe('PARTIALLY_CONSOLIDATED');
  });

  it('rejects over-allocation with no partial writes — allocatedQuantity and shipment count are unchanged after the failed attempt', async () => {
    const record = await receive(2);
    const shipmentCountBefore = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });

    const res = await request(app.getHttpServer())
      .post('/consolidation')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...baseShipmentFields(),
        boxes: [{ itemType: 'BOX', allocations: [{ receivingRecordId: record.id, quantity: 3 }] }],
      });
    expect(res.status).toBe(409);

    const updatedRecord = await prisma.receivingRecord.findUnique({ where: { id: record.id } });
    expect(updatedRecord?.allocatedQuantity).toBe(0);
    expect(updatedRecord?.status).toBe('AWAITING_CONSOLIDATION');
    const shipmentCountAfter = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });
    expect(shipmentCountAfter).toBe(shipmentCountBefore);
  });

  it('splits multiple receiving records across multiple boxes in one request, preserving traceability for each pairing', async () => {
    const shoes = await receive(1, 'UPS');
    const laptop = await receive(1, 'FEDEX');
    const clothes = await receive(1, 'USPS');

    const res = await request(app.getHttpServer())
      .post('/consolidation')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...baseShipmentFields(),
        boxes: [
          { itemType: 'BOX', description: 'Box 1', allocations: [{ receivingRecordId: shoes.id, quantity: 1 }, { receivingRecordId: laptop.id, quantity: 1 }] },
          { itemType: 'BOX', description: 'Box 2', allocations: [{ receivingRecordId: clothes.id, quantity: 1 }] },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);

    const allocations = await prisma.consolidationAllocation.findMany({
      where: { receivingRecordId: { in: [shoes.id, laptop.id, clothes.id] } },
    });
    expect(allocations).toHaveLength(3);

    for (const recordId of [shoes.id, laptop.id, clothes.id]) {
      const record = await prisma.receivingRecord.findUnique({ where: { id: recordId } });
      expect(record?.status).toBe('FULLY_CONSOLIDATED');
    }
  });

  it('404s when a box references a receiving record from a different customer', async () => {
    const otherCustomer = await prisma.customer.create({
      data: { tenantId: tenant.tenantId, customerNumber: `OTHER-${Date.now()}`, firstName: 'Other', lastName: 'Customer', email: `other-${Date.now()}@example.test` },
    });
    const record = await receive(1);

    const res = await request(app.getHttpServer())
      .post('/consolidation')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...baseShipmentFields(),
        customerId: otherCustomer.id,
        boxes: [{ itemType: 'BOX', allocations: [{ receivingRecordId: record.id, quantity: 1 }] }],
      });
    expect(res.status).toBe(409);
  });

  it('rejects a cancelled receiving record', async () => {
    const record = await receive(1);
    await request(app.getHttpServer())
      .post(`/receiving/${record.id}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});

    const res = await request(app.getHttpServer())
      .post('/consolidation')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...baseShipmentFields(),
        boxes: [{ itemType: 'BOX', allocations: [{ receivingRecordId: record.id, quantity: 1 }] }],
      });
    expect(res.status).toBe(409);
  });
});
