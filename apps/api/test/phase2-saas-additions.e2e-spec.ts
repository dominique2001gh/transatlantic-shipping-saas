import { INestApplication } from '@nestjs/common';
import { EntitlementFeature, PrismaClient, SubscriptionStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { BillingSchedulerService } from '../src/subscriptions/billing-scheduler.service';
import { createTestTenant, createUserInTenant, deleteTestTenant, TEST_PASSWORD, type TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(60_000);

/**
 * AnanseLogix Phase 2: proves the site-config (Section 15) data API, the
 * exhaustive entitlement gating added across the core operational
 * controllers, the platform-wide SaaS analytics endpoint's RBAC, and the
 * real scheduled billing-status sweep (BillingSchedulerService) —
 * exercised directly rather than waiting for its hourly @Cron trigger,
 * the same "call the service method the job invokes, don't wait for the
 * scheduler" approach any cron-backed feature needs to be testable at all.
 */
describe('AnanseLogix Phase 2 additions (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let planId: string;
  let ownedPlan = false;

  beforeAll(async () => {
    app = await createTestApp();

    let plan = await prisma.saasPlan.findUnique({ where: { key: 'SOFTWARE_ONLY' } });
    if (!plan) {
      plan = await prisma.saasPlan.create({ data: { key: 'SOFTWARE_ONLY', name: 'E2E Phase 2 Software Only' } });
      ownedPlan = true;
    }
    planId = plan.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    if (ownedPlan) await prisma.saasPlan.delete({ where: { id: planId } }).catch(() => undefined);
    await prisma.$disconnect();
  }, 30_000);

  async function createSubscribedTenant(label: string, status: SubscriptionStatus = SubscriptionStatus.ACTIVE): Promise<TestTenantFixture> {
    const fixture = await createTestTenant(prisma, label, UserRole.TENANT_ADMIN);
    await prisma.tenantSubscription.create({
      data: {
        tenantId: fixture.tenantId,
        stripeCustomerId: `cus_test_fake_${randomUUID()}`,
        stripeSubscriptionId: `sub_test_fake_${randomUUID()}`,
        planId,
        status,
      },
    });
    return fixture;
  }

  describe('Public site-config (Section 15)', () => {
    it('returns the real seeded Trans Atlantic tenant unaffected — proves this feature never touched existing data', async () => {
      const res = await request(app.getHttpServer()).get('/public/site-config/transatlantic');
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe('transatlantic');
      expect(typeof res.body.companyName).toBe('string');
    });

    it('404s for a slug that does not exist — no enumeration signal', async () => {
      const res = await request(app.getHttpServer()).get(`/public/site-config/does-not-exist-${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it('404s for a tenant whose plan does not include PUBLIC_WEBSITE', async () => {
      const fixture = await createSubscribedTenant('SiteCfgDenied');
      await prisma.tenantEntitlement.create({
        data: { tenantId: fixture.tenantId, feature: EntitlementFeature.PUBLIC_WEBSITE, enabled: false },
      });

      const res = await request(app.getHttpServer()).get(`/public/site-config/${fixture.slug}`);
      expect(res.status).toBe(404);

      await deleteTestTenant(prisma, fixture.tenantId);
    });

    it('a grandfathered tenant (no subscription row) is served regardless of entitlements', async () => {
      const fixture = await createTestTenant(prisma, 'SiteCfgGrandfathered', UserRole.TENANT_ADMIN);
      const res = await request(app.getHttpServer()).get(`/public/site-config/${fixture.slug}`);
      expect(res.status).toBe(200);
      await deleteTestTenant(prisma, fixture.tenantId);
    });

    it('an authenticated tenant admin can read and update their own site-config, and the public endpoint reflects it', async () => {
      const fixture = await createSubscribedTenant('SiteCfgOwner');
      await prisma.tenantEntitlement.create({
        data: { tenantId: fixture.tenantId, feature: EntitlementFeature.PUBLIC_WEBSITE, enabled: true },
      });
      const token = await login(app, fixture.user.email, fixture.user.password);

      const before = await request(app.getHttpServer()).get('/site-config').set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);
      expect(before.body.tagline).toBeUndefined();

      const update = await request(app.getHttpServer())
        .patch('/site-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ tagline: 'Fast, reliable freight forwarding', serviceTypes: ['Ocean', 'Air'] });
      expect(update.status).toBe(200);

      const publicView = await request(app.getHttpServer()).get(`/public/site-config/${fixture.slug}`);
      expect(publicView.status).toBe(200);
      expect(publicView.body.tagline).toBe('Fast, reliable freight forwarding');
      expect(publicView.body.serviceTypes).toEqual(['Ocean', 'Air']);

      const locationsRes = await request(app.getHttpServer())
        .put('/site-config/locations')
        .set('Authorization', `Bearer ${token}`)
        .send({ locations: [{ label: 'Main Office', city: 'Accra', country: 'Ghana' }] });
      expect(locationsRes.status).toBe(200);
      expect(locationsRes.body).toHaveLength(1);
      expect(locationsRes.body[0].city).toBe('Accra');

      await deleteTestTenant(prisma, fixture.tenantId);
    });

    it('a CUSTOMER-role token (not an onboarding role) is denied write access', async () => {
      const fixture = await createTestTenant(prisma, 'SiteCfgCustomerDenied', UserRole.CUSTOMER);
      const token = await login(app, fixture.user.email, fixture.user.password);
      const res = await request(app.getHttpServer()).patch('/site-config').set('Authorization', `Bearer ${token}`).send({ tagline: 'nope' });
      expect(res.status).toBe(403);
      await deleteTestTenant(prisma, fixture.tenantId);
    });
  });

  describe('Exhaustive entitlement gating on core operational controllers', () => {
    it('a tenant without OPERATIONS_SOFTWARE is denied on /customers, /shipments, and /invoices alike', async () => {
      const fixture = await createSubscribedTenant('OpsSoftwareDenied');
      await prisma.tenantEntitlement.create({
        data: { tenantId: fixture.tenantId, feature: EntitlementFeature.OPERATIONS_SOFTWARE, enabled: false },
      });
      const token = await login(app, fixture.user.email, fixture.user.password);

      const customers = await request(app.getHttpServer()).get('/customers').set('Authorization', `Bearer ${token}`);
      const shipments = await request(app.getHttpServer()).get('/shipments').set('Authorization', `Bearer ${token}`);
      const invoices = await request(app.getHttpServer()).get('/invoices').set('Authorization', `Bearer ${token}`);

      expect(customers.status).toBe(403);
      expect(shipments.status).toBe(403);
      expect(invoices.status).toBe(403);
      expect(customers.body.message).toMatch(/does not include this feature/i);

      await deleteTestTenant(prisma, fixture.tenantId);
    });

    it('the same tenant with OPERATIONS_SOFTWARE enabled is allowed through (RolesGuard/tenant-scoping still applies underneath)', async () => {
      const fixture = await createSubscribedTenant('OpsSoftwareAllowed');
      await prisma.tenantEntitlement.create({
        data: { tenantId: fixture.tenantId, feature: EntitlementFeature.OPERATIONS_SOFTWARE, enabled: true },
      });
      const token = await login(app, fixture.user.email, fixture.user.password);

      const customers = await request(app.getHttpServer()).get('/customers').set('Authorization', `Bearer ${token}`);
      expect(customers.status).toBe(200);

      await deleteTestTenant(prisma, fixture.tenantId);
    });

    it('a CUSTOMER_PORTAL-disabled tenant is denied on /portal/me', async () => {
      const fixture = await createSubscribedTenant('PortalDenied');
      await prisma.tenantEntitlement.create({
        data: { tenantId: fixture.tenantId, feature: EntitlementFeature.CUSTOMER_PORTAL, enabled: false },
      });
      const customer = await createUserInTenant(prisma, fixture.tenantId, 'PortalCustomer', UserRole.CUSTOMER);
      // Give this CUSTOMER user a linked Customer row so it isn't rejected for an unrelated reason first.
      await prisma.customer.create({
        data: { tenantId: fixture.tenantId, customerNumber: `E2E-${randomUUID().slice(0, 8)}`, firstName: 'E2E', lastName: 'Portal', email: customer.email, userId: customer.id },
      });
      const token = await login(app, customer.email, customer.password);

      const res = await request(app.getHttpServer()).get('/portal/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);

      await deleteTestTenant(prisma, fixture.tenantId);
    });
  });

  describe('Platform SaaS analytics RBAC', () => {
    it('a tenant staff token is denied', async () => {
      const fixture = await createTestTenant(prisma, 'AnalyticsDenied');
      const token = await login(app, fixture.user.email, fixture.user.password);
      const res = await request(app.getHttpServer()).get('/platform/saas-analytics').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      await deleteTestTenant(prisma, fixture.tenantId);
    });

    it('a PLATFORM_ADMIN succeeds and gets the expected shape', async () => {
      const admin = await prisma.user.create({
        data: {
          tenantId: null,
          email: `platform-admin-analytics-${randomUUID()}@example.test`,
          passwordHash: await bcrypt.hash(TEST_PASSWORD, 10),
          firstName: 'E2E',
          lastName: 'PlatformAdmin',
          role: UserRole.PLATFORM_ADMIN,
        },
      });
      const adminToken = await login(app, admin.email, TEST_PASSWORD);

      const res = await request(app.getHttpServer()).get('/platform/saas-analytics').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.signupStarts).toBe('number');
      expect(Array.isArray(res.body.planDistribution)).toBe(true);

      await prisma.user.delete({ where: { id: admin.id } });
    });
  });

  describe('BillingSchedulerService (real scheduled billing-status sweep)', () => {
    it('suspends a PAST_DUE subscription whose grace period has already expired, and leaves one still in grace alone', async () => {
      const expired = await createSubscribedTenant('GraceExpired', SubscriptionStatus.PAST_DUE);
      const stillInGrace = await createSubscribedTenant('GraceActive', SubscriptionStatus.PAST_DUE);

      await prisma.tenantSubscription.update({
        where: { tenantId: expired.tenantId },
        data: { gracePeriodEndsAt: new Date(Date.now() - 60_000) }, // 1 minute in the past
      });
      await prisma.tenantSubscription.update({
        where: { tenantId: stillInGrace.tenantId },
        data: { gracePeriodEndsAt: new Date(Date.now() + 60 * 60_000) }, // 1 hour from now
      });

      const scheduler = app.get(BillingSchedulerService);
      await scheduler.sweepExpiredGracePeriods();

      const expiredSub = await prisma.tenantSubscription.findUnique({ where: { tenantId: expired.tenantId } });
      const stillInGraceSub = await prisma.tenantSubscription.findUnique({ where: { tenantId: stillInGrace.tenantId } });

      expect(expiredSub?.status).toBe('SUSPENDED');
      expect(stillInGraceSub?.status).toBe('PAST_DUE');

      await deleteTestTenant(prisma, expired.tenantId);
      await deleteTestTenant(prisma, stillInGrace.tenantId);
    });
  });
});

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
