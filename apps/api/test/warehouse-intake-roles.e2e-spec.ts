import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * RBAC V1 (2026-09): STAFF must be able to register a customer and create
 * a shipment (with items) as part of warehouse intake — both are
 * OPERATIONS_ROLES (OWNER/MANAGER/STAFF). FINANCE is the negative control
 * here: its V1 scope is a closed list (customers view, invoices, payments,
 * financial reporting) that does not include creating customer profiles or
 * shipments — see CustomersController/ShipmentsController's own doc
 * comments.
 *
 * Deliberately a small, standalone spec (matching this suite's existing
 * per-file-fixture convention) rather than folding into a broader
 * customers/shipments spec that doesn't yet exist — keeps this fix's test
 * coverage isolated and easy to review on its own.
 */
describe('Warehouse intake RBAC: STAFF can register customers and create shipments (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tenant: TestTenantFixture;
  let staffToken: string;
  let financeToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'Intake', UserRole.OWNER);

    const staff = await createUserInTenant(prisma, tenant.tenantId, 'Staff', UserRole.STAFF);
    staffToken = await login(app, staff.email, staff.password);

    // Negative control: FINANCE is excluded from both MANAGE_ROLES and
    // OPERATIONS_ROLES — proves this is scoped to STAFF (and MANAGER/
    // OWNER) specifically, not to every dashboard role.
    const finance = await createUserInTenant(prisma, tenant.tenantId, 'Finance', UserRole.FINANCE);
    financeToken = await login(app, finance.email, finance.password);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  it('STAFF can create a customer', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ firstName: 'Intake', lastName: 'Customer', email: `intake-${Date.now()}@example.test` });
    expect(res.status).toBe(201);
    expect(res.body.firstName).toBe('Intake');
  });

  it('STAFF can create a shipment with a nested item', async () => {
    const res = await request(app.getHttpServer())
      .post('/shipments')
      .set('Authorization', `Bearer ${staffToken}`)
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

  it('STAFF can add an item to an existing shipment', async () => {
    const shipmentRes = await request(app.getHttpServer())
      .post('/shipments')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ customerId: tenant.customerId, shipmentMode: 'AIR', originCountry: 'US', destinationCountry: 'GH' });
    expect(shipmentRes.status).toBe(201);

    const itemRes = await request(app.getHttpServer())
      .post(`/shipments/${shipmentRes.body.id}/items`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ itemType: 'BARREL', quantity: 1 });
    expect(itemRes.status).toBe(201);
  });

  it('FINANCE gets 403 on customer and shipment creation — its V1 scope is view-only for customers and has no shipment access at all', async () => {
    const customerRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ firstName: 'Should', lastName: 'Fail', email: `should-fail-${Date.now()}@example.test` });
    expect(customerRes.status).toBe(403);

    const shipmentRes = await request(app.getHttpServer())
      .post('/shipments')
      .set('Authorization', `Bearer ${financeToken}`)
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
