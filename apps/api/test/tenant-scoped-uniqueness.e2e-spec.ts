import { PrismaClient, ShipmentItemType, ShipmentMode } from '@prisma/client';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';

/**
 * Proves the exact SaaS-uniqueness contract from the multi-tenant
 * migration at the database layer:
 *   - Tenant A may have tracking number X.
 *   - Tenant B may independently have the same tracking number X.
 *   - Tenant A may have item code Y.
 *   - Tenant B may independently have the same item code Y.
 *   - Duplicate tracking numbers/item codes within the SAME tenant are
 *     still rejected.
 *
 * These are `@@unique([tenantId, trackingNumber])` /
 * `@@unique([tenantId, itemCode])` constraints (schema.prisma) — this
 * spec exercises them directly via Prisma so a regression here fails at
 * the schema/constraint level, independent of any service/controller
 * code above it.
 */
describe('Tenant-scoped uniqueness: trackingNumber and itemCode', () => {
  const prisma = new PrismaClient();
  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;

  const sharedTrackingNumber = `SHARED-TN-${Date.now()}`;
  const sharedItemCode = `${sharedTrackingNumber}-01`;

  beforeAll(async () => {
    tenantA = await createTestTenant(prisma, 'UniqA');
    tenantB = await createTestTenant(prisma, 'UniqB');
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  it('lets Tenant A create a shipment with tracking number X', async () => {
    const shipment = await prisma.shipment.create({
      data: {
        tenantId: tenantA.tenantId,
        customerId: tenantA.customerId,
        trackingNumber: sharedTrackingNumber,
        shipmentMode: ShipmentMode.OCEAN_LCL,
        originCountry: 'US',
        destinationCountry: 'GH',
      },
    });
    expect(shipment.trackingNumber).toBe(sharedTrackingNumber);
  });

  it('rejects a duplicate tracking number within the SAME tenant', async () => {
    await expect(
      prisma.shipment.create({
        data: {
          tenantId: tenantA.tenantId,
          customerId: tenantA.customerId,
          trackingNumber: sharedTrackingNumber,
          shipmentMode: ShipmentMode.OCEAN_LCL,
          originCountry: 'US',
          destinationCountry: 'GH',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lets Tenant B independently use the SAME tracking number X', async () => {
    const shipment = await prisma.shipment.create({
      data: {
        tenantId: tenantB.tenantId,
        customerId: tenantB.customerId,
        trackingNumber: sharedTrackingNumber,
        shipmentMode: ShipmentMode.OCEAN_LCL,
        originCountry: 'US',
        destinationCountry: 'GH',
      },
    });
    expect(shipment.trackingNumber).toBe(sharedTrackingNumber);
  });

  it('lets Tenant A create an item with item code Y', async () => {
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { tenantId: tenantA.tenantId, trackingNumber: sharedTrackingNumber },
    });
    const item = await prisma.shipmentItem.create({
      data: {
        tenantId: tenantA.tenantId,
        shipmentId: shipment.id,
        itemCode: sharedItemCode,
        sequenceNumber: 1,
        itemType: ShipmentItemType.BOX,
      },
    });
    expect(item.itemCode).toBe(sharedItemCode);
  });

  it('rejects a duplicate item code within the SAME tenant', async () => {
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { tenantId: tenantA.tenantId, trackingNumber: sharedTrackingNumber },
    });
    await expect(
      prisma.shipmentItem.create({
        data: {
          tenantId: tenantA.tenantId,
          shipmentId: shipment.id,
          // Different sequenceNumber, same itemCode — proves itemCode
          // itself is the enforced column, not [shipmentId, sequenceNumber].
          itemCode: sharedItemCode,
          sequenceNumber: 2,
          itemType: ShipmentItemType.BOX,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lets Tenant B independently use the SAME item code Y', async () => {
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { tenantId: tenantB.tenantId, trackingNumber: sharedTrackingNumber },
    });
    const item = await prisma.shipmentItem.create({
      data: {
        tenantId: tenantB.tenantId,
        shipmentId: shipment.id,
        itemCode: sharedItemCode,
        sequenceNumber: 1,
        itemType: ShipmentItemType.BOX,
      },
    });
    expect(item.itemCode).toBe(sharedItemCode);
  });
});
