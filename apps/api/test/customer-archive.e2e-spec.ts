import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Customer Management Phase 3: archive is the default removal option
 * (reversible, preserves every relation); hard delete is only ever safe
 * for a customer with zero operational/financial history. See
 * CustomersService.archive/restore/remove's own doc comments.
 */
describe('Customer Management — archive/restore/delete (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenant: TestTenantFixture;
  let ownerToken: string;
  let staffToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'CustomerArchive', UserRole.OWNER);
    ownerToken = await completeStaffLogin(app, tenant.user.email, tenant.user.password);

    const staff = await createUserInTenant(prisma, tenant.tenantId, 'ArchiveStaff', UserRole.STAFF);
    await prisma.user.update({ where: { id: staff.id }, data: { permissions: ['customers.view', 'customers.manage'] } });
    staffToken = await completeStaffLogin(app, staff.email, staff.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  });

  async function createCustomer() {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ firstName: 'Kwame', lastName: 'Asare', email: `kwame-${Date.now()}-${Math.random()}@example.test` });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('archives and restores a customer, excluding it from the default list and including it under ?archived=true', async () => {
    const customer = await createCustomer();

    const archived = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/archive`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send();
    expect(archived.status).toBe(201);
    expect(archived.body.archivedAt).not.toBeNull();

    const defaultList = await request(app.getHttpServer()).get('/customers').set('Authorization', `Bearer ${ownerToken}`);
    expect(defaultList.body.some((c: { id: string }) => c.id === customer.id)).toBe(false);

    const archivedList = await request(app.getHttpServer())
      .get('/customers')
      .query({ archived: 'true' })
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(archivedList.body.some((c: { id: string }) => c.id === customer.id)).toBe(true);

    const auditEntry = await prisma.tenantAuditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: 'CUSTOMER_ARCHIVED' },
    });
    expect(auditEntry).not.toBeNull();

    const restored = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/restore`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send();
    expect(restored.status).toBe(201);
    expect(restored.body.archivedAt).toBeNull();

    const defaultListAfterRestore = await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(defaultListAfterRestore.body.some((c: { id: string }) => c.id === customer.id)).toBe(true);
  });

  it('a STAFF member (customers.manage but not customers.archive) is forbidden from archiving', async () => {
    const customer = await createCustomer();
    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/archive`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send();
    expect(res.status).toBe(403);
  });

  it('deletes a customer with no operational or financial history', async () => {
    const customer = await createCustomer();
    const res = await request(app.getHttpServer())
      .delete(`/customers/${customer.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);

    const found = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(found).toBeNull();

    const auditEntry = await prisma.tenantAuditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: 'CUSTOMER_DELETED' },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('blocks deletion of a customer with a shipment on file, directing to archive instead', async () => {
    const customer = await createCustomer();
    await prisma.shipment.create({
      data: {
        tenantId: tenant.tenantId,
        customerId: customer.id,
        trackingNumber: `DEL-GUARD-${Date.now()}`,
        shipmentMode: 'AIR',
        originCountry: 'US',
        destinationCountry: 'Ghana',
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/customers/${customer.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(409);

    const stillExists = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(stillExists).not.toBeNull();
  });

  it('blocks deletion of a customer with an active receiving record', async () => {
    const customer = await createCustomer();
    const receiving = await request(app.getHttpServer())
      .post('/receiving')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ customerId: customer.id, warehouseId: tenant.warehouseId, carrier: 'UPS' });
    expect(receiving.status).toBe(201);

    const res = await request(app.getHttpServer())
      .delete(`/customers/${customer.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(409);
  });
});
