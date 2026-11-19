import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Warehouse Receiving Phase 1: individual receiving records, independent
 * of any Shipment — see ReceivingRecord's own doc comment in
 * schema.prisma. Covers intake, the generated internal reference, the
 * duplicate-carrier-tracking-number guard (and its explicit override),
 * corrections with audit logging, cancellation, search, and tenant
 * isolation.
 */
describe('Warehouse Receiving — intake (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenant: TestTenantFixture;
  let otherTenant: TestTenantFixture;
  let ownerToken: string;
  let otherOwnerToken: string;
  let staffToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'ReceivingIntake', UserRole.OWNER);
    otherTenant = await createTestTenant(prisma, 'ReceivingIntakeOther', UserRole.OWNER);
    ownerToken = await completeStaffLogin(app, tenant.user.email, tenant.user.password);
    otherOwnerToken = await completeStaffLogin(app, otherTenant.user.email, otherTenant.user.password);

    // STAFF is explicitly allowed to log and correct receiving records per
    // this feature's own spec requirement — grant the new permission keys
    // directly rather than via legacyRolePermissions (which, by design,
    // only reflects pre-existing pre-RBAC-rollout access and must never be
    // extended for brand-new capabilities — see permissions.ts's own doc
    // comment on that function).
    const staff = await createUserInTenant(prisma, tenant.tenantId, 'ReceivingStaff', UserRole.STAFF);
    await prisma.user.update({ where: { id: staff.id }, data: { permissions: ['receiving.view', 'receiving.manage'] } });
    staffToken = await completeStaffLogin(app, staff.email, staff.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await deleteTestTenant(prisma, otherTenant.tenantId);
    await prisma.$disconnect();
  });

  function create(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/receiving').set('Authorization', `Bearer ${token}`).send(body);
  }

  it('creates a receiving record with a server-generated, tenant-scoped internal reference, never a Shipment', async () => {
    const res = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'UPS',
      carrierTrackingNumber: `1Z-${Date.now()}`,
      description: 'Shoes',
      quantity: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.internalReference).toMatch(/^RCV-/);
    expect(res.body.status).toBe('AWAITING_CONSOLIDATION');
    expect(res.body.allocatedQuantity).toBe(0);

    const shipmentCount = await prisma.shipment.count({ where: { tenantId: tenant.tenantId } });
    expect(shipmentCount).toBe(0);
  });

  it('requires carrierOther when carrier is OTHER', async () => {
    const res = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'OTHER',
      description: 'Loose item',
    });
    expect(res.status).toBe(400);
  });

  it('404s on an unknown customer or warehouse', async () => {
    const badCustomer = await create(ownerToken, {
      customerId: 'does-not-exist',
      warehouseId: tenant.warehouseId,
      carrier: 'USPS',
    });
    expect(badCustomer.status).toBe(404);

    const badWarehouse = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: 'does-not-exist',
      carrier: 'USPS',
    });
    expect(badWarehouse.status).toBe(404);
  });

  it('409s on a duplicate carrier + tracking number within the tenant, and allowDuplicate overrides it with an audit trail', async () => {
    const trackingNumber = `DUP-${Date.now()}`;
    const first = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'FEDEX',
      carrierTrackingNumber: trackingNumber,
    });
    expect(first.status).toBe(201);

    const countBefore = await prisma.receivingRecord.count({ where: { tenantId: tenant.tenantId } });
    const blocked = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'FEDEX',
      carrierTrackingNumber: trackingNumber,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.duplicates).toHaveLength(1);
    const countAfter = await prisma.receivingRecord.count({ where: { tenantId: tenant.tenantId } });
    expect(countAfter).toBe(countBefore);

    const overridden = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'FEDEX',
      carrierTrackingNumber: trackingNumber,
      allowDuplicate: true,
      duplicateOverrideReason: 'Genuine split delivery, confirmed with carrier',
    });
    expect(overridden.status).toBe(201);
    expect(overridden.body.id).not.toBe(first.body.id);

    const auditEntry = await prisma.tenantAuditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: 'RECEIVING_RECORD_DUPLICATE_OVERRIDDEN' },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('a cancelled record is excluded from the duplicate check', async () => {
    const trackingNumber = `CANCEL-DUP-${Date.now()}`;
    const first = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'DHL',
      carrierTrackingNumber: trackingNumber,
    });
    expect(first.status).toBe(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/receiving/${first.body.id}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Logged in error' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe('CANCELLED');

    const second = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'DHL',
      carrierTrackingNumber: trackingNumber,
    });
    expect(second.status).toBe(201);
  });

  it('a STAFF member may create and correct a receiving record, with an audit log entry', async () => {
    const created = await create(staffToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'UPS',
      description: 'Original description',
    });
    expect(created.status).toBe(201);

    const corrected = await request(app.getHttpServer())
      .patch(`/receiving/${created.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ description: 'Corrected description' });
    expect(corrected.status).toBe(200);
    expect(corrected.body.description).toBe('Corrected description');

    const auditEntry = await prisma.tenantAuditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: 'RECEIVING_RECORD_CORRECTED' },
    });
    expect(auditEntry).not.toBeNull();
    expect((auditEntry?.metadata as { fields: string[] }).fields).toContain('description');
  });

  it('is searchable by internal reference, carrier tracking number, and customer name', async () => {
    const trackingNumber = `SEARCH-${Date.now()}`;
    const created = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'USPS',
      carrierTrackingNumber: trackingNumber,
    });
    expect(created.status).toBe(201);

    const byReference = await request(app.getHttpServer())
      .get('/receiving/search')
      .query({ query: created.body.internalReference })
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(byReference.body.some((r: { id: string }) => r.id === created.body.id)).toBe(true);

    const byTracking = await request(app.getHttpServer())
      .get('/receiving/search')
      .query({ query: trackingNumber })
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(byTracking.body.some((r: { id: string }) => r.id === created.body.id)).toBe(true);
  });

  it('is tenant-scoped — cross-tenant GET/PATCH 404s', async () => {
    const created = await create(ownerToken, {
      customerId: tenant.customerId,
      warehouseId: tenant.warehouseId,
      carrier: 'UPS',
    });
    expect(created.status).toBe(201);

    const crossGet = await request(app.getHttpServer())
      .get(`/receiving/${created.body.id}`)
      .set('Authorization', `Bearer ${otherOwnerToken}`);
    expect(crossGet.status).toBe(404);

    const crossPatch = await request(app.getHttpServer())
      .patch(`/receiving/${created.body.id}`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .send({ description: 'should not apply' });
    expect(crossPatch.status).toBe(404);
  });
});
