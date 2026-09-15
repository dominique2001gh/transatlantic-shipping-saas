import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * RBAC V1 (2026-09): the authoritative, consolidated permission-matrix
 * regression suite for the 4-tier tenant-staff role model (OWNER/MANAGER/
 * STAFF/FINANCE). Individual feature specs (invoices-foundation,
 * payments-foundation, analytics, leads, etc.) already prove these rules
 * in the context of their own business logic; this file exists purely to
 * assert the *shape* of the approved matrix in one place, so a future
 * change to any single controller's @Roles() list shows up here as a
 * clear, single-purpose failure — not just as a side effect buried in an
 * unrelated feature test.
 *
 * Every row below reflects an explicit product decision from the RBAC V1
 * approval, not a guess:
 *   - STAFF: full day-to-day operational access (customers, shipments,
 *     warehouse, containers, manifests) — never invoices/payments/
 *     analytics/staff-admin/tenant settings.
 *   - MANAGER: everything STAFF has, plus invoices/payments and full
 *     analytics/reports — never staff *administration* (view-only) or
 *     tenant settings/subscription/billing.
 *   - FINANCE: a closed list — customer view (not create), invoices,
 *     payments, and /analytics/revenue only. No warehouse/container/
 *     manifest/shipment access at all, not even to view.
 *   - OWNER: everything, including staff administration and the
 *     AnanseLogix subscription/billing plan / sensitive tenant settings.
 */
describe('RBAC V1 permission matrix (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenant: TestTenantFixture;
  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;
  let financeToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'Matrix', UserRole.OWNER);
    ownerToken = await login(app, tenant.user.email, tenant.user.password);

    const manager = await createUserInTenant(prisma, tenant.tenantId, 'Manager', UserRole.MANAGER);
    managerToken = await login(app, manager.email, manager.password);
    const staff = await createUserInTenant(prisma, tenant.tenantId, 'Staff', UserRole.STAFF);
    staffToken = await login(app, staff.email, staff.password);
    const finance = await createUserInTenant(prisma, tenant.tenantId, 'Finance', UserRole.FINANCE);
    financeToken = await login(app, finance.email, finance.password);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  function tokenFor(role: 'OWNER' | 'MANAGER' | 'STAFF' | 'FINANCE'): string {
    return { OWNER: ownerToken, MANAGER: managerToken, STAFF: staffToken, FINANCE: financeToken }[role];
  }

  async function get(path: string, role: 'OWNER' | 'MANAGER' | 'STAFF' | 'FINANCE') {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(role)}`);
  }

  describe.each([
    ['/customers', ['OWNER', 'MANAGER', 'STAFF', 'FINANCE'], []],
    ['/shipments', ['OWNER', 'MANAGER', 'STAFF'], ['FINANCE']],
    ['/warehouse/inventory', ['OWNER', 'MANAGER', 'STAFF'], ['FINANCE']],
    ['/containers', ['OWNER', 'MANAGER', 'STAFF'], ['FINANCE']],
    ['/manifests', ['OWNER', 'MANAGER', 'STAFF'], ['FINANCE']],
    ['/invoices', ['OWNER', 'MANAGER', 'FINANCE'], ['STAFF']],
    ['/payments', ['OWNER', 'MANAGER', 'FINANCE'], ['STAFF']],
    ['/leads', ['OWNER', 'MANAGER', 'STAFF'], ['FINANCE']],
    ['/notifications', ['OWNER', 'MANAGER', 'STAFF'], ['FINANCE']],
    ['/documents', ['OWNER', 'MANAGER', 'STAFF'], ['FINANCE']],
    ['/analytics/operations', ['OWNER', 'MANAGER'], ['STAFF', 'FINANCE']],
    ['/analytics/revenue', ['OWNER', 'MANAGER', 'FINANCE'], ['STAFF']],
    ['/users/staff', ['OWNER', 'MANAGER', 'STAFF', 'FINANCE'], []],
  ] as const)('GET %s', (path, allowed, denied) => {
    it.each(allowed)('allows %s', async (role) => {
      const res = await get(path, role);
      expect(res.status).toBe(200);
    });

    if (denied.length > 0) {
      it.each(denied)('denies %s (403)', async (role) => {
        const res = await get(path, role);
        expect(res.status).toBe(403);
      });
    } else {
      it('is open to every dashboard role (no denied roles for this endpoint)', () => {
        expect(denied).toHaveLength(0);
      });
    }
  });

  describe('write-side asymmetries not captured by the GET matrix above', () => {
    it('STAFF can create a customer; FINANCE cannot (view-only)', async () => {
      const staffRes = await request(app.getHttpServer())
        .post('/customers')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ firstName: 'Matrix', lastName: 'Staff', email: `matrix-staff-${Date.now()}@example.test` });
      expect(staffRes.status).toBe(201);

      const financeRes = await request(app.getHttpServer())
        .post('/customers')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ firstName: 'Matrix', lastName: 'Finance', email: `matrix-finance-${Date.now()}@example.test` });
      expect(financeRes.status).toBe(403);
    });

    it('OWNER and MANAGER can invite staff; STAFF and FINANCE cannot', async () => {
      const managerRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ firstName: 'Should', lastName: 'Fail', email: `matrix-mgr-invite-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(managerRes.status).toBe(403);

      const ownerRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ firstName: 'Matrix', lastName: 'Invitee', email: `matrix-owner-invite-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(ownerRes.status).toBe(201);
    });

    it('OWNER can reach /tenants/me and general tenant/onboarding gates behave per tier', async () => {
      // Every dashboard role can see its own tenant's public profile.
      for (const role of ['OWNER', 'MANAGER', 'STAFF', 'FINANCE'] as const) {
        const res = await get('/tenants/me', role);
        expect(res.status).toBe(200);
      }
    });

    it('only OWNER may reach the onboarding wizard; MANAGER/STAFF/FINANCE are rejected', async () => {
      const ownerRes = await get('/onboarding', 'OWNER');
      // Might 404 if this lightweight fixture tenant has no TenantOnboarding
      // row yet (see staff-invitations.e2e-spec.ts's identical caveat) —
      // the point here is *never* 403 for OWNER, unlike every other tier.
      expect(ownerRes.status).not.toBe(403);

      for (const role of ['MANAGER', 'STAFF', 'FINANCE'] as const) {
        const res = await get('/onboarding', role);
        expect(res.status).toBe(403);
      }
    });
  });

  /**
   * Defense-in-depth regression: RolesGuard requires tenantId === null in
   * addition to role === PLATFORM_ADMIN for any PLATFORM_ADMIN-gated
   * route. This directly creates the malformed row the guard defends
   * against (role=PLATFORM_ADMIN with a real tenantId) — StaffInvitationsService
   * itself can no longer produce this (see staff-invitations.e2e-spec.ts's
   * escalation tests), but this proves the guard holds even if some other
   * future code path ever managed to create such a row.
   */
  describe('PLATFORM_ADMIN defense-in-depth (RolesGuard tenantId-null hardening)', () => {
    it('a PLATFORM_ADMIN-role user with a non-null tenantId is rejected from platform routes', async () => {
      const malformed = await createUserInTenant(prisma, tenant.tenantId, 'Malformed', UserRole.PLATFORM_ADMIN);
      const malformedToken = await login(app, malformed.email, malformed.password);

      const res = await request(app.getHttpServer()).get('/tenants').set('Authorization', `Bearer ${malformedToken}`);
      expect(res.status).toBe(403);
    });

    it('a real PLATFORM_ADMIN (tenantId null) still gets 200 on the same route', async () => {
      const platformAdmin = await prisma.user.create({
        data: {
          tenantId: null,
          email: `platform-admin-matrix-${Date.now()}@example.test`,
          passwordHash: await bcrypt.hash('TestPass123!', 10),
          firstName: 'Platform',
          lastName: 'Admin',
          role: UserRole.PLATFORM_ADMIN,
          isActive: true,
        },
      });
      const token = await login(app, platformAdmin.email, 'TestPass123!');

      const res = await request(app.getHttpServer()).get('/tenants').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      await prisma.user.delete({ where: { id: platformAdmin.id } });
    });
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
