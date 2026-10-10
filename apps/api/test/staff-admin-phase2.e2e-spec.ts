import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashToken } from '../src/common/token/token.util';
import { EMAIL_PROVIDER } from '../src/notifications/providers/provider.types';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Owner-managed staff administration (2026-10): cancel-invitation,
 * remove/reinvite staff, and owner-triggered password reset — the three
 * capabilities added on top of the already-shipped RBAC permissions
 * system (invite/resend/role/status/permissions, covered by
 * staff-invitations.e2e-spec.ts and staff-administration.e2e-spec.ts).
 * Same conventions as those two suites: real HTTP surface, a captured
 * EMAIL_PROVIDER to recover tokens, ThrottlerGuard disabled for request
 * volume, fresh e2e-* fixture tenants only.
 */
describe('Owner-managed staff administration: revoke/remove/reinvite/password-reset (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const sent: CapturedEmail[] = [];

  let tenantA: TestTenantFixture; // OWNER by default
  let tenantB: TestTenantFixture;
  let ownerTokenA: string;
  let managerTokenA: string; // legacy permissions — no staff.invite/staff.manage
  let managerA: { id: string; email: string; password: string };

  beforeAll(async () => {
    process.env.ANANSELOGIX_BASE_URL = 'https://ananselogix.com';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({
        send: async (params: CapturedEmail) => {
          sent.push(params);
          return { success: true, providerMessageId: 'console-email-test' };
        },
      })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenantA = await createTestTenant(prisma, 'StaffPhase2A', UserRole.OWNER);
    tenantB = await createTestTenant(prisma, 'StaffPhase2B', UserRole.OWNER);
    managerA = await createUserInTenant(prisma, tenantA.tenantId, 'Manager', UserRole.MANAGER);

    ownerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    managerTokenA = await login(app, managerA.email, managerA.password);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  beforeEach(() => {
    sent.length = 0;
  });

  function extractInviteToken(email: CapturedEmail): string {
    const match = email.body.match(/accept-invite\?token=([a-f0-9]+)/);
    if (!match) throw new Error(`No invite token found in captured email body: ${email.body}`);
    return match[1];
  }

  function extractResetToken(email: CapturedEmail): string {
    const match = email.body.match(/reset-password\?token=([a-f0-9]+)/);
    if (!match) throw new Error(`No reset token found in captured email body: ${email.body}`);
    return match[1];
  }

  // -------------------------------------------------------------------
  // Cancel (revoke) a pending invitation
  // -------------------------------------------------------------------
  describe('cancel (revoke) a pending invitation', () => {
    it('OWNER can revoke a PENDING invitation, and the emailed link stops working', async () => {
      const email = `revoke-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Revoke', lastName: 'Me', email, role: UserRole.STAFF });
      expect(inviteRes.status).toBe(201);
      const token = extractInviteToken(sent[0]);

      const revokeRes = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(revokeRes.status).toBe(201);
      expect(revokeRes.body.status).toBe('REVOKED');

      const row = await prisma.tenantInvitation.findUnique({ where: { id: inviteRes.body.id } });
      expect(row?.status).toBe('REVOKED');

      const acceptRes = await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token, password: 'ShouldNotWork1!', confirmPassword: 'ShouldNotWork1!' });
      expect(acceptRes.status).toBe(400);
    });

    it('revoking frees the email immediately — a brand new invite succeeds right away, unlike the "already pending" error a second invite would normally get', async () => {
      const email = `revoke-then-reinvite-${Date.now()}@example.test`;
      const first = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'First', lastName: 'Attempt', email, role: UserRole.STAFF });
      expect(first.status).toBe(201);

      await request(app.getHttpServer())
        .post(`/users/invitations/${first.body.id}/revoke`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Second', lastName: 'Attempt', email, role: UserRole.STAFF });
      expect(second.status).toBe(201);
    });

    it('cannot revoke an already-accepted invitation', async () => {
      const email = `revoke-accepted-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Already', lastName: 'Accepted', email, role: UserRole.STAFF })
        .expect(201);
      const token = extractInviteToken(sent[0]);
      await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token, password: 'Accepted123!', confirmPassword: 'Accepted123!' })
        .expect(200);

      const revokeRes = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(revokeRes.status).toBe(400);
    });

    it('cannot revoke an already-revoked invitation', async () => {
      const email = `revoke-twice-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Double', lastName: 'Revoke', email, role: UserRole.STAFF })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .expect(201);

      const secondRevoke = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(secondRevoke.status).toBe(400);
    });

    it('MANAGER without staff.invite cannot revoke', async () => {
      const email = `revoke-mgr-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Mgr', lastName: 'Blocked', email, role: UserRole.STAFF })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${managerTokenA}`);
      expect(res.status).toBe(403);
    });

    it("tenant A's owner cannot revoke a tenant B invitation (404, never a leak)", async () => {
      const tokenB = await login(app, tenantB.user.email, tenantB.user.password);
      const email = `revoke-cross-tenant-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ firstName: 'TenantB', lastName: 'Invite', email, role: UserRole.STAFF })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/revoke`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Remove a staff member (preserve history) + reinvite
  // -------------------------------------------------------------------
  describe('remove a staff member and reinvite', () => {
    it('removes a staff member without deleting the row: isActive false, removedAt set, disappears from the active list, appears in the removed list, and login is blocked', async () => {
      const target = await createUserInTenant(prisma, tenantA.tenantId, 'ToRemove', UserRole.STAFF);

      const removeRes = await request(app.getHttpServer())
        .post(`/users/${target.id}/remove`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(removeRes.status).toBe(201);

      const row = await prisma.user.findUnique({ where: { id: target.id } });
      expect(row).toBeTruthy(); // never deleted
      expect(row!.isActive).toBe(false);
      expect(row!.removedAt).toBeTruthy();
      expect(row!.email).toBe(target.email); // email preserved, never mangled

      const activeList = await request(app.getHttpServer()).get('/users/staff').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(activeList.body.find((m: { id: string }) => m.id === target.id)).toBeUndefined();

      const removedList = await request(app.getHttpServer())
        .get('/users/staff/removed')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(removedList.status).toBe(200);
      const removedRow = removedList.body.find((m: { id: string }) => m.id === target.id);
      expect(removedRow).toBeTruthy();
      expect(removedRow.email).toBe(target.email);
      // Never leaks a password/hash through this surface.
      expect(removedRow.passwordHash).toBeUndefined();

      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: target.email, password: target.password });
      expect(loginRes.status).toBe(401);
    });

    it('frees the email for a brand-new invitation, and accepting it creates a NEW user row — the old (removed) row is untouched', async () => {
      const target = await createUserInTenant(prisma, tenantA.tenantId, 'ToReinvite', UserRole.STAFF);
      await request(app.getHttpServer())
        .post(`/users/${target.id}/remove`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .expect(201);

      // Previously this would 400 ("already exists") — removal frees it.
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Fresh', lastName: 'Hire', email: target.email, role: UserRole.STAFF });
      expect(inviteRes.status).toBe(201);
      const token = extractInviteToken(sent[sent.length - 1]);

      const newPassword = 'BrandNewHire123!';
      await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token, password: newPassword, confirmPassword: newPassword })
        .expect(200);

      const rows = await prisma.user.findMany({ where: { tenantId: tenantA.tenantId, email: target.email } });
      expect(rows).toHaveLength(2); // the removed row + the brand-new one
      const newRow = rows.find((r) => r.id !== target.id);
      const oldRow = rows.find((r) => r.id === target.id);
      expect(newRow).toBeTruthy();
      expect(newRow!.removedAt).toBeNull();
      expect(newRow!.isActive).toBe(true);
      expect(oldRow!.removedAt).toBeTruthy(); // untouched by the new invite/accept

      const newEmployeeToken = await login(app, target.email, newPassword);
      expect(newEmployeeToken).toBeTruthy();
    });

    it('preserves historical attribution: a TenantAuditLog entry targeting the removed user still resolves to that exact (now removed) row', async () => {
      const target = await createUserInTenant(prisma, tenantA.tenantId, 'HasHistory', UserRole.STAFF);
      // Representative of every onDelete: SetNull operational FK this
      // feature is designed to protect (shipments/warehouse scans/etc. —
      // see schema.prisma's own comment on User.removedAt) — the audit
      // log is the lightest-weight one already wired through
      // writeTenantAuditLog, exercised here end to end via a real role
      // change before removal.
      await request(app.getHttpServer())
        .patch(`/users/${target.id}/role`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ role: UserRole.FINANCE })
        .expect(200);

      await request(app.getHttpServer()).post(`/users/${target.id}/remove`).set('Authorization', `Bearer ${ownerTokenA}`).expect(201);

      const auditRows = await prisma.tenantAuditLog.findMany({ where: { tenantId: tenantA.tenantId, targetUserId: target.id } });
      const actions = auditRows.map((r) => r.action);
      expect(actions).toContain('ROLE_CHANGED');
      expect(actions).toContain('STAFF_REMOVED');
      // The FK still resolves — removal never nulled it out or orphaned it.
      const stillLinked = await prisma.user.findUnique({ where: { id: target.id } });
      expect(stillLinked).toBeTruthy();
    });

    it('removing an already-removed staff member 404s (not a double-removal no-op)', async () => {
      const target = await createUserInTenant(prisma, tenantA.tenantId, 'DoubleRemove', UserRole.STAFF);
      await request(app.getHttpServer()).post(`/users/${target.id}/remove`).set('Authorization', `Bearer ${ownerTokenA}`).expect(201);

      const second = await request(app.getHttpServer()).post(`/users/${target.id}/remove`).set('Authorization', `Bearer ${ownerTokenA}`);
      expect(second.status).toBe(404);
    });

    it("rejects removing the tenant's last active OWNER", async () => {
      const t = await createTestTenant(prisma, 'LastOwnerRemove', UserRole.OWNER);
      const token = await login(app, t.user.email, t.user.password);

      const res = await request(app.getHttpServer()).post(`/users/${t.user.id}/remove`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);

      const row = await prisma.user.findUnique({ where: { id: t.user.id } });
      expect(row?.removedAt).toBeNull();

      await deleteTestTenant(prisma, t.tenantId);
    });

    it('allows removing one of two active OWNERs, then blocks removing the remaining one', async () => {
      const t = await createTestTenant(prisma, 'TwoOwnersRemove', UserRole.OWNER);
      const firstOwnerToken = await login(app, t.user.email, t.user.password);
      const secondOwner = await createUserInTenant(prisma, t.tenantId, 'Owner2', UserRole.OWNER);

      const removeSecond = await request(app.getHttpServer())
        .post(`/users/${secondOwner.id}/remove`)
        .set('Authorization', `Bearer ${firstOwnerToken}`);
      expect(removeSecond.status).toBe(201);

      const removeSelf = await request(app.getHttpServer())
        .post(`/users/${t.user.id}/remove`)
        .set('Authorization', `Bearer ${firstOwnerToken}`);
      expect(removeSelf.status).toBe(403);

      await deleteTestTenant(prisma, t.tenantId);
    });

    it('MANAGER without staff.manage cannot remove a staff member', async () => {
      const target = await createUserInTenant(prisma, tenantA.tenantId, 'MgrBlockedRemove', UserRole.STAFF);
      const res = await request(app.getHttpServer())
        .post(`/users/${target.id}/remove`)
        .set('Authorization', `Bearer ${managerTokenA}`);
      expect(res.status).toBe(403);
    });

    it('a non-owner delegated staff.manage can remove a STAFF member but still cannot remove an OWNER (owner boundary) or themselves (self-escalation)', async () => {
      const delegate = await createUserInTenant(prisma, tenantA.tenantId, 'Delegate', UserRole.MANAGER);
      await prisma.user.update({ where: { id: delegate.id }, data: { permissions: ['staff.manage'] } });
      const delegateToken = await login(app, delegate.email, delegate.password);

      const target = await createUserInTenant(prisma, tenantA.tenantId, 'RemovedByDelegate', UserRole.STAFF);
      const removeRes = await request(app.getHttpServer())
        .post(`/users/${target.id}/remove`)
        .set('Authorization', `Bearer ${delegateToken}`);
      expect(removeRes.status).toBe(201);

      const removeOwnerAttempt = await request(app.getHttpServer())
        .post(`/users/${tenantA.user.id}/remove`)
        .set('Authorization', `Bearer ${delegateToken}`);
      expect(removeOwnerAttempt.status).toBe(403);

      const removeSelfAttempt = await request(app.getHttpServer())
        .post(`/users/${delegate.id}/remove`)
        .set('Authorization', `Bearer ${delegateToken}`);
      expect(removeSelfAttempt.status).toBe(403);
    });

    it("tenant A's owner cannot remove a tenant B user (404, never a leak)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${tenantB.user.id}/remove`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Owner-triggered password reset (by exact id)
  // -------------------------------------------------------------------
  describe('owner-triggered password reset', () => {
    it('sends a working reset email for a specific staff member, without the caller ever seeing the new password, and records an audit entry', async () => {
      const target = await createUserInTenant(prisma, tenantA.tenantId, 'ResetTarget', UserRole.STAFF);

      const res = await request(app.getHttpServer())
        .post(`/users/${target.id}/password-reset`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(target.email);
      const token = extractResetToken(sent[0]);

      const newPassword = 'ResetByOwner123!';
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, password: newPassword, confirmPassword: newPassword })
        .expect(200);

      const newToken = await login(app, target.email, newPassword);
      expect(newToken).toBeTruthy();

      const auditRows = await prisma.tenantAuditLog.findMany({
        where: { tenantId: tenantA.tenantId, targetUserId: target.id, action: 'STAFF_PASSWORD_RESET_TRIGGERED' },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('refuses to send a reset for a deactivated account', async () => {
      const target = await createUserInTenant(prisma, tenantA.tenantId, 'InactiveReset', UserRole.STAFF);
      await request(app.getHttpServer())
        .patch(`/users/${target.id}/status`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ isActive: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/users/${target.id}/password-reset`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(400);
      expect(sent).toHaveLength(0);
    });

    it('MANAGER without staff.manage cannot trigger a password reset', async () => {
      const target = await createUserInTenant(prisma, tenantA.tenantId, 'MgrBlockedReset', UserRole.STAFF);
      const res = await request(app.getHttpServer())
        .post(`/users/${target.id}/password-reset`)
        .set('Authorization', `Bearer ${managerTokenA}`);
      expect(res.status).toBe(403);
    });

    it("tenant A's owner cannot trigger a reset for a tenant B user (404, never a leak)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${tenantB.user.id}/password-reset`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(404);
    });

    /**
     * Duplicate-email-across-tenants safety: this is the exact scenario
     * [[gold-coast-tatanic-duplicate-email-login-fixed]] and the self-
     * service forgot-password flow both have to reason carefully about.
     * The owner-triggered path sidesteps the ambiguity entirely — it
     * acts on one already-resolved id, never an email lookup — so
     * triggering a reset for tenant A's user must never also email
     * tenant B's unrelated user who just happens to share the address.
     */
    it('is immune to the duplicate-email-across-tenants ambiguity: resetting tenant A\'s user never touches tenant B\'s user with the same email', async () => {
      const sharedEmail = `shared-dup-${Date.now()}@example.test`;
      const passwordHash = await bcrypt.hash('OriginalPass123!', 10);
      const userA = await prisma.user.create({
        data: { tenantId: tenantA.tenantId, email: sharedEmail, passwordHash, firstName: 'Shared', lastName: 'A', role: UserRole.STAFF },
      });
      const userB = await prisma.user.create({
        data: { tenantId: tenantB.tenantId, email: sharedEmail, passwordHash, firstName: 'Shared', lastName: 'B', role: UserRole.STAFF },
      });

      const res = await request(app.getHttpServer())
        .post(`/users/${userA.id}/password-reset`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(201);

      expect(sent).toHaveLength(1);
      const tokenRow = await prisma.accountToken.findFirst({ where: { tokenHash: hashToken(extractResetToken(sent[0])) } });
      expect(tokenRow?.userId).toBe(userA.id);
      expect(tokenRow?.userId).not.toBe(userB.id);

      const tokensForB = await prisma.accountToken.findMany({ where: { userId: userB.id } });
      expect(tokensForB).toHaveLength(0);
    });
  });

  it('leaves existing login/RBAC for pre-existing roles fully intact', async () => {
    const token = await completeStaffLogin(app, tenantA.user.email, tenantA.user.password);
    const me = await request(app.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.tenantId).toBe(tenantA.tenantId);
  });
});

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  return completeStaffLogin(app, email, password);
}
