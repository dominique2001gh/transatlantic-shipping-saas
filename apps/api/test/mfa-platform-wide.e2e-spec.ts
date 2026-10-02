import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  createCustomerWithPortalUser,
  createTestTenant,
  createUserInTenant,
  deleteTestTenant,
  TEST_PASSWORD,
  TestTenantFixture,
} from './utils/fixtures';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Platform-wide staff MFA (2026-10): the dedicated regression suite for
 * requirement 14's full checklist. Deliberately does NOT re-prove
 * scenarios already covered end-to-end elsewhere (new-tenant-owner
 * enrollment lives in free-trial.e2e-spec.ts, invited-staff enrollment in
 * staff-invitations.e2e-spec.ts, password-reset interaction in
 * password-reset.e2e-spec.ts) — this file is the single source for
 * everything else: role coverage, enrollment/challenge mechanics, stage-
 * token misuse, factor replacement, and the platform-admin recovery path.
 */
describe('Platform-wide staff MFA (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;

  beforeAll(async () => {
    // This suite's own call volume (many enroll/challenge round-trips
    // across many tests, all from the same test-runner "IP", well within
    // the same minute) would otherwise trip the real
    // @Throttle({ limit: 10, ttl: 60_000 }) on /auth/mfa/setup/verify and
    // /auth/mfa/challenge — a real, working safeguard, just not what
    // these tests are about. Matches password-reset.e2e-spec.ts's own
    // established pattern for isolating a suite from this concern.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenantA = await createTestTenant(prisma, 'MfaA', UserRole.OWNER);
    tenantB = await createTestTenant(prisma, 'MfaB', UserRole.OWNER);
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
    await app.close();
  });

  describe('every staff role requires MFA, CUSTOMER does not', () => {
    it.each([UserRole.OWNER, UserRole.MANAGER, UserRole.STAFF, UserRole.FINANCE])(
      '%s: first login returns mfaRequired, never a direct session',
      async (role) => {
        const user = await createUserInTenant(prisma, tenantA.tenantId, `role-${role}`, role);
        const res = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
        expect(res.status).toBe(200);
        expect(res.body.accessToken).toBeUndefined();
        expect(res.body.mfaRequired).toBe(true);
        expect(res.body.mfaEnrolled).toBe(false);
        expect(typeof res.body.mfaToken).toBe('string');
      },
    );

    it('CUSTOMER logs in directly, with no MFA step of any kind', async () => {
      const customer = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'MfaCustomer');
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: customer.user.email, password: customer.user.password });
      expect(res.status).toBe(200);
      expect(res.body.mfaRequired).toBeUndefined();
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.user.role).toBe(UserRole.CUSTOMER);

      const portalMe = await request(app.getHttpServer()).get('/portal/me').set('Authorization', `Bearer ${res.body.accessToken}`);
      expect(portalMe.status).toBe(200);
    });
  });

  describe('enrollment mechanics', () => {
    it('a valid code activates MFA and returns a real session plus recovery codes', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'Enroll', UserRole.STAFF);
      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const mfaToken = loginRes.body.mfaToken as string;

      const setupRes = await request(app.getHttpServer()).post('/auth/mfa/setup').set('Authorization', `Bearer ${mfaToken}`).send();
      expect(setupRes.status).toBe(201);
      expect(setupRes.body.secret).toBeTruthy();
      expect(setupRes.body.otpauthUri).toContain('otpauth://totp/');

      const verifyRes = await request(app.getHttpServer())
        .post('/auth/mfa/setup/verify')
        .set('Authorization', `Bearer ${mfaToken}`)
        .send({ code: authenticator.generate(setupRes.body.secret) });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.accessToken).toBeTruthy();
      expect(verifyRes.body.user.tenantId).toBe(tenantA.tenantId);
      expect(Array.isArray(verifyRes.body.recoveryCodes)).toBe(true);
      expect(verifyRes.body.recoveryCodes.length).toBeGreaterThan(0);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(dbUser.mfaEnabled).toBe(true);
      expect(dbUser.mfaEnrolledAt).toBeTruthy();
      // The secret is never stored in plaintext.
      expect(dbUser.mfaSecret).not.toBe(setupRes.body.secret);
    });

    it('an invalid code is rejected and MFA is not activated', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'EnrollBad', UserRole.STAFF);
      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const mfaToken = loginRes.body.mfaToken as string;
      await request(app.getHttpServer()).post('/auth/mfa/setup').set('Authorization', `Bearer ${mfaToken}`).send();

      const verifyRes = await request(app.getHttpServer())
        .post('/auth/mfa/setup/verify')
        .set('Authorization', `Bearer ${mfaToken}`)
        .send({ code: '000000' });
      expect(verifyRes.status).toBe(401);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(dbUser.mfaEnabled).toBe(false);
    });

    it('replaying a stale mfa_setup-stage token after enrollment already completed elsewhere is rejected, not a silent factor swap', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'EnrollTwice', UserRole.STAFF);

      // Two logins in quick succession before either enrolls — both get
      // a setup-stage token, simulating a race (e.g. two tabs).
      const staleFirstLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      expect(staleFirstLogin.body.mfaEnrolled).toBe(false);
      const staleSetupToken = staleFirstLogin.body.mfaToken as string;

      // The second one actually completes enrollment.
      await completeStaffLogin(app, user.email, user.password);
      const dbUserAfterEnroll = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(dbUserAfterEnroll.mfaEnabled).toBe(true);

      // The first (stale) token's STAGE claim is still validly "mfa_setup"
      // (it hasn't expired), so MfaStageGuard alone would let it through —
      // this proves MfaService.beginSetup's own mfaEnabled check is what
      // actually stops the replay, not just the stage guard.
      const res = await request(app.getHttpServer()).post('/auth/mfa/setup').set('Authorization', `Bearer ${staleSetupToken}`).send();
      expect(res.status).toBe(403);

      // And the real, already-active factor is completely unaffected.
      const stillWorks = await completeStaffLogin(app, user.email, user.password);
      expect(stillWorks).toBeTruthy();
    });
  });

  describe('normal login challenge, once enrolled', () => {
    it('a valid TOTP code succeeds; an invalid one is rejected and enrollment is untouched', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'Challenge', UserRole.MANAGER);
      await completeStaffLogin(app, user.email, user.password);

      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      expect(loginRes.body.mfaEnrolled).toBe(true);
      const mfaToken = loginRes.body.mfaToken as string;

      const badChallenge = await request(app.getHttpServer())
        .post('/auth/mfa/challenge')
        .set('Authorization', `Bearer ${mfaToken}`)
        .send({ code: '111111' });
      expect(badChallenge.status).toBe(401);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(dbUser.mfaEnabled).toBe(true); // a wrong code never disables MFA

      const goodToken = await completeStaffLogin(app, user.email, user.password);
      const me = await request(app.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${goodToken}`);
      expect(me.status).toBe(200);
    });

    it('rejects a challenge with neither a code nor a recovery code, and one with both', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'ChallengeBoth', UserRole.STAFF);
      await completeStaffLogin(app, user.email, user.password);
      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const mfaToken = loginRes.body.mfaToken as string;

      const neither = await request(app.getHttpServer()).post('/auth/mfa/challenge').set('Authorization', `Bearer ${mfaToken}`).send({});
      expect(neither.status).toBe(400);

      const both = await request(app.getHttpServer())
        .post('/auth/mfa/challenge')
        .set('Authorization', `Bearer ${mfaToken}`)
        .send({ code: '123456', recoveryCode: 'AAAA-BBBB' });
      expect(both.status).toBe(400);
    });

    it('a recovery code logs in once and is consumed — a second use of the same code fails', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'Recovery', UserRole.STAFF);
      const loginRes1 = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const setupRes = await request(app.getHttpServer())
        .post('/auth/mfa/setup')
        .set('Authorization', `Bearer ${loginRes1.body.mfaToken}`)
        .send();
      const verifyRes = await request(app.getHttpServer())
        .post('/auth/mfa/setup/verify')
        .set('Authorization', `Bearer ${loginRes1.body.mfaToken}`)
        .send({ code: authenticator.generate(setupRes.body.secret) });
      const recoveryCode = verifyRes.body.recoveryCodes[0] as string;

      const loginRes2 = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const firstUse = await request(app.getHttpServer())
        .post('/auth/mfa/challenge')
        .set('Authorization', `Bearer ${loginRes2.body.mfaToken}`)
        .send({ recoveryCode });
      expect(firstUse.status).toBe(200);
      expect(firstUse.body.accessToken).toBeTruthy();

      const loginRes3 = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const secondUse = await request(app.getHttpServer())
        .post('/auth/mfa/challenge')
        .set('Authorization', `Bearer ${loginRes3.body.mfaToken}`)
        .send({ recoveryCode }); // same code again
      expect(secondUse.status).toBe(401);
    });
  });

  describe('stage tokens cannot be used to bypass MFA', () => {
    it('an mfa_challenge-stage token is rejected as a normal Bearer token on a protected staff route', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'StageMisuse', UserRole.STAFF);
      await completeStaffLogin(app, user.email, user.password);
      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const mfaToken = loginRes.body.mfaToken as string;

      // The exact "reusing a first-factor-only session" / "direct API
      // call" bypass attempt the audit asked about — rejected the same
      // way an expired/garbage token is.
      const res = await request(app.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${mfaToken}`);
      expect(res.status).toBe(401);
    });

    it('an mfa_setup-stage token cannot be used to call /auth/mfa/challenge (wrong stage)', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'WrongStage', UserRole.STAFF);
      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      expect(loginRes.body.mfaEnrolled).toBe(false); // this is a setup-stage token

      const res = await request(app.getHttpServer())
        .post('/auth/mfa/challenge')
        .set('Authorization', `Bearer ${loginRes.body.mfaToken}`)
        .send({ code: '123456' });
      expect(res.status).toBe(401);
    });

    it('a request with no token at all is rejected by the stage endpoints (fail closed, not open)', async () => {
      const res = await request(app.getHttpServer()).post('/auth/mfa/setup').send();
      expect(res.status).toBe(401);
    });
  });

  describe('tenant isolation holds after MFA', () => {
    it("an MFA-authenticated tenant A user still cannot reach tenant B's shipment", async () => {
      const userA = await createUserInTenant(prisma, tenantA.tenantId, 'IsoA', UserRole.STAFF);
      const tokenA = await completeStaffLogin(app, userA.email, userA.password);

      const shipmentB = await request(app.getHttpServer())
        .post('/shipments')
        .set('Authorization', `Bearer ${await completeStaffLogin(app, tenantB.user.email, tenantB.user.password)}`)
        .send({
          customerId: tenantB.customerId,
          shipmentMode: 'AIR',
          originCountry: 'US',
          destinationCountry: 'GH',
          originWarehouseId: tenantB.warehouseId,
          recipientName: 'Isolation Recipient',
          recipientPhone: '+15555550123',
        });
      expect(shipmentB.status).toBe(201);

      const res = await request(app.getHttpServer())
        .get(`/shipments/${shipmentB.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(404);
    });
  });

  describe('credential changes never weaken MFA', () => {
    it('an authenticated password change preserves MFA enrollment and the next login still challenges', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'ChangePw', UserRole.STAFF);
      const token = await completeStaffLogin(app, user.email, user.password);

      const newPassword = 'MfaSurvivesChange1!';
      const changeRes = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: user.password, newPassword });
      expect(changeRes.status).toBe(200);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(dbUser.mfaEnabled).toBe(true);

      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: newPassword });
      expect(loginRes.body.accessToken).toBeUndefined();
      expect(loginRes.body.mfaRequired).toBe(true);
      expect(loginRes.body.mfaEnrolled).toBe(true);
    });
  });

  describe('factor replacement is itself protected', () => {
    it('requires the correct current password — a wrong one is rejected and the old factor keeps working', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'ReplaceBadPw', UserRole.STAFF);
      const token = await completeStaffLogin(app, user.email, user.password);

      const res = await request(app.getHttpServer())
        .post('/users/me/mfa/replace')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'TotallyWrongPassword!' });
      expect(res.status).toBe(400);

      // Old factor is completely unaffected — a normal login still challenges and succeeds with it.
      const stillWorks = await completeStaffLogin(app, user.email, user.password);
      expect(stillWorks).toBeTruthy();
    });

    it('a correct password + valid new code activates the new factor and invalidates the old one', async () => {
      const user = await createUserInTenant(prisma, tenantA.tenantId, 'ReplaceOk', UserRole.STAFF);

      // Enroll manually (not via completeStaffLogin) so the test keeps
      // the original secret to prove it stops working after replacement.
      const firstLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const originalSetup = await request(app.getHttpServer())
        .post('/auth/mfa/setup')
        .set('Authorization', `Bearer ${firstLogin.body.mfaToken}`)
        .send();
      const originalSecret = originalSetup.body.secret as string;
      const enrollVerify = await request(app.getHttpServer())
        .post('/auth/mfa/setup/verify')
        .set('Authorization', `Bearer ${firstLogin.body.mfaToken}`)
        .send({ code: authenticator.generate(originalSecret) });
      const token = enrollVerify.body.accessToken as string;

      const startRes = await request(app.getHttpServer())
        .post('/users/me/mfa/replace')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: user.password });
      expect(startRes.status).toBe(201);
      const newSecret = startRes.body.secret as string;
      expect(newSecret).not.toBe(originalSecret);

      const verifyRes = await request(app.getHttpServer())
        .post('/users/me/mfa/replace/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ replaceToken: startRes.body.replaceToken, code: authenticator.generate(newSecret) });
      expect(verifyRes.status).toBe(200);
      expect(Array.isArray(verifyRes.body.recoveryCodes)).toBe(true);

      // The NEW factor works now...
      const loginRes1 = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const withNewSecret = await request(app.getHttpServer())
        .post('/auth/mfa/challenge')
        .set('Authorization', `Bearer ${loginRes1.body.mfaToken}`)
        .send({ code: authenticator.generate(newSecret) });
      expect(withNewSecret.status).toBe(200);

      // ...and the OLD factor (active before replacement) no longer does.
      const loginRes2 = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password });
      const withOldSecret = await request(app.getHttpServer())
        .post('/auth/mfa/challenge')
        .set('Authorization', `Bearer ${loginRes2.body.mfaToken}`)
        .send({ code: authenticator.generate(originalSecret) });
      expect(withOldSecret.status).toBe(401);
    });
  });

  describe('platform-admin recovery reset', () => {
    it('is rejected for a non-platform-admin caller, even the user\'s own tenant OWNER', async () => {
      const staff = await createUserInTenant(prisma, tenantA.tenantId, 'RecoveryTarget', UserRole.STAFF);
      await completeStaffLogin(app, staff.email, staff.password);
      const ownerToken = await completeStaffLogin(app, tenantA.user.email, tenantA.user.password);

      const res = await request(app.getHttpServer())
        .post(`/platform/users/${staff.id}/mfa/reset-for-recovery`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send();
      expect(res.status).toBe(403);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
      expect(dbUser.mfaEnabled).toBe(true); // untouched
    });

    it('a real PLATFORM_ADMIN can clear enrollment, forcing fresh enrollment on the next login, and it is audit-logged', async () => {
      const staff = await createUserInTenant(prisma, tenantA.tenantId, 'RecoveryTarget2', UserRole.STAFF);
      await completeStaffLogin(app, staff.email, staff.password);

      const admin = await prisma.user.create({
        data: {
          tenantId: null,
          email: `platform-admin-${Date.now()}@example.test`,
          passwordHash: await bcrypt.hash(TEST_PASSWORD, 10),
          firstName: 'Platform',
          lastName: 'Admin',
          role: UserRole.PLATFORM_ADMIN,
        },
      });
      const adminLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: admin.email, password: TEST_PASSWORD });
      expect(adminLogin.body.mfaRequired).toBeUndefined(); // PLATFORM_ADMIN is out of scope for this policy, same as CUSTOMER
      const adminToken = adminLogin.body.accessToken as string;

      const res = await request(app.getHttpServer())
        .post(`/platform/users/${staff.id}/mfa/reset-for-recovery`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send();
      expect(res.status).toBe(201);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
      expect(dbUser.mfaEnabled).toBe(false);
      expect(dbUser.mfaSecret).toBeNull();

      const remainingCodes = await prisma.mfaRecoveryCode.count({ where: { userId: staff.id } });
      expect(remainingCodes).toBe(0);

      const auditLog = await prisma.platformAuditLog.findFirst({
        where: { platformAdminUserId: admin.id, action: 'MFA_RESET_FOR_RECOVERY' },
      });
      expect(auditLog).toBeTruthy();
      expect((auditLog!.metadata as { targetUserId: string }).targetUserId).toBe(staff.id);

      // Next login forces fresh enrollment, not the old (now-cleared) factor.
      const nextLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: staff.email, password: staff.password });
      expect(nextLogin.body.mfaEnrolled).toBe(false);

      // Own what you create — the audit log row this test deliberately
      // produced has a required (non-cascading) FK to this admin, so it
      // must go first.
      await prisma.platformAuditLog.deleteMany({ where: { platformAdminUserId: admin.id } });
      await prisma.user.delete({ where: { id: admin.id } });
    });
  });
});
