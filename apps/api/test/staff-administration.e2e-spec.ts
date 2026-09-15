import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * RBAC V1: staff administration — PATCH /users/:id/role and PATCH
 * /users/:id/status — is OWNER only (STAFF_ADMIN_ROLES). MANAGER's "staff
 * oversight" is explicitly view-only: it can see GET /users/staff but
 * none of the administration actions here. Covers:
 *   1. Role gating — OWNER can act, MANAGER/STAFF/FINANCE cannot.
 *   2. Tenant isolation — a cross-tenant target id 404s, never a leak.
 *   3. Input validation — only the 4 tenant-staff roles are assignable.
 *   4. The last-owner lockout — "OWNER must not accidentally be lockable
 *      out of their own tenant": neither a role change nor a
 *      deactivation may ever leave a tenant with zero active OWNERs,
 *      whether acting on another user or on the caller's own account,
 *      and regardless of whether the tenant currently has one owner or
 *      several.
 */
describe('Staff administration: role changes, activate/deactivate, last-owner lockout (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let ownerTokenA: string;
  let managerTokenA: string;
  let staffTokenA: string;
  let financeTokenA: string;
  let managerA: { id: string; email: string; password: string };
  let staffA: { id: string; email: string; password: string };
  let customerA: { id: string; email: string; password: string };

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'StaffAdminA', UserRole.OWNER);
    tenantB = await createTestTenant(prisma, 'StaffAdminB', UserRole.OWNER);
    ownerTokenA = await login(app, tenantA.user.email, tenantA.user.password);

    managerA = await createUserInTenant(prisma, tenantA.tenantId, 'Manager', UserRole.MANAGER);
    managerTokenA = await login(app, managerA.email, managerA.password);
    staffA = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.STAFF);
    staffTokenA = await login(app, staffA.email, staffA.password);
    const financeA = await createUserInTenant(prisma, tenantA.tenantId, 'Finance', UserRole.FINANCE);
    financeTokenA = await login(app, financeA.email, financeA.password);
    customerA = await createUserInTenant(prisma, tenantA.tenantId, 'Cust', UserRole.CUSTOMER);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('role gating', () => {
    it('MANAGER gets 403 changing a role (view-only staff oversight)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${staffA.id}/role`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({ role: UserRole.MANAGER });
      expect(res.status).toBe(403);
    });

    it('MANAGER gets 403 deactivating a user', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${staffA.id}/status`)
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({ isActive: false });
      expect(res.status).toBe(403);
    });

    it('STAFF and FINANCE get 403 on both endpoints', async () => {
      for (const token of [staffTokenA, financeTokenA]) {
        const roleRes = await request(app.getHttpServer())
          .patch(`/users/${managerA.id}/role`)
          .set('Authorization', `Bearer ${token}`)
          .send({ role: UserRole.STAFF });
        expect(roleRes.status).toBe(403);

        const statusRes = await request(app.getHttpServer())
          .patch(`/users/${managerA.id}/status`)
          .set('Authorization', `Bearer ${token}`)
          .send({ isActive: false });
        expect(statusRes.status).toBe(403);
      }
    });

    it('OWNER can change a staff member\'s role', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${staffA.id}/role`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ role: UserRole.MANAGER });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(UserRole.MANAGER);

      // restore for later tests
      await request(app.getHttpServer())
        .patch(`/users/${staffA.id}/role`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ role: UserRole.STAFF });
    });

    it('OWNER can deactivate and reactivate a staff member, and deactivation actually blocks login', async () => {
      const deactivateRes = await request(app.getHttpServer())
        .patch(`/users/${staffA.id}/status`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ isActive: false });
      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.isActive).toBe(false);

      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: staffA.email, password: staffA.password });
      expect(loginRes.status).toBe(401);

      const reactivateRes = await request(app.getHttpServer())
        .patch(`/users/${staffA.id}/status`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ isActive: true });
      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.isActive).toBe(true);

      const loginAgainRes = await request(app.getHttpServer()).post('/auth/login').send({ email: staffA.email, password: staffA.password });
      expect(loginAgainRes.status).toBe(200);
    });
  });

  describe('input validation', () => {
    it('rejects assigning PLATFORM_ADMIN via role change', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${staffA.id}/role`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ role: 'PLATFORM_ADMIN' });
      expect(res.status).toBe(400);
    });

    it('rejects assigning CUSTOMER via role change', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${staffA.id}/role`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ role: 'CUSTOMER' });
      expect(res.status).toBe(400);
    });

    it('404s attempting to administer a CUSTOMER-role account — this surface is staff-only', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${customerA.id}/role`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ role: UserRole.STAFF });
      expect(res.status).toBe(404);
    });
  });

  describe('tenant isolation', () => {
    it("tenant A's owner cannot change a tenant B user's role (404, never a leak)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${tenantB.user.id}/role`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ role: UserRole.MANAGER });
      expect(res.status).toBe(404);
    });

    it("tenant A's owner cannot deactivate a tenant B user (404, never a leak)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${tenantB.user.id}/status`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ isActive: false });
      expect(res.status).toBe(404);
    });
  });

  /**
   * Last-owner lockout — its own isolated tenant per scenario so one
   * test's owner-count mutations can never bleed into another's.
   */
  describe('last-owner lockout', () => {
    it('rejects demoting the sole OWNER away from OWNER', async () => {
      const t = await createTestTenant(prisma, 'SoleOwnerDemote', UserRole.OWNER);
      const token = await login(app, t.user.email, t.user.password);

      const res = await request(app.getHttpServer())
        .patch(`/users/${t.user.id}/role`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: UserRole.MANAGER });
      expect(res.status).toBe(403);

      const stillOwner = await prisma.user.findUnique({ where: { id: t.user.id } });
      expect(stillOwner?.role).toBe(UserRole.OWNER);

      await deleteTestTenant(prisma, t.tenantId);
    });

    it('rejects deactivating the sole OWNER', async () => {
      const t = await createTestTenant(prisma, 'SoleOwnerDeactivate', UserRole.OWNER);
      const token = await login(app, t.user.email, t.user.password);

      const res = await request(app.getHttpServer())
        .patch(`/users/${t.user.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false });
      expect(res.status).toBe(403);

      const stillActive = await prisma.user.findUnique({ where: { id: t.user.id } });
      expect(stillActive?.isActive).toBe(true);

      await deleteTestTenant(prisma, t.tenantId);
    });

    it('allows demoting/deactivating an OWNER once a second active OWNER exists, and then blocks going below one', async () => {
      const t = await createTestTenant(prisma, 'TwoOwners', UserRole.OWNER);
      const firstOwnerToken = await login(app, t.user.email, t.user.password);
      const secondOwner = await createUserInTenant(prisma, t.tenantId, 'Owner2', UserRole.OWNER);

      // With two active owners, demoting the first is allowed.
      const demoteRes = await request(app.getHttpServer())
        .patch(`/users/${t.user.id}/role`)
        .set('Authorization', `Bearer ${firstOwnerToken}`)
        .send({ role: UserRole.MANAGER });
      expect(demoteRes.status).toBe(200);
      expect(demoteRes.body.role).toBe(UserRole.MANAGER);

      // Now only secondOwner is an active OWNER — demoting/deactivating
      // them must be rejected, including by themselves.
      const secondOwnerToken = await login(app, secondOwner.email, secondOwner.password);
      const demoteLastRes = await request(app.getHttpServer())
        .patch(`/users/${secondOwner.id}/role`)
        .set('Authorization', `Bearer ${secondOwnerToken}`)
        .send({ role: UserRole.STAFF });
      expect(demoteLastRes.status).toBe(403);

      await deleteTestTenant(prisma, t.tenantId);
    });

    it('allows deactivating one of two active OWNERs, then blocks deactivating the remaining one', async () => {
      const t = await createTestTenant(prisma, 'TwoOwnersDeactivate', UserRole.OWNER);
      const firstOwnerToken = await login(app, t.user.email, t.user.password);
      const secondOwner = await createUserInTenant(prisma, t.tenantId, 'Owner2', UserRole.OWNER);

      const deactivateFirstRes = await request(app.getHttpServer())
        .patch(`/users/${secondOwner.id}/status`)
        .set('Authorization', `Bearer ${firstOwnerToken}`)
        .send({ isActive: false });
      expect(deactivateFirstRes.status).toBe(200);

      // Only the original owner is active now — self-deactivation must be rejected.
      const selfDeactivateRes = await request(app.getHttpServer())
        .patch(`/users/${t.user.id}/status`)
        .set('Authorization', `Bearer ${firstOwnerToken}`)
        .send({ isActive: false });
      expect(selfDeactivateRes.status).toBe(403);

      await deleteTestTenant(prisma, t.tenantId);
    });

    it('an already-inactive OWNER does not count toward the active-owner floor — demoting the only *active* owner is still blocked even if inactive OWNER rows exist', async () => {
      const t = await createTestTenant(prisma, 'InactiveOwnerNoop', UserRole.OWNER);
      const token = await login(app, t.user.email, t.user.password);
      await prisma.user.create({
        data: {
          tenantId: t.tenantId,
          email: `inactive-owner-${Date.now()}@example.test`,
          passwordHash: 'unused-never-logged-in-with',
          firstName: 'Inactive',
          lastName: 'Owner',
          role: UserRole.OWNER,
          isActive: false,
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`/users/${t.user.id}/role`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: UserRole.MANAGER });
      expect(res.status).toBe(403);

      await deleteTestTenant(prisma, t.tenantId);
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
