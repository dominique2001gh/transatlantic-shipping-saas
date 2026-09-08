import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * 2026-09 production pilot fix: WAREHOUSE_STAFF must be able to register a
 * customer and create a shipment (with items) as part of warehouse intake
 * — this used to 403 on customer creation only (CustomersController's
 * MANAGE_ROLES omitted WAREHOUSE_STAFF while ShipmentsController's
 * OPERATIONS_ROLES already included it). See both controllers' own
 * MANAGE_ROLES/OPERATIONS_ROLES doc comments for the full history.
 *
 * Deliberately a small, standalone spec (matching this suite's existing
 * per-file-fixture convention) rather than folding into a broader
 * customers/shipments spec that doesn't yet exist — keeps this fix's test
 * coverage isolated and easy to review on its own.
 */
describe('Warehouse intake RBAC: WAREHOUSE_STAFF can register customers and create shipments (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tenant: TestTenantFixture;
  let warehouseStaffToken: string;
  let driverToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'Intake', UserRole.TENANT_OWNER);

    const warehouseStaff = await createUserInTenant(prisma, tenant.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);
    warehouseStaffToken = await login(app, warehouseStaff.email, warehouseStaff.password);

    // Negative control: DRIVER is excluded from both MANAGE_ROLES and
    // OPERATIONS_ROLES — proves this fix widened access to WAREHOUSE_STAFF
    // specifically, not to every staff role.
    const driver = await createUserInTenant(prisma, tenant.tenantId, 'Driver', UserRole.DRIVER);
    driverToken = await login(app, driver.email, driver.password);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  it('WAREHOUSE_STAFF can create a customer', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${warehouseStaffToken}`)
      .send({ firstName: 'Intake', lastName: 'Customer', email: `intake-${Date.now()}@example.test` });
    expect(res.status).toBe(201);
    expect(res.body.firstName).toBe('Intake');
  });

  it('WAREHOUSE_STAFF can create a shipment with a nested item', async () => {
    const res = await request(app.getHttpServer())
      .post('/shipments')
      .set('Authorization', `Bearer ${warehouseStaffToken}`)
      .send({
        customerId: tenant.customerId,
        shipmentMode: 'OCEAN_LCL',
        originCountry: 'US',
        destinationCountry: 'GH',
        items: [{ itemType: 'BOX', quantity: 1 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.itemCounts?.total ?? res.body.items?.length).toBe(1);
  });

  it('WAREHOUSE_STAFF can add an item to an existing shipment', async () => {
    const shipmentRes = await request(app.getHttpServer())
      .post('/shipments')
      .set('Authorization', `Bearer ${warehouseStaffToken}`)
      .send({ customerId: tenant.customerId, shipmentMode: 'AIR', originCountry: 'US', destinationCountry: 'GH' });
    expect(shipmentRes.status).toBe(201);

    const itemRes = await request(app.getHttpServer())
      .post(`/shipments/${shipmentRes.body.id}/items`)
      .set('Authorization', `Bearer ${warehouseStaffToken}`)
      .send({ itemType: 'BARREL', quantity: 1 });
    expect(itemRes.status).toBe(201);
  });

  it('DRIVER still gets 403 on customer and shipment creation — the fix did not widen access beyond WAREHOUSE_STAFF', async () => {
    const customerRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ firstName: 'Should', lastName: 'Fail', email: `should-fail-${Date.now()}@example.test` });
    expect(customerRes.status).toBe(403);

    const shipmentRes = await request(app.getHttpServer())
      .post('/shipments')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ customerId: tenant.customerId, shipmentMode: 'AIR', originCountry: 'US', destinationCountry: 'GH' });
    expect(shipmentRes.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention.
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
