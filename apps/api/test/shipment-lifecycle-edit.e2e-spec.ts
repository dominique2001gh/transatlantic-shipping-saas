import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Shipment Editing Phase 4: lifecycle-tier-gated edits — see
 * ShipmentsService.resolveEditTier's own doc comment for the full table.
 * Shipments are created directly via Prisma at whatever status each test
 * needs, rather than walked through the real container/manifest
 * lifecycle — this isolates the PATCH endpoint's gating logic from
 * unrelated lifecycle mechanics, matching this test suite's existing
 * convention (see analytics.e2e-spec.ts's identical direct-Prisma setup).
 */
describe('Shipment Editing — lifecycle tiers (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenant: TestTenantFixture;
  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'ShipmentEdit', UserRole.OWNER);
    ownerToken = await completeStaffLogin(app, tenant.user.email, tenant.user.password);

    const manager = await createUserInTenant(prisma, tenant.tenantId, 'EditManager', UserRole.MANAGER);
    await prisma.user.update({ where: { id: manager.id }, data: { permissions: ['shipments.view', 'shipments.edit'] } });
    managerToken = await completeStaffLogin(app, manager.email, manager.password);

    const staff = await createUserInTenant(prisma, tenant.tenantId, 'EditStaff', UserRole.STAFF);
    await prisma.user.update({ where: { id: staff.id }, data: { permissions: ['shipments.view', 'shipments.manage'] } });
    staffToken = await completeStaffLogin(app, staff.email, staff.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  });

  async function createShipment(status: string, overrides: Record<string, unknown> = {}) {
    return prisma.shipment.create({
      data: {
        tenantId: tenant.tenantId,
        customerId: tenant.customerId,
        trackingNumber: `EDIT-${status}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        shipmentMode: 'AIR',
        originCountry: 'US',
        destinationCountry: 'Ghana',
        status: status as never,
        recipientName: 'Original Recipient',
        recipientPhone: '+10000000000',
        ...overrides,
      },
    });
  }

  function patchShipment(token: string, id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).patch(`/shipments/${id}`).set('Authorization', `Bearer ${token}`).send(body);
  }

  it('DRAFT: a broad edit (including recipient fields) succeeds for MANAGER and is audited', async () => {
    const shipment = await createShipment('DRAFT');
    const res = await patchShipment(managerToken, shipment.id, {
      description: 'Updated description',
      recipientName: 'New Recipient',
    });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated description');
    expect(res.body.recipientName).toBe('New Recipient');

    const auditEntry = await prisma.tenantAuditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: 'SHIPMENT_UPDATED', metadata: { path: ['shipmentId'], equals: shipment.id } },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('a STAFF member (shipments.manage but not shipments.edit) is forbidden from editing any shipment', async () => {
    const shipment = await createShipment('DRAFT');
    const res = await patchShipment(staffToken, shipment.id, { description: 'nope' });
    expect(res.status).toBe(403);
  });

  it('BOOKED: a label-affecting field change is rejected without confirmLabelRegeneration, and accepted with it', async () => {
    const shipment = await createShipment('BOOKED');

    const rejected = await patchShipment(managerToken, shipment.id, { recipientName: 'Changed Name' });
    expect(rejected.status).toBe(409);

    const unchanged = await prisma.shipment.findUnique({ where: { id: shipment.id } });
    expect(unchanged?.recipientName).toBe('Original Recipient');

    const confirmed = await patchShipment(managerToken, shipment.id, {
      recipientName: 'Changed Name',
      confirmLabelRegeneration: true,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.recipientName).toBe('Changed Name');
  });

  it('BOOKED: a non-label-affecting field (description) does not require confirmLabelRegeneration', async () => {
    const shipment = await createShipment('BOOKED');
    const res = await patchShipment(managerToken, shipment.id, { description: 'Just a note' });
    expect(res.status).toBe(200);
  });

  it('LOADED: requires OWNER specifically — MANAGER is forbidden even with shipments.edit', async () => {
    const shipment = await createShipment('LOADED');

    const managerAttempt = await patchShipment(managerToken, shipment.id, { description: 'Manager correction' });
    expect(managerAttempt.status).toBe(403);

    const ownerAttempt = await patchShipment(ownerToken, shipment.id, { description: 'Owner correction' });
    expect(ownerAttempt.status).toBe(200);
  });

  it('LOADED: recipient fields are rejected even for OWNER — only description/declaredValue/currency are editable', async () => {
    const shipment = await createShipment('LOADED');
    const res = await patchShipment(ownerToken, shipment.id, { recipientName: 'Should not be allowed' });
    expect(res.status).toBe(400);
  });

  it('DEPARTED: only description is editable, OWNER only', async () => {
    const shipment = await createShipment('DEPARTED');

    const weightAttempt = await patchShipment(ownerToken, shipment.id, { declaredValue: 500 });
    expect(weightAttempt.status).toBe(400);

    const descriptionAttempt = await patchShipment(ownerToken, shipment.id, { description: 'In-transit correction' });
    expect(descriptionAttempt.status).toBe(200);
  });

  it('DELIVERED: requires a non-empty reason', async () => {
    const shipment = await createShipment('DELIVERED');

    const noReason = await patchShipment(ownerToken, shipment.id, { description: 'Correction' });
    expect(noReason.status).toBe(400);

    const withReason = await patchShipment(ownerToken, shipment.id, {
      description: 'Correction',
      reason: 'Customer reported a typo in the delivery notes',
    });
    expect(withReason.status).toBe(200);

    const auditEntry = await prisma.tenantAuditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: 'SHIPMENT_UPDATED', metadata: { path: ['shipmentId'], equals: shipment.id } },
      orderBy: { createdAt: 'desc' },
    });
    expect((auditEntry?.metadata as { reason: string }).reason).toContain('typo');
  });

  it('declaredValue is locked once a non-draft invoice exists for the shipment, even in the DRAFT tier', async () => {
    const shipment = await createShipment('DRAFT');
    await prisma.invoice.create({
      data: {
        tenantId: tenant.tenantId,
        customerId: tenant.customerId,
        shipmentId: shipment.id,
        invoiceNumber: `INV-LOCK-${Date.now()}`,
        status: 'SENT',
        currency: 'USD',
      },
    });

    const res = await patchShipment(ownerToken, shipment.id, { declaredValue: 250 });
    expect(res.status).toBe(409);
  });

  it('is tenant-scoped — a cross-tenant PATCH 404s', async () => {
    const otherTenant = await createTestTenant(prisma, 'ShipmentEditOther', UserRole.OWNER);
    const otherOwnerToken = await completeStaffLogin(app, otherTenant.user.email, otherTenant.user.password);
    const shipment = await createShipment('DRAFT');

    const res = await patchShipment(otherOwnerToken, shipment.id, { description: 'should not apply' });
    expect(res.status).toBe(404);

    await deleteTestTenant(prisma, otherTenant.tenantId);
  });
});
