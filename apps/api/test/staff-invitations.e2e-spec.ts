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
  fromName?: string;
  fromAddress?: string;
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
  let secondOwnerA: { id: string; email: string; password: string };
  let staffA: { id: string; email: string; password: string };
  let financeA: { id: string; email: string; password: string };
  let ownerTokenA: string;
  let managerTokenA: string;
  let secondOwnerTokenA: string;
  let staffTokenA: string;
  let financeTokenA: string;

  beforeAll(async () => {
    // Multi-tenant branding/routing fix (2026-09): set explicitly (rather
    // than relying on whatever .env happens to have) so the hostname
    // assertions below are meaningful regardless of local dev config —
    // dotenv (used by @nestjs/config's ConfigModule) never overwrites an
    // already-set process.env value, so setting these before the module
    // compiles below is what actually takes effect.
    process.env.ANANSELOGIX_BASE_URL = 'https://ananselogix.com';
    process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG = 'transatlantic';
    process.env.WEB_APP_URL = 'https://app.talogisticssolutions.com';

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

    tenantA = await createTestTenant(prisma, 'InviteA', UserRole.OWNER);
    tenantB = await createTestTenant(prisma, 'InviteB', UserRole.OWNER);
    managerA = await createUserInTenant(prisma, tenantA.tenantId, 'Manager', UserRole.MANAGER);
    secondOwnerA = await createUserInTenant(prisma, tenantA.tenantId, 'Owner2', UserRole.OWNER);
    staffA = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.STAFF);
    financeA = await createUserInTenant(prisma, tenantA.tenantId, 'Finance', UserRole.FINANCE);

    ownerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    managerTokenA = await login(app, managerA.email, managerA.password);
    secondOwnerTokenA = await login(app, secondOwnerA.email, secondOwnerA.password);
    staffTokenA = await login(app, staffA.email, staffA.password);
    financeTokenA = await login(app, financeA.email, financeA.password);

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

  /**
   * RBAC V1: staff administration (inviting included) is OWNER only —
   * "Managers may view the tenant's staff/users and their roles, but may
   * not invite users, change roles, deactivate/reactivate users, promote
   * anyone to OWNER, or otherwise administer user access. Those actions
   * remain OWNER-only." A second OWNER account has exactly the same
   * invite power as the first — there is no narrower "admin but not
   * owner" tier anymore (the old TENANT_ADMIN role merged into OWNER).
   */
  describe('who can invite', () => {
    it('OWNER can invite', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'New', lastName: 'Hire', email: `owner-invited-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(201);
      expect(res.body.firstName).toBe('New');
      expect(res.body.status).toBe('PENDING');
      expect(sent).toHaveLength(1);
    });

    /**
     * Sender-identity fix (2026-09, platform-branding): the invitation
     * email must identify as AnanseLogix — never this test fixture
     * tenant's own name, and never whatever EMAIL_FROM_NAME happens to be
     * configured to (that env var is scoped to a *different* tenant's own
     * customer-facing notifications — see resolvePlatformEmailSender's own
     * doc comment for the exact bug this regression-tests).
     */
    it('the invitation email identifies its sender as AnanseLogix, never the inviting tenant\'s own name', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Sender', lastName: 'Check', email: `sender-check-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(201);

      const email = sent[sent.length - 1];
      expect(email.fromName).toBe('AnanseLogix');
      expect(email.fromName).not.toMatch(/InviteA/i); // this fixture tenant's own name
    });

    it('a second OWNER account can also invite — OWNER is not a single-account special case', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${secondOwnerTokenA}`)
        .send({ firstName: 'Second', lastName: 'Owner', email: `second-owner-invited-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(201);
    });

    it('MANAGER cannot invite — staff oversight is view-only for MANAGER', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({ firstName: 'Mgr', lastName: 'Invited', email: `mgr-invited-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(403);
    });

    it('STAFF cannot invite', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send({ firstName: 'Staff', lastName: 'Tried', email: `staff-invited-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(403);
    });

    it('FINANCE cannot invite', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${financeTokenA}`)
        .send({ firstName: 'Finance', lastName: 'Tried', email: `finance-invited-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(403);
    });

    it('rejects an invite attempting to assign PLATFORM_ADMIN — never reachable through this staff-only flow, regardless of caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Escalation', lastName: 'Attempt', email: `escalation-${Date.now()}@example.test`, role: 'PLATFORM_ADMIN' });
      expect(res.status).toBe(400);
    });

    it('rejects an invite attempting to assign CUSTOMER — a portal end-user role, never invited through this staff-only flow', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Escalation', lastName: 'Attempt', email: `escalation2-${Date.now()}@example.test`, role: 'CUSTOMER' });
      expect(res.status).toBe(400);
    });
  });

  describe('duplicate prevention', () => {
    it('rejects inviting an email that already belongs to an existing user in the tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Dup', lastName: 'User', email: tenantA.user.email, role: UserRole.STAFF });
      expect(res.status).toBe(400);
    });

    it('rejects a second invite while one is already pending for the same email', async () => {
      const email = `dup-pending-${Date.now()}@example.test`;
      const first = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'First', lastName: 'Invite', email, role: UserRole.STAFF });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Second', lastName: 'Invite', email, role: UserRole.STAFF });
      expect(second.status).toBe(400);
      expect(second.body.message).toMatch(/resend/i);
    });

    /**
     * Staff invitation UI fix (2026-09): two genuinely concurrent invite
     * requests for the same email (e.g. a double form submission) must
     * never both create a live invitation — the application-level
     * pre-check alone has a race window; migration 20260915000000's
     * partial unique index is the actual guarantee, exercised here by
     * firing both requests together rather than sequentially.
     */
    it('exactly one of two concurrent invite requests for the same email succeeds — no duplicate invitation is ever created', async () => {
      const email = `race-${Date.now()}@example.test`;
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/users/invite')
          .set('Authorization', `Bearer ${ownerTokenA}`)
          .send({ firstName: 'Race', lastName: 'One', email, role: UserRole.STAFF }),
        request(app.getHttpServer())
          .post('/users/invite')
          .set('Authorization', `Bearer ${ownerTokenA}`)
          .send({ firstName: 'Race', lastName: 'Two', email, role: UserRole.STAFF }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 400]);

      const rejected = first.status === 400 ? first : second;
      expect(rejected.body.message).toMatch(/already pending|resend/i);

      const liveInvitations = await prisma.tenantInvitation.findMany({
        where: { tenantId: tenantA.tenantId, email, status: 'PENDING' },
      });
      expect(liveInvitations).toHaveLength(1);
    });
  });

  /**
   * Multi-tenant branding/routing fix (2026-09): the root cause of the
   * reported bug — every invitation's Accept Invitation URL was built
   * from the one global WEB_APP_URL (Trans Atlantic's own production
   * domain), regardless of which tenant was actually being invited. These
   * assert the fix directly against the real HTTP surface (not just the
   * pure resolveTenantWebAppUrl function — see tenant-web-app-url.e2e-spec.ts
   * for that), including through `resend`, which shares the exact same
   * code path.
   */
  describe('accept-invite URL hostname', () => {
    it('a platform-hosted tenant (no configured custom domain, not the legacy slug — e.g. Tatanic) gets an ANANSELOGIX_BASE_URL link', async () => {
      const email = `hostname-platform-${Date.now()}@example.test`;
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Hostname', lastName: 'Platform', email, role: UserRole.STAFF });
      expect(res.status).toBe(201);

      const sentEmail = sent[sent.length - 1];
      expect(sentEmail.body).toMatch(/https:\/\/ananselogix\.com\/accept-invite\?token=/);
      expect(sentEmail.body).not.toMatch(/talogisticssolutions\.com/);
    });

    it('resend regenerates the link on the same (platform) host, not Trans Atlantic\'s', async () => {
      const email = `hostname-resend-${Date.now()}@example.test`;
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Hostname', lastName: 'Resend', email, role: UserRole.STAFF });
      expect(inviteRes.status).toBe(201);

      const resendRes = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/resend`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(resendRes.status).toBe(201);

      const resentEmail = sent[sent.length - 1];
      expect(resentEmail.body).toMatch(/https:\/\/ananselogix\.com\/accept-invite\?token=/);
      expect(resentEmail.body).not.toMatch(/talogisticssolutions\.com/);
    });

    /**
     * Uses the real, already-seeded "transatlantic" tenant (local dev DB
     * only — never production, see apps/api/.env's DATABASE_URL) rather
     * than a fixture tenant, since the legacy-slug branch keys off the
     * exact slug "transatlantic" — a fixture tenant's generated slug
     * (e2e-...) can never match it. Only ever reads that tenant and adds/
     * removes its own throwaway invitation + staff user; the tenant row
     * itself and its existing users/data are never modified.
     */
    it("Trans Atlantic's own invitations keep using its real production domain (WEB_APP_URL), unchanged", async () => {
      const transAtlantic = await prisma.tenant.findFirst({ where: { slug: 'transatlantic' } });
      if (!transAtlantic) {
        throw new Error('Expected the seeded "transatlantic" tenant to exist in the local dev database for this test.');
      }

      const taOwner = await prisma.user.findFirst({ where: { tenantId: transAtlantic.id, role: UserRole.OWNER, isActive: true } });
      if (!taOwner) {
        throw new Error('Expected the seeded "transatlantic" tenant to have at least one active OWNER for this test.');
      }

      // This throwaway user has no known password (it's the real seeded
      // account) — invite directly through the service-level call shape
      // instead of logging in as it: exercise the same HTTP route, but
      // authenticate as a freshly-created OWNER scoped to this same real
      // tenant instead, so this test never needs (or risks depending on)
      // the seeded account's actual credentials.
      const throwawayOwner = await createUserInTenant(prisma, transAtlantic.id, 'TAOwnerCheck', UserRole.OWNER);
      const throwawayOwnerToken = await login(app, throwawayOwner.email, throwawayOwner.password);

      const email = `hostname-ta-${Date.now()}@example.test`;
      try {
        const res = await request(app.getHttpServer())
          .post('/users/invite')
          .set('Authorization', `Bearer ${throwawayOwnerToken}`)
          .send({ firstName: 'Hostname', lastName: 'TransAtlantic', email, role: UserRole.STAFF });
        expect(res.status).toBe(201);

        const sentEmail = sent[sent.length - 1];
        expect(sentEmail.body).toMatch(/https:\/\/app\.talogisticssolutions\.com\/accept-invite\?token=/);

        await prisma.tenantInvitation.deleteMany({ where: { tenantId: transAtlantic.id, email } });
      } finally {
        await prisma.user.delete({ where: { id: throwawayOwner.id } });
      }
    });
  });

  describe('accept-invite preview', () => {
    it('shows a valid preview for a real pending token', async () => {
      const email = `preview-${Date.now()}@example.test`;
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Preview', lastName: 'Person', email, role: UserRole.STAFF })
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
        .send({ firstName: 'Accepted', lastName: 'Employee', email, role: UserRole.FINANCE })
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
      expect(user!.role).toBe(UserRole.FINANCE);
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
        .send({ firstName: 'Reuse', lastName: 'Test', email, role: UserRole.STAFF })
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
        .send({ firstName: 'Expired', lastName: 'Test', email, role: UserRole.STAFF })
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
        .send({ firstName: 'Resend', lastName: 'Test', email, role: UserRole.STAFF })
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
        .send({ firstName: 'Already', lastName: 'Accepted', email, role: UserRole.STAFF })
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
        .send({ firstName: 'TenantB', lastName: 'Invite', email, role: UserRole.STAFF })
        .expect(201);

      const crossTenantResend = await request(app.getHttpServer())
        .post(`/users/invitations/${inviteRes.body.id}/resend`)
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(crossTenantResend.status).toBe(404);
    });

    /**
     * Multi-tenant branding/routing fix (2026-09): explicit regression for
     * "the invitation token must resolve only the tenant/user it belongs
     * to. Never infer or expose another tenant from a fallback." Each
     * token is looked up by its own globally-unique tokenHash — there is
     * no shared/fallback lookup path a token could ever resolve through
     * to reach a different tenant's data, but this proves it end to end
     * with two real invitations against two real tenants rather than
     * relying on that being true only by construction.
     */
    it("a tenant's invitation token resolves only that tenant's own name/data, never another tenant's — even for two invitations created back to back", async () => {
      const tokenB = await login(app, tenantB.user.email, tenantB.user.password);
      const [tenantARow, tenantBRow] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({ where: { id: tenantA.tenantId } }),
        prisma.tenant.findUniqueOrThrow({ where: { id: tenantB.tenantId } }),
      ]);

      const emailA = `cross-tenant-a-${Date.now()}@example.test`;
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'CrossTenant', lastName: 'A', email: emailA, role: UserRole.STAFF })
        .expect(201);
      const tokenForA = extractToken(sent[sent.length - 1]);

      const emailB = `cross-tenant-b-${Date.now()}@example.test`;
      await request(app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ firstName: 'CrossTenant', lastName: 'B', email: emailB, role: UserRole.STAFF })
        .expect(201);
      const tokenForB = extractToken(sent[sent.length - 1]);

      const previewA = await request(app.getHttpServer()).get(`/auth/accept-invite/${tokenForA}`);
      expect(previewA.body).toMatchObject({ valid: true, email: emailA, tenantName: tenantARow.name });
      expect(previewA.body.tenantName).not.toBe(tenantBRow.name);

      const previewB = await request(app.getHttpServer()).get(`/auth/accept-invite/${tokenForB}`);
      expect(previewB.body).toMatchObject({ valid: true, email: emailB, tenantName: tenantBRow.name });
      expect(previewB.body.tenantName).not.toBe(tenantARow.name);

      // Accepting tenant A's token must create a user scoped to tenant A
      // only — never tenant B, regardless of which token was issued more
      // recently or which tenant's owner is currently authenticated.
      await request(app.getHttpServer())
        .post('/auth/accept-invite')
        .send({ token: tokenForA, password: 'CrossTenantCheck1!', confirmPassword: 'CrossTenantCheck1!' })
        .expect(200);
      const createdUser = await prisma.user.findFirst({ where: { email: emailA } });
      expect(createdUser?.tenantId).toBe(tenantA.tenantId);
      expect(createdUser?.tenantId).not.toBe(tenantB.tenantId);
    });
  });

  describe('the onboarding wizard\'s own Staff step (POST /onboarding/staff/invite) still works after delegating to StaffInvitationsService', () => {
    it('OWNER can invite via the onboarding route', async () => {
      const res = await request(app.getHttpServer())
        .post('/onboarding/staff/invite')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ firstName: 'Onboard', lastName: 'Wizard', email: `onboarding-owner-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(201);
      expect(res.body.firstName).toBe('Onboard');
    });

    it('a second OWNER account can also invite via the onboarding route — no method-level override is needed anymore, since ONBOARDING_ROLES is already OWNER-only', async () => {
      const res = await request(app.getHttpServer())
        .post('/onboarding/staff/invite')
        .set('Authorization', `Bearer ${secondOwnerTokenA}`)
        .send({ firstName: 'Onboard', lastName: 'Owner2', email: `onboarding-owner2-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(201);
    });

    it('MANAGER cannot invite via the onboarding route (staff administration is OWNER-only everywhere, including this route)', async () => {
      const res = await request(app.getHttpServer())
        .post('/onboarding/staff/invite')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send({ firstName: 'Onboard', lastName: 'Manager', email: `onboarding-mgr-${Date.now()}@example.test`, role: UserRole.STAFF });
      expect(res.status).toBe(403);
    });

    it('OWNER can still reach other onboarding endpoints normally', async () => {
      const res = await request(app.getHttpServer()).get('/onboarding').set('Authorization', `Bearer ${secondOwnerTokenA}`);
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
