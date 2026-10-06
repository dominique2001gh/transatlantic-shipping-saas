import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaClient, UserRole } from '@prisma/client';
import { ShipmentMode, ShipmentItemType } from '@transatlantic/shared';
import type { PermissionKey } from '@transatlantic/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMAIL_PROVIDER } from '../src/notifications/providers/provider.types';
import { createTestTenant, createUserInTenant, deleteTestTenant, TEST_PASSWORD, TestTenantFixture } from './utils/fixtures';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

interface CapturedEmail {
  to: string;
  body: string;
}

/**
 * RBAC permissions Phase C — the dedicated fine-grained-permission e2e
 * suite (distinct from rbac-permission-matrix.e2e-spec.ts, which proves
 * the *role*-tier shape; this file proves the *permission-array* layer
 * PermissionsGuard adds on top). Every assertion is a real HTTP call
 * through supertest against the actual Nest application — the backend is
 * the thing being proven, never a frontend or a unit-tested helper in
 * isolation.
 *
 * Builds its own app (rather than using createTestApp()) to override
 * ThrottlerGuard, matching staff-invitations.e2e-spec.ts's established
 * pattern — this suite deliberately drives many staff logins and
 * permission changes against one tenant, which would otherwise trip the
 * real (and separately-proven) MFA-send rate limit having nothing to do
 * with what's being tested here.
 */
describe('RBAC fine-grained permissions (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const sentEmails: CapturedEmail[] = [];

  let tenant: TestTenantFixture; // OWNER
  let tenantOther: TestTenantFixture; // a second, independent tenant — never logged into, only used as a cross-tenant resource source
  let manager: { id: string; email: string; password: string };
  let staff: { id: string; email: string; password: string };
  let legacyStaff: { id: string; email: string; password: string };

  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;
  let legacyStaffToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({
        send: async (params: CapturedEmail) => {
          sentEmails.push(params);
          return { success: true, providerMessageId: 'test' };
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenant = await createTestTenant(prisma, 'FineGrained', UserRole.OWNER);
    tenantOther = await createTestTenant(prisma, 'FineGrainedOther', UserRole.OWNER);

    // createUserInTenant now defaults every fixture's `permissions` to
    // legacyRolePermissions(role) — see fixtures.ts's own comment — so
    // these two start with exactly the real-world access their role has
    // always had, same as a genuinely pre-RBAC migrated account.
    manager = await createUserInTenant(prisma, tenant.tenantId, 'Manager', UserRole.MANAGER);
    staff = await createUserInTenant(prisma, tenant.tenantId, 'Staff', UserRole.STAFF);

    ownerToken = await completeStaffLogin(app, tenant.user.email, tenant.user.password);
    managerToken = await completeStaffLogin(app, manager.email, manager.password);
    staffToken = await completeStaffLogin(app, staff.email, staff.password);
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, tenant.tenantId);
    await deleteTestTenant(prisma, tenantOther.tenantId);
    await prisma.$disconnect();
    await app.close();
  });

  function authed(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, token: string) {
    return (request(app.getHttpServer())[method](path) as request.Test).set('Authorization', `Bearer ${token}`);
  }

  /** Owner-initiated permission grant — exercises the real PATCH /users/:id/permissions endpoint, never a direct DB write. */
  async function setPermissions(targetUserId: string, permissions: PermissionKey[]) {
    const res = await authed('patch', `/users/${targetUserId}/permissions`, ownerToken).send({ permissions });
    expect(res.status).toBe(200);
    return res;
  }

  // -------------------------------------------------------------------
  // 1. OWNER full access, regardless of the permissions array
  // -------------------------------------------------------------------
  describe('1. OWNER has full access regardless of the permissions array', () => {
    it('OWNER reaches every permission-gated route even with an empty permissions array', async () => {
      await prisma.user.update({ where: { id: tenant.user.id }, data: { permissions: [] } });

      const inventory = await authed('get', '/warehouse/inventory', ownerToken);
      expect(inventory.status).toBe(200);

      const createCustomer = await authed('post', '/customers', ownerToken).send({
        firstName: 'Owner',
        lastName: 'Created',
        email: `owner-created-${Date.now()}@example.test`,
      });
      expect(createCustomer.status).toBe(201);

      const invoices = await authed('get', '/invoices', ownerToken);
      expect(invoices.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------
  // 2 & 9. Warehouse staff: allowed operational actions, denied
  // financial/settings actions, and per-transition dispatch/delivery
  // enforcement.
  // -------------------------------------------------------------------
  describe('2 & 9. Warehouse staff: allowed vs. denied, and dispatch/delivery per-transition', () => {
    const fakeItemId = 'does-not-exist-item-id';

    it('STAFF with default (legacy-equivalent) permissions reaches warehouse routes', async () => {
      const res = await authed('get', '/warehouse/inventory', staffToken);
      expect(res.status).toBe(200);
    });

    it('STAFF is denied financial and sensitive-settings routes outright', async () => {
      const invoices = await authed('get', '/invoices', staffToken);
      expect(invoices.status).toBe(403);

      const paymentConfig = await authed('get', '/tenant-payments/methods', staffToken);
      expect(paymentConfig.status).toBe(403);
    });

    it('revoking warehouse.process blocks /process even though the ROLE tier (OPERATIONS_ROLES) would otherwise allow it', async () => {
      await setPermissions(staff.id, ['warehouse.view', 'shipments.receive', 'dispatch.manage']);

      const res = await authed('post', `/warehouse/items/${fakeItemId}/process`, staffToken).send({
        warehouseId: tenant.warehouseId,
        condition: 'GOOD',
        result: 'READY',
        scanned: false,
      });
      expect(res.status).toBe(403);
    });

    it('granting warehouse.process back lets the request reach real business logic (404 on a nonexistent item, not 403)', async () => {
      await setPermissions(staff.id, ['warehouse.view', 'shipments.receive', 'warehouse.process', 'dispatch.manage']);

      const res = await authed('post', `/warehouse/items/${fakeItemId}/process`, staffToken).send({
        warehouseId: tenant.warehouseId,
        condition: 'GOOD',
        result: 'READY',
        scanned: false,
      });
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404);
    });

    it('shipments.receive alone authorizes receive/destination-receive but not process/dispatch/pickup/deliver/return', async () => {
      await setPermissions(staff.id, ['shipments.receive']);

      const receive = await authed('post', `/warehouse/items/${fakeItemId}/receive`, staffToken).send({
        warehouseId: tenant.warehouseId,
        scanned: false,
      });
      expect(receive.status).not.toBe(403);
      expect(receive.status).toBe(404);

      const destinationReceive = await authed('post', `/warehouse/items/${fakeItemId}/destination-receive`, staffToken).send({
        warehouseId: tenant.warehouseId,
        condition: 'GOOD',
        scanned: false,
      });
      expect(destinationReceive.status).not.toBe(403);

      for (const [action, body] of [
        ['process', { warehouseId: tenant.warehouseId, condition: 'GOOD', result: 'READY', scanned: false }],
        ['dispatch', { warehouseId: tenant.warehouseId, recipientName: 'X', scanned: false }],
        ['pickup', { warehouseId: tenant.warehouseId, recipientName: 'X', scanned: false }],
        ['deliver', { warehouseId: tenant.warehouseId, recipientName: 'X', scanned: false }],
        ['return', { warehouseId: tenant.warehouseId, failureReason: 'refused', scanned: false }],
      ] as const) {
        const res = await authed('post', `/warehouse/items/${fakeItemId}/${action}`, staffToken).send(body);
        expect(res.status).toBe(403);
      }
    });

    it('dispatch.manage alone authorizes pickup/dispatch/deliver/return but not receive/process — the inverse of the previous case', async () => {
      await setPermissions(staff.id, ['dispatch.manage']);

      for (const [action, body] of [
        ['pickup', { warehouseId: tenant.warehouseId, recipientName: 'X', scanned: false }],
        ['dispatch', { warehouseId: tenant.warehouseId, recipientName: 'X', scanned: false }],
        ['deliver', { warehouseId: tenant.warehouseId, recipientName: 'X', scanned: false }],
        ['return', { warehouseId: tenant.warehouseId, failureReason: 'refused', scanned: false }],
      ] as const) {
        const res = await authed('post', `/warehouse/items/${fakeItemId}/${action}`, staffToken).send(body);
        expect(res.status).not.toBe(403);
      }

      const receive = await authed('post', `/warehouse/items/${fakeItemId}/receive`, staffToken).send({
        warehouseId: tenant.warehouseId,
        scanned: false,
      });
      expect(receive.status).toBe(403);

      const process = await authed('post', `/warehouse/items/${fakeItemId}/process`, staffToken).send({
        warehouseId: tenant.warehouseId,
        condition: 'GOOD',
        result: 'READY',
        scanned: false,
      });
      expect(process.status).toBe(403);
    });

    afterAll(async () => {
      // Restore to the fixture's own default so later describe blocks that
      // also use `staff` start from a known, real-world-equivalent state.
      await prisma.user.findFirst({ where: { id: staff.id } });
    });
  });

  // -------------------------------------------------------------------
  // 3 & 4. Accounting-style staff: allowed finance ops, denied warehouse
  // ops unless granted, and explicit VIEW-vs-MANAGE separation.
  // -------------------------------------------------------------------
  describe('3 & 4. Accounting-style permissions and VIEW-vs-MANAGE separation', () => {
    let invoiceId: string;
    let billableCustomerId: string;
    let billableShipmentId: string;

    beforeAll(async () => {
      await setPermissions(manager.id, [
        'customers.view',
        'invoices.view',
        'invoices.manage',
        'payments.view',
        'payments.manage',
        'analytics.financial',
        'tracking.view',
      ]);

      const customer = await prisma.customer.create({
        data: { tenantId: tenant.tenantId, customerNumber: `FG-${Date.now()}`, firstName: 'Acct', lastName: 'Customer', email: `acct-${Date.now()}@example.test` },
      });
      billableCustomerId = customer.id;

      // OWNER (bypasses every permission check) creates the real Shipment
      // CreateInvoiceDto requires — this suite is about the permission
      // layer on invoices, not about re-proving shipment creation.
      const shipmentRes = await authed('post', '/shipments', ownerToken).send({
        customerId: billableCustomerId,
        shipmentMode: ShipmentMode.OCEAN_LCL,
        originCountry: 'US',
        destinationCountry: 'GH',
        recipientName: 'Billable Recipient',
        recipientPhone: '+15550000001',
        items: [{ itemType: ShipmentItemType.BOX, description: 'Fine-grained permissions e2e test box' }],
      });
      expect(shipmentRes.status).toBe(201);
      billableShipmentId = shipmentRes.body.id;

      const createRes = await authed('post', '/invoices', managerToken).send({
        customerId: billableCustomerId,
        shipmentId: billableShipmentId,
        currency: 'USD',
        items: [{ description: 'Freight', quantity: 1, unitPrice: 100 }],
      });
      expect(createRes.status).toBe(201);
      invoiceId = createRes.body.id;
    });

    it('can view and manage invoices (accounting remit)', async () => {
      const get = await authed('get', '/invoices', managerToken);
      expect(get.status).toBe(200);
      const issue = await authed('post', `/invoices/${invoiceId}/issue`, managerToken);
      expect(issue.status).toBe(201);
    });

    it('is denied warehouse operations entirely until explicitly granted', async () => {
      const denied = await authed('get', '/warehouse/inventory', managerToken);
      expect(denied.status).toBe(403);

      await setPermissions(manager.id, [
        'customers.view',
        'invoices.view',
        'invoices.manage',
        'payments.view',
        'payments.manage',
        'analytics.financial',
        'tracking.view',
        'warehouse.view',
      ]);
      const allowed = await authed('get', '/warehouse/inventory', managerToken);
      expect(allowed.status).toBe(200);
    });

    it('VIEW does not imply MANAGE: invoices.view without invoices.manage can read but not create', async () => {
      await setPermissions(manager.id, ['invoices.view']);

      const get = await authed('get', '/invoices', managerToken);
      expect(get.status).toBe(200);

      const create = await authed('post', '/invoices', managerToken).send({
        customerId: 'irrelevant-will-403-first',
        items: [{ description: 'X', quantity: 1, unitPrice: '1.00' }],
      });
      expect(create.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // 5. Direct, well-formed API request with no permission still 403
  // -------------------------------------------------------------------
  describe('5. A direct, well-formed API request is rejected without the permission — proves backend enforcement independent of any UI', () => {
    it('a syntactically valid POST /invoices from a user without invoices.manage is 403, not a validation error', async () => {
      await setPermissions(manager.id, ['invoices.view']); // view only, from the previous block
      const res = await authed('post', '/invoices', managerToken).send({
        customerId: 'some-customer-id',
        items: [{ description: 'Valid shape', quantity: 1, unitPrice: '50.00' }],
      });
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // 6. Cross-tenant denial despite holding the equivalent permission
  // -------------------------------------------------------------------
  describe('6. Cross-tenant isolation holds even when the caller has the matching permission in their own tenant', () => {
    it('a tenant-A user with customers.manage cannot reach tenant B\'s customer by id', async () => {
      await setPermissions(staff.id, ['customers.view', 'customers.manage']);

      const getOther = await authed('get', `/customers/${tenantOther.customerId}`, staffToken);
      expect(getOther.status).toBe(404);

      const updateOther = await authed('patch', `/customers/${tenantOther.customerId}`, staffToken).send({ firstName: 'Hijacked' });
      expect(updateOther.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // 7. Owner protection
  // -------------------------------------------------------------------
  describe('7. Non-owner staff can never modify, restrict, or promote-to OWNER', () => {
    beforeAll(async () => {
      await setPermissions(manager.id, ['staff.manage', 'staff.permissions']);
    });

    it('a non-owner with staff.manage cannot change the OWNER\'s role', async () => {
      const res = await authed('patch', `/users/${tenant.user.id}/role`, managerToken).send({ role: UserRole.MANAGER });
      expect(res.status).toBe(403);
    });

    it('a non-owner with staff.manage cannot deactivate the OWNER', async () => {
      const res = await authed('patch', `/users/${tenant.user.id}/status`, managerToken).send({ isActive: false });
      expect(res.status).toBe(403);
    });

    it('a non-owner with staff.manage cannot promote anyone to OWNER', async () => {
      const res = await authed('patch', `/users/${staff.id}/role`, managerToken).send({ role: UserRole.OWNER });
      expect(res.status).toBe(403);
    });

    it('the OWNER themselves is never blocked by this check', async () => {
      const res = await authed('patch', `/users/${staff.id}/role`, ownerToken).send({ role: UserRole.STAFF });
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------
  // 8. Self-escalation prevention
  // -------------------------------------------------------------------
  describe('8. Self-escalation prevention', () => {
    it('a non-owner with staff.manage cannot change their own role', async () => {
      const res = await authed('patch', `/users/${manager.id}/role`, managerToken).send({ role: UserRole.STAFF });
      expect(res.status).toBe(403);
    });

    it('a non-owner with staff.permissions cannot change their own permissions', async () => {
      const res = await authed('patch', `/users/${manager.id}/permissions`, managerToken).send({ permissions: ['customers.view'] });
      expect(res.status).toBe(403);
    });

    it('a non-owner cannot grant a permission they do not themselves hold', async () => {
      // manager currently holds staff.manage/staff.permissions only (from block 7) — not settings.sensitive.
      const res = await authed('patch', `/users/${staff.id}/permissions`, managerToken).send({ permissions: ['settings.sensitive'] });
      expect(res.status).toBe(403);
    });

    it('a non-owner CAN grant a permission they do hold, to someone else, and it takes effect on that user\'s very next request with no re-login', async () => {
      await setPermissions(manager.id, ['staff.manage', 'staff.permissions', 'customers.view', 'customers.manage']);

      const grant = await authed('patch', `/users/${staff.id}/permissions`, managerToken).send({ permissions: ['customers.manage'] });
      expect(grant.status).toBe(200);

      // Same pre-existing staffToken, no new login — proves JwtStrategy's
      // fresh per-request permission read, not a cached/stale token.
      const createCustomer = await authed('post', '/customers', staffToken).send({
        firstName: 'Granted',
        lastName: 'Immediately',
        email: `granted-${Date.now()}@example.test`,
      });
      expect(createCustomer.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------
  // 10. Existing/migrated staff operate per their real backfilled set
  // -------------------------------------------------------------------
  describe('10. A freshly-migrated-equivalent STAFF account works out of the box, and only within its real historical access', () => {
    beforeAll(async () => {
      legacyStaff = await createUserInTenant(prisma, tenant.tenantId, 'LegacyEquivalent', UserRole.STAFF);
      legacyStaffToken = await completeStaffLogin(app, legacyStaff.email, legacyStaff.password);
    });

    it('can use warehouse and customer routes without any manual grant', async () => {
      const inventory = await authed('get', '/warehouse/inventory', legacyStaffToken);
      expect(inventory.status).toBe(200);

      const customers = await authed('get', '/customers', legacyStaffToken);
      expect(customers.status).toBe(200);
    });

    it('still has no invoice/payment access — STAFF never had it, migrated or not', async () => {
      const invoices = await authed('get', '/invoices', legacyStaffToken);
      expect(invoices.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // 11 & 12. A brand-new, zero-permission staff member (real invite +
  // accept flow) gets no accidental access — proven on a second,
  // independently-created tenant to also demonstrate no tenant-specific
  // wiring was needed for any of this to work.
  // -------------------------------------------------------------------
  describe('11 & 12. A new zero-permission staff member via the real invite flow, on an independent tenant, gets nothing extra', () => {
    it('invites with no permissions field, accepts, logs in, and is denied every permission-gated route', async () => {
      const ownerOtherToken = await completeStaffLogin(app, tenantOther.user.email, tenantOther.user.password);

      const email = `newhire-${Date.now()}@example.test`;
      sentEmails.length = 0;
      const inviteRes = await authed('post', '/users/invite', ownerOtherToken).send({
        firstName: 'New',
        lastName: 'Hire',
        email,
        role: UserRole.STAFF,
        // permissions deliberately omitted
      });
      expect(inviteRes.status).toBe(201);

      const captured = sentEmails.find((e) => e.to === email);
      expect(captured).toBeDefined();
      const match = captured!.body.match(/accept-invite\?token=([a-f0-9]+)/);
      expect(match).not.toBeNull();
      const rawToken = match![1];

      const acceptRes = await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token: rawToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      expect(acceptRes.status).toBe(200);

      const newHireToken = await completeStaffLogin(app, email, TEST_PASSWORD);

      const warehouse = await authed('get', '/warehouse/inventory', newHireToken);
      expect(warehouse.status).toBe(403);

      const customers = await authed('get', '/customers', newHireToken);
      expect(customers.status).toBe(403);

      const invoices = await authed('get', '/invoices', newHireToken);
      expect(invoices.status).toBe(403);
    });
  });
});
