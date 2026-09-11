import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashToken } from '../src/common/token/token.util';
import { EMAIL_PROVIDER } from '../src/notifications/providers/provider.types';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';

jest.setTimeout(30_000);

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Staff Invitations stage — full invite/accept/resend pipeline, end to
 * end against the real HTTP surface. Overrides EMAIL_PROVIDER to capture
 * what would have been sent (matching password-reset.e2e-spec.ts's exact
 * pattern) so the raw invite token — never persisted anywhere in
 * plaintext, see TenantInvitation's own doc comment — can be recovered
 * from the captured email body. Also overrides ThrottlerGuard for the
 * same reason password-reset.e2e-spec.ts does: this suite's own request
 * volume would otherwise trip the accept-invite rate limit, which is a
 * real safeguard proven separately, not what these tests are about.
 */
describe('Staff Invitations: invite/accept/resend (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const sent: CapturedEmail[] = [];

  let tenantA: TestTenantFixture; // owner role by default
  let tenantB: TestTenantFixture;
  let managerA: { id: string; email: string; password: string };
  let adminA: { id: string; email: string; password: string };
  let staffA: { id: string; email: string; password: string };
  let ownerTokenA: string;
  let managerTokenA: string;
  let adminTokenA: string;
  let staffTokenA: string;

  beforeAll(async () => {
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

    tenantA = await createTestTenant(prisma, 'InviteA', UserRole.TENANT_OWNER);
    tenantB = await createTestTenant(prisma, 'InviteB', UserRole.TENANT_OWNER);
    managerA = await createUserInTenant(prisma, tenantA.tenantId, 'Manager', UserRole.WAREHOUSE_MANAGER);
    adminA = await createUserInTenant(prisma, tenantA.tenantId, 'Admin', UserRole.TENANT_ADMIN);
    staffA = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);

    ownerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    managerTokenA = await login(app, managerA.email, managerA.password);
    adminTokenA = await login(app, adminA.email, adminA.password);
    staffTokenA = await login(app, staffA.email, staffA.password);

    // createTestTenant's fixture is a lightweight e2e tenant, not a real
    // AnanseLogix-provisioned one — it has no TenantOnboarding row, which
    // every OnboardingController route 404s without. Only needed for the
    // "onboarding wizard's own Staff step" describe block below.
    await prisma.tenantOnboarding.create({ data: { tenantId: tenantA.tenantId } });
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  function extractToken(email: CapturedEmail): string {
    const match = email.body.match(/accept-invite\?token=([a-f0-9]+)/);
    if (!match) throw new Error(`No invite token found in captured email body: ${email.body}`);
    return match[1];
  }

  describe('who can invite', () => {
    it('OWNER can invite', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'New', lastName: 'Hire', email: `owner-invited-${Date.now()}@example.test`, role: UserRole.WAREHOUSE_STAFF });
      expect(res.status).toBe(201);
      expect(res.body.firstName).toBe('New');
      expect(res.body.status).toBe('PENDING');
      expect(sent).toHaveLength(1);
    });

    it('MANAGER (WAREHOUSE_MANAGER) can invite', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({ firstName: 'Mgr', lastName: 'Invited', email: `mgr-invited-${Date.now()}@example.test`, role: UserRole.DRIVER });
      expect(res.status).toBe(201);
    });

    it('TENANT_ADMIN cannot invite (explicit policy: OWNER/MANAGER only)', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ firstName: 'Admin', lastName: 'Tried', email: `admin-invited-${Date.now()}@example.test`, role: UserRole.WAREHOUSE_STAFF });
      expect(res.status).toBe(403);
    });

    it('WAREHOUSE_STAFF cannot invite', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send({ firstName: 'Staff', lastName: 'Tried', email: `staff-invited-${Date.now()}@example.test`, role: UserRole.WAREHOUSE_STAFF });
      expect(res.status).toBe(403);
    });
  });

  describe('duplicate prevention', () => {
    it('rejects inviting an email that already belongs to an existing user in the tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Dup', lastName: 'User', email: tenantA.user.email, role: UserRole.WAREHOUSE_STAFF });
      expect(res.status).toBe(400);
    });

    it('rejects a second invite while one is already pending for the same email', async () => {
      const email = `dup-pending-${Date.now()}@example.test`;
      const first = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'First', lastName: 'Invite', email, role: UserRole.WAREHOUSE_STAFF });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Second', lastName: 'Invite', email, role: UserRole.DRIVER });
      expect(second.status).toBe(400);
      expect(second.body.message).toMatch(/resend/i);
    });
  });

  describe('accept-invite preview', () => {
    it('shows a valid preview for a real pending token', async () => {
      const email = `preview-${Date.now()}@example.test`;
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Preview', lastName: 'Person', email, role: UserRole.CUSTOMER_SERVICE })
        .expect(201);
      const token = extractToken(sent[0]);

      const res = await request(app.getHttpServer()).get(`/auth/accept-invite/${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ valid: true, email, firstName: 'Preview', lastName: 'Person' });
      expect(res.body.tenantName).toBeTruthy();
    });

    it('reports invalid for a garbage token', async () => {
      const res = await request(app.getHttpServer()).get('/auth/accept-invite/not-a-real-token');
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toBe('not_found');
    });
  });

  describe('accepting an invitation', () => {
    it('creates the User with the inviter-supplied name/email/role, activates it, and the employee can log in with their own password (never seen by the inviter)', async () => {
      const email = `accept-${Date.now()}@example.test`;
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Accepted', lastName: 'Employee', email, role: UserRole.ACCOUNTANT })
        .expect(201);
      const token = extractToken(sent[0]);

      const employeePassword = 'MyOwnPassword123!';
      const acceptRes = await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token, password: employeePassword, confirmPassword: employeePassword });
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body).toEqual({ success: true });

      // The account is now real, active, and scoped to the right tenant/role.
      const user = await prisma.user.findFirst({ where: { email, tenantId: tenantA.tenantId } });
      expect(user).toBeTruthy();
      expect(user!.firstName).toBe('Accepted');
      expect(user!.lastName).toBe('Employee');
      expect(user!.role).toBe(UserRole.ACCOUNTANT);
      expect(user!.isActive).toBe(true);

      // The employee can sign in with the password *they* chose.
      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email, password: employeePassword });
      expect(loginRes.status).toBe(200);

      // The invitation itself never carried a password field anywhere in its lifecycle.
      const invitation = await prisma.tenantInvitation.findFirst({ where: { email, tenantId: tenantA.tenantId } });
      expect(invitation!.status).toBe('ACCEPTED');
      expect(invitation!.acceptedAt).toBeTruthy();
      expect(Object.keys(invitation!)).not.toContain('password');
    });

    it('rejects reusing an already-accepted invitation token', async () => {
      const email = `reuse-${Date.now()}@example.test`;
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Reuse', lastName: 'Test', email, role: UserRole.DRIVER })
        .expect(201);
      const token = extractToken(sent[0]);
      const password = 'FirstAcceptOnly1!';

      await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token, password, confirmPassword: password })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token, password: 'SecondAttempt1!', confirmPassword: 'SecondAttempt1!' });
      expect(second.status).toBe(400);
    });

    it('rejects an expired invitation token', async () => {
      const email = `expired-${Date.now()}@example.test`;
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Expired', lastName: 'Test', email, role: UserRole.DRIVER })
        .expect(201);
      const token = extractToken(sent[0]);

      await prisma.tenantInvitation.update({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token, password: 'TooLatePass123!', confirmPassword: 'TooLatePass123!' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);

      const preview = await request(app.getHttpServer()).get(`/auth/accept-invite/${token}`);
      expect(preview.body).toEqual({ valid: false, reason: 'expired' });
    });

    it('rejects mismatched password/confirmPassword before ever touching the token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token: 'irrelevant-token', password: 'SomePassword1!', confirmPassword: 'DifferentPassword1!' });
      expect(res.status).toBe(400);
    });
  });

  describe('resend invalidates the previous token', () => {
    it('makes the old link stop working and the new one work', async () => {
      const email = `resend-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Resend', lastName: 'Test', email, role: UserRole.DESTINATION_AGENT })
        .expect(201);
      const oldToken = extractToken(sent[0]);
      const invitationId = inviteRes.body.id;

      const resendRes = await request(app.getHttpServer())
        .post(`/users/invitations/${invitationId}/resend`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(resendRes.status).toBe(201);
      expect(sent).toHaveLength(2);
      const newToken = extractToken(sent[1]);
      expect(newToken).not.toBe(oldToken);

      const oldAttempt = await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token: oldToken, password: 'ShouldNotWork1!', confirmPassword: 'ShouldNotWork1!' });
      expect(oldAttempt.status).toBe(400);

      const newAttempt = await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token: newToken, password: 'ShouldWork123!', confirmPassword: 'ShouldWork123!' });
      expect(newAttempt.status).toBe(200);
    });

    it('cannot resend an already-accepted invitation', async () => {
      const email = `resend-accepted-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Already', lastName: 'Accepted', email, role: UserRole.DRIVER })
        .expect(201);
      const token = extractToken(sent[0]);
      const password = 'Accepted123!';
      await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token, password, confirmPassword: password })
        .expect(200);

      const resendRes = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/resend`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(resendRes.status).toBe(400);
    });
  });

  describe('tenant isolation', () => {
    it('lists only the caller\'s own tenant\'s invitations', async () => {
      const res = await request(app.getHttpServer()).get('/users/invitations').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((i: { id: string }) => i.id);
      const allBelongToTenantA = await Promise.all(
        ids.map(async (id) => {
          const row = await prisma.tenantInvitation.findUnique({ where: { id } });
          return row?.tenantId === tenantA.tenantId;
        }),
      );
      expect(allBelongToTenantA.every(Boolean)).toBe(true);
    });

    it('cannot resend a tenant B invitation using tenant A\'s owner token', async () => {
      const tokenB = await login(app, tenantB.user.email, tenantB.user.password);
      const email = `tenantb-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ firstName: 'TenantB', lastName: 'Invite', email, role: UserRole.WAREHOUSE_STAFF })
        .expect(201);

      const crossTenantResend = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/resend`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(crossTenantResend.status).toBe(404);
    });
  });

  describe('the onboarding wizard\'s own Staff step (POST /onboarding/staff/invite) still works after delegating to StaffInvitationsService', () => {
    it('OWNER can invite via the onboarding route', async () => {
      const res = await request(app.getHttpServer())
        .post('/onboarding/staff/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Onboard', lastName: 'Wizard', email: `onboarding-owner-${Date.now()}@example.test`, role: UserRole.WAREHOUSE_STAFF });
      expect(res.status).toBe(201);
      expect(res.body.firstName).toBe('Onboard');
    });

    it('MANAGER can also invite via the onboarding route (same OWNER/MANAGER-only rule, overriding ONBOARDING_ROLES for this one handler)', async () => {
      const res = await request(app.getHttpServer())
        .post('/onboarding/staff/invite')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({ firstName: 'Onboard', lastName: 'Manager', email: `onboarding-mgr-${Date.now()}@example.test`, role: UserRole.DRIVER });
      expect(res.status).toBe(201);
    });

    it('TENANT_ADMIN cannot invite via the onboarding route either, despite ONBOARDING_ROLES normally including TENANT_ADMIN for every other onboarding endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post('/onboarding/staff/invite')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ firstName: 'Onboard', lastName: 'Admin', email: `onboarding-admin-${Date.now()}@example.test`, role: UserRole.WAREHOUSE_STAFF });
      expect(res.status).toBe(403);
    });

    it('TENANT_ADMIN can still reach other onboarding endpoints normally (this stage did not touch ONBOARDING_ROLES itself)', async () => {
      const res = await request(app.getHttpServer()).get('/onboarding').set('Authorization', `Bearer ${adminTokenA}`);
      expect(res.status).toBe(200);
    });
  });

  it('leaves existing login/RBAC for pre-existing roles fully intact', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: tenantA.user.email, password: tenantA.user.password });
    expect(res.status).toBe(200);
    expect(res.body.user.tenantId).toBe(tenantA.tenantId);
  });
});

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
