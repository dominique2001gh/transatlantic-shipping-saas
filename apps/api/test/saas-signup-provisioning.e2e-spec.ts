import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { createTestTenant, deleteTestTenant, TEST_PASSWORD } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(60_000);

/**
 * AnanseLogix Phase 1: proves the self-service signup wizard, the
 * webhook-driven tenant-provisioning it triggers, and the
 * entitlement/subscription-status access-control layer built on top of it.
 *
 * Follows stripe-checkout.e2e-spec.ts's own established convention — real
 * Postgres, real Stripe test-mode API, no mocking layer. A real Checkout
 * Session can't be *completed* headlessly (no browser to enter a card), so
 * — exactly like that file already does for one-time payments — this
 * fabricates a well-formed, correctly-signed `checkout.session.completed`
 * event. The one addition specific to subscription billing: the webhook
 * handler here also calls back to Stripe to retrieve the subscription
 * object (see SubscriptionsService.handleCheckoutCompleted), so this
 * spins up a *real* active Stripe test-mode subscription first (via the
 * Subscriptions API directly, using Stripe's permanently-valid
 * `pm_card_visa` test payment method) for the fabricated event to
 * reference.
 */
describe('AnanseLogix SaaS signup + provisioning (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let stripe: Stripe;
  let webhookSecret: string;

  let planId: string;
  let ownedPlan = false;
  let ownedPriceId: string | null = null;
  let reactivatedPlan = false;

  let stripeSubscriptionId: string;

  beforeAll(async () => {
    app = await createTestApp();

    const secretKey = process.env.STRIPE_SECRET_KEY;
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    if (!secretKey || !webhookSecret) {
      throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured in apps/api/.env to run this suite.');
    }
    stripe = new Stripe(secretKey);

    // Phase 1 ships with no plans pre-configured (pricing is deliberately
    // data — see SaasPlansService's own doc comment) — reuse a SOFTWARE_ONLY
    // plan/price if a prior run or an admin already configured one, only
    // creating (and only cleaning up) what this suite itself owns.
    let plan = await prisma.saasPlan.findUnique({ where: { key: 'SOFTWARE_ONLY' } });
    if (!plan) {
      plan = await prisma.saasPlan.create({ data: { key: 'SOFTWARE_ONLY', name: 'E2E Software Only' } });
      ownedPlan = true;
    } else if (!plan.isActive) {
      // SOFTWARE_ONLY has since been retired from public sale (see
      // plan-entitlements.ts's own doc comment) — this suite only needs
      // *a* working plan+price pair to exercise the signup pipeline, so
      // it temporarily reactivates the existing row and restores it in
      // afterAll, rather than assuming its administrative state.
      await prisma.saasPlan.update({ where: { id: plan.id }, data: { isActive: true } });
      reactivatedPlan = true;
    }
    planId = plan.id;

    const existingActivePrice = await prisma.saasPlanPrice.findFirst({ where: { planId, isActive: true } });
    if (!existingActivePrice) {
      const price = await prisma.saasPlanPrice.create({
        data: { planId, setupFeeCents: 5000, monthlyAmountCents: 9900, isActive: true },
      });
      ownedPriceId = price.id;
    }

    const stripeCustomer = await stripe.customers.create({ email: `e2e-saas-${randomUUID()}@example.test` });
    // `pm_card_visa` is Stripe's reusable test PaymentMethod token — each
    // attach() call clones it into a fresh, genuinely-attached PaymentMethod
    // with its own real id; that returned id (not the literal token) is
    // what must be referenced afterward.
    const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', { customer: stripeCustomer.id });
    const stripePrice = await stripe.prices.create({
      unit_amount: 9900,
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: { name: 'E2E AnanseLogix Test Plan' },
    });
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomer.id,
      items: [{ price: stripePrice.id }],
      default_payment_method: paymentMethod.id,
    });
    stripeSubscriptionId = subscription.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    if (ownedPriceId) await prisma.saasPlanPrice.delete({ where: { id: ownedPriceId } }).catch(() => undefined);
    if (ownedPlan) {
      await prisma.saasPlan.delete({ where: { id: planId } }).catch(() => undefined);
    } else if (reactivatedPlan) {
      await prisma.saasPlan.update({ where: { id: planId }, data: { isActive: false } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }, 30_000);

  describe('Signup wizard -> webhook -> tenant provisioning', () => {
    let token: string;
    let tenantId: string;
    const ownerEmail = `owner-${randomUUID()}@example.test`;

    it('Step 1 (Plan): starts a signup session', async () => {
      const res = await request(app.getHttpServer()).post('/public/signup/start').send({ planKey: 'SOFTWARE_ONLY' });
      expect(res.status).toBe(201);
      expect(typeof res.body.token).toBe('string');
      token = res.body.token;
    });

    it('Step 2 (Owner Account): saves owner details, hashing the password server-side', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/public/signup/${token}/owner`)
        .send({ firstName: 'Ada', lastName: 'Owner', email: ownerEmail, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      expect(res.status).toBe(200);

      const session = await prisma.signupSession.findUnique({ where: { token } });
      expect(session?.ownerPasswordHash).toBeTruthy();
      expect(session?.ownerPasswordHash).not.toBe(TEST_PASSWORD);
    });

    it('rejects a mismatched confirmPassword', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/public/signup/${token}/owner`)
        .send({ firstName: 'Ada', lastName: 'Owner', email: ownerEmail, password: TEST_PASSWORD, confirmPassword: 'somethingElse123!' });
      expect(res.status).toBe(400);
    });

    it('Step 3 (Company Details): saves company details', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/public/signup/${token}/company`)
        .send({
          legalName: 'E2E Freight Co',
          country: 'US',
          timezone: 'America/Chicago',
          primaryShippingMarkets: ['Ghana'],
          serviceTypes: ['Ocean'],
        });
      expect(res.status).toBe(200);
    });

    it('Step 4 (Subscription): creates a real Stripe subscription-mode Checkout Session', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/signup/${token}/checkout`)
        .send({ successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' });
      expect(res.status).toBe(201);
      expect(res.body.url).toContain('stripe.com');

      const session = await prisma.signupSession.findUnique({ where: { token } });
      expect(session?.status).toBe('AWAITING_PAYMENT');
      expect(session?.stripeCheckoutSessionId).toBeTruthy();
    });

    it('status polling reports AWAITING_PAYMENT before the webhook fires — never trusts a redirect alone', async () => {
      const res = await request(app.getHttpServer()).get(`/public/signup/${token}/status`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AWAITING_PAYMENT');
      expect(res.body.tenantSlug).toBeNull();
    });

    it('Step 5/6: a signed checkout.session.completed (subscription mode) event provisions the real tenant', async () => {
      const payload = JSON.stringify(fakeSubscriptionCheckoutEvent(`evt_test_${randomUUID()}`, stripeSubscriptionId, token));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      const res = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(res.status).toBe(201);

      const session = await prisma.signupSession.findUnique({ where: { token } });
      expect(session?.status).toBe('COMPLETED');
      expect(session?.resultingTenantId).toBeTruthy();
      tenantId = session!.resultingTenantId!;

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      expect(tenant?.name).toBe('E2E Freight Co');
      expect(tenant?.isActive).toBe(true);

      const owner = await prisma.user.findFirst({ where: { tenantId, email: ownerEmail.toLowerCase() } });
      expect(owner?.role).toBe('TENANT_OWNER');
      expect(owner?.isActive).toBe(true);

      const subscription = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
      expect(subscription?.stripeSubscriptionId).toBe(stripeSubscriptionId);
      expect(subscription?.status).toBe('ACTIVE');
      expect(subscription?.setupFeeStatus).toBe('PAID');

      const entitlements = await prisma.tenantEntitlement.findMany({ where: { tenantId } });
      const byFeature = Object.fromEntries(entitlements.map((e) => [e.feature, e.enabled]));
      expect(byFeature.OPERATIONS_SOFTWARE).toBe(true);
      expect(byFeature.AI_AGENT).toBe(true);
      expect(byFeature.PUBLIC_WEBSITE).toBe(false); // SOFTWARE_ONLY default — see plan-entitlements.ts

      const onboarding = await prisma.tenantOnboarding.findUnique({ where: { tenantId } });
      expect(onboarding?.currentStep).toBe('BRANDING');

      // Step 5's status endpoint now reflects the real, webhook-confirmed outcome.
      const statusRes = await request(app.getHttpServer()).get(`/public/signup/${token}/status`);
      expect(statusRes.body.status).toBe('COMPLETED');
      expect(statusRes.body.tenantSlug).toBe(tenant?.slug);
    });

    it('replaying the identical webhook event is a no-op (StripeWebhookEvent ledger)', async () => {
      const eventId = `evt_test_${randomUUID()}`;
      const payload = JSON.stringify(fakeSubscriptionCheckoutEvent(eventId, stripeSubscriptionId, token));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      const first = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(second.status).toBe(201);

      const tenantCount = await prisma.tenant.count({ where: { id: tenantId } });
      expect(tenantCount).toBe(1);
      const subCount = await prisma.tenantSubscription.count({ where: { stripeSubscriptionId } });
      expect(subCount).toBe(1);
    });

    it('a differently-id\'d event for the same subscription is still a no-op (domain-level idempotency backstop, not just the ledger)', async () => {
      const payload = JSON.stringify(fakeSubscriptionCheckoutEvent(`evt_test_${randomUUID()}`, stripeSubscriptionId, token));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      const res = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(res.status).toBe(201);

      const tenantCount = await prisma.tenant.count({ where: { id: tenantId } });
      expect(tenantCount).toBe(1);
      const subCount = await prisma.tenantSubscription.count({ where: { stripeSubscriptionId } });
      expect(subCount).toBe(1);
      const userCount = await prisma.user.count({ where: { tenantId, role: 'TENANT_OWNER' } });
      expect(userCount).toBe(1);
    });

    it('EntitlementsGuard denies a feature the tenant plan does not include', async () => {
      const ownerToken = await login(app, ownerEmail, TEST_PASSWORD);

      // AI_AGENT is enabled by default for SOFTWARE_ONLY — explicitly
      // disable it to exercise the denial path without needing a real
      // ANTHROPIC_API_KEY configured (AiAgentService is never reached).
      await prisma.tenantEntitlement.update({
        where: { tenantId_feature: { tenantId, feature: 'AI_AGENT' } },
        data: { enabled: false },
      });

      const res = await request(app.getHttpServer())
        .post('/ai-agent/ask')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ question: 'How do I receive a package?' });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/does not include this feature/i);
    });

    afterAll(async () => {
      if (tenantId) await deleteTestTenant(prisma, tenantId);
    });
  });

  describe('Platform-admin routes are denied to tenant staff', () => {
    it('a tenant staff token gets 403 on GET /tenants/platform-overview', async () => {
      const fixture = await createTestTenant(prisma, 'PlatformDeny');
      const token = await login(app, fixture.user.email, fixture.user.password);

      const res = await request(app.getHttpServer()).get('/tenants/platform-overview').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);

      await deleteTestTenant(prisma, fixture.tenantId);
    });

    it('a PLATFORM_ADMIN succeeds and sees the extended overview shape', async () => {
      const admin = await prisma.user.create({
        data: {
          tenantId: null,
          email: `platform-admin-saas-${randomUUID()}@example.test`,
          passwordHash: await bcrypt.hash(TEST_PASSWORD, 10),
          firstName: 'E2E',
          lastName: 'PlatformAdmin',
          role: UserRole.PLATFORM_ADMIN,
        },
      });
      const adminToken = await login(app, admin.email, TEST_PASSWORD);

      const res = await request(app.getHttpServer()).get('/tenants/platform-overview').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty('onboardingStep');
      }

      await prisma.user.delete({ where: { id: admin.id } });
    });
  });

  describe('SUSPENDED tenant access restriction', () => {
    it('a non-allowlisted route is blocked once TenantSubscription.status is SUSPENDED', async () => {
      const fixture = await createTestTenant(prisma, 'Suspended');
      await prisma.tenantSubscription.create({
        data: {
          tenantId: fixture.tenantId,
          stripeCustomerId: `cus_test_fake_${randomUUID()}`,
          stripeSubscriptionId: `sub_test_fake_${randomUUID()}`,
          planId,
          status: 'SUSPENDED',
        },
      });
      const token = await login(app, fixture.user.email, fixture.user.password);

      const blocked = await request(app.getHttpServer()).get('/customers').set('Authorization', `Bearer ${token}`);
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toMatch(/suspended/i);

      const allowlisted = await request(app.getHttpServer()).get('/tenants/me').set('Authorization', `Bearer ${token}`);
      expect(allowlisted.status).toBe(200);

      await deleteTestTenant(prisma, fixture.tenantId);
    });
  });

  describe('A tenant with no TenantSubscription row is fully entitled (predates this SaaS layer)', () => {
    it('GET /entitlements/me reports every feature enabled', async () => {
      const fixture = await createTestTenant(prisma, 'Grandfathered');
      const token = await login(app, fixture.user.email, fixture.user.password);

      const res = await request(app.getHttpServer()).get('/entitlements/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((e: { enabled: boolean }) => e.enabled)).toBe(true);

      await deleteTestTenant(prisma, fixture.tenantId);
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention (see stripe-checkout.e2e-spec.ts).
// ---------------------------------------------------------------------------

function fakeSubscriptionCheckoutEvent(eventId: string, subscriptionId: string, signupSessionToken: string) {
  return {
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_fake_${randomUUID()}`,
        object: 'checkout.session',
        mode: 'subscription',
        payment_status: 'paid',
        subscription: subscriptionId,
        metadata: { signupSessionToken },
      },
    },
  };
}

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
