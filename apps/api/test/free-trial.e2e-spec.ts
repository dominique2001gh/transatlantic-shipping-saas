import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { TEST_PASSWORD } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(60_000);

/**
 * Free Trial stage: proves the true no-card 14-day trial end to end —
 * signup provisions a tenant with zero Stripe involvement, full plan
 * entitlements apply immediately, trial expiry is enforced server-side
 * (SubscriptionStatusGuard), and activating paid billing later attaches a
 * real Stripe subscription to the *same* tenant rather than creating a
 * new one. Follows saas-signup-provisioning.e2e-spec.ts's own established
 * convention (real Postgres, real Stripe test-mode API for the activation
 * leg, fabricated-but-signed webhook events, own-what-you-create cleanup)
 * — uses the WEBSITE_AND_SOFTWARE key (unused by any other suite) as its
 * isolated test plan, never touching the three real seeded plans.
 */
describe('AnanseLogix Free Trial (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let stripe: Stripe;
  let webhookSecret: string;

  let planId: string;
  let ownedPlan = false;
  let reactivatedPlan = false;
  let ownedPriceId: string | null = null;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();

    const secretKey = process.env.STRIPE_SECRET_KEY;
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    if (!secretKey || !webhookSecret) {
      throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured in apps/api/.env to run this suite.');
    }
    stripe = new Stripe(secretKey);

    // WEBSITE_AND_SOFTWARE already exists as a real, retired plan (with its
    // own real historical price/promo rows) — matching
    // saas-signup-provisioning.e2e-spec.ts's own established pattern for
    // SOFTWARE_ONLY, this temporarily reactivates it rather than assuming
    // an empty fixture, and restores it exactly in afterAll. Only a brand-
    // new price row (this suite's own) is ever deleted afterward — neither
    // pre-existing price row is touched.
    let plan = await prisma.saasPlan.findUnique({ where: { key: 'WEBSITE_AND_SOFTWARE' } });
    if (!plan) {
      plan = await prisma.saasPlan.create({ data: { key: 'WEBSITE_AND_SOFTWARE', name: 'E2E Trial Test Plan', isActive: true } });
      ownedPlan = true;
    } else if (!plan.isActive) {
      await prisma.saasPlan.update({ where: { id: plan.id }, data: { isActive: true } });
      reactivatedPlan = true;
    }
    planId = plan.id;

    // Ensure no pre-existing price row is left active (this plan's real
    // historical rows are already both isActive:false today, but guard
    // against that assumption anyway) before adding this suite's own.
    await prisma.saasPlanPrice.updateMany({ where: { planId, isActive: true }, data: { isActive: false } });
    const price = await prisma.saasPlanPrice.create({
      data: { planId, setupFeeCents: 35000, monthlyAmountCents: 14900, trialDays: 14, isActive: true },
    });
    ownedPriceId = price.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    for (const tenantId of createdTenantIds) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    if (ownedPriceId) await prisma.saasPlanPrice.delete({ where: { id: ownedPriceId } }).catch(() => undefined);
    if (ownedPlan) {
      await prisma.saasPlan.delete({ where: { id: planId } }).catch(() => undefined);
    } else if (reactivatedPlan) {
      await prisma.saasPlan.update({ where: { id: planId }, data: { isActive: false } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }, 30_000);

  describe('trial signup: zero Stripe involvement, immediate full entitlements', () => {
    let token: string;
    let tenantId: string;
    let ownerToken: string;
    const ownerEmail = `trial-owner-${randomUUID()}@example.test`;

    it('completes the signup wizard and provisions the tenant synchronously, with no Checkout URL', async () => {
      const start = await request(app.getHttpServer()).post('/public/signup/start').send({ planKey: 'WEBSITE_AND_SOFTWARE' });
      expect(start.status).toBe(201);
      token = start.body.token;

      await request(app.getHttpServer())
        .patch(`/public/signup/${token}/owner`)
        .send({ firstName: 'Trial', lastName: 'Owner', email: ownerEmail, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/public/signup/${token}/company`)
        .send({ legalName: 'E2E Trial Freight Co', country: 'US', timezone: 'America/Chicago', primaryShippingMarkets: ['Ghana'], serviceTypes: ['Ocean'] })
        .expect(200);

      const checkout = await request(app.getHttpServer())
        .post(`/public/signup/${token}/checkout`)
        .send({ successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' });
      expect(checkout.status).toBe(201);
      expect(checkout.body.url).toBeNull();

      const status = await request(app.getHttpServer()).get(`/public/signup/${token}/status`);
      expect(status.status).toBe(200);
      expect(status.body.status).toBe('COMPLETED');
      expect(status.body.tenantSlug).toBeTruthy();

      const signupSession = await prisma.signupSession.findUniqueOrThrow({ where: { token } });
      tenantId = signupSession.resultingTenantId!;
      createdTenantIds.push(tenantId);
    });

    it('creates a TenantSubscription with no Stripe relationship at all — TRIALING, ~14-day trialEndsAt, setup fee PENDING', async () => {
      const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      expect(sub.stripeCustomerId).toBeNull();
      expect(sub.stripeSubscriptionId).toBeNull();
      expect(sub.status).toBe('TRIALING');
      expect(sub.setupFeeStatus).toBe('PENDING');
      expect(sub.trialEndsAt).toBeTruthy();
      const daysUntilTrialEnd = (sub.trialEndsAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysUntilTrialEnd).toBeGreaterThan(13.9);
      expect(daysUntilTrialEnd).toBeLessThan(14.1);
    });

    it('stamps full plan entitlements immediately — identical to a paid, active tenant on the same plan', async () => {
      const entitlements = await prisma.tenantEntitlement.findMany({ where: { tenantId } });
      const enabled = new Set(entitlements.filter((e) => e.enabled).map((e) => e.feature));
      // WEBSITE_AND_SOFTWARE's own defaults (plan-entitlements.ts) — the operations software tier, not just a website.
      expect(enabled.has('OPERATIONS_SOFTWARE')).toBe(true);
      expect(enabled.has('CUSTOMER_PORTAL')).toBe(true);
      expect(enabled.has('ANALYTICS')).toBe(true);
      expect(enabled.has('AI_AGENT')).toBe(true);
    });

    it('the new owner can log in and use the app normally — TRIALING is never treated as suspended', async () => {
      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: ownerEmail, password: TEST_PASSWORD });
      expect(loginRes.status).toBe(200);
      ownerToken = loginRes.body.accessToken;

      const staffRes = await request(app.getHttpServer()).get('/users/staff').set('Authorization', `Bearer ${ownerToken}`);
      expect(staffRes.status).toBe(200);
    });

    it('shows trial status via GET /onboarding, and the billing portal correctly refuses (no real Stripe customer exists yet)', async () => {
      const overview = await request(app.getHttpServer()).get('/onboarding').set('Authorization', `Bearer ${ownerToken}`);
      expect(overview.status).toBe(200);
      expect(overview.body.subscription.status).toBe('TRIALING');
      expect(overview.body.subscription.trialEndsAt).toBeTruthy();

      const portal = await request(app.getHttpServer())
        .post('/onboarding/billing/portal-session')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ returnUrl: 'https://example.test/return' });
      expect(portal.status).toBe(400);
    });

    it('GET /tenants/me (any role, allow-when-suspended) also surfaces the trial summary — this is what the dashboard banner reads', async () => {
      const res = await request(app.getHttpServer()).get('/tenants/me').set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.subscription).toMatchObject({ status: 'TRIALING', setupFeeStatus: 'PENDING' });
      expect(res.body.subscription.trialEndsAt).toBeTruthy();
    });
  });

  describe('trial expiry is enforced server-side', () => {
    let tenantId: string;
    let ownerToken: string;
    const ownerEmail = `expired-owner-${randomUUID()}@example.test`;

    beforeAll(async () => {
      const start = await request(app.getHttpServer()).post('/public/signup/start').send({ planKey: 'WEBSITE_AND_SOFTWARE' });
      const token = start.body.token;
      await request(app.getHttpServer())
        .patch(`/public/signup/${token}/owner`)
        .send({ firstName: 'Expired', lastName: 'Owner', email: ownerEmail, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      await request(app.getHttpServer())
        .patch(`/public/signup/${token}/company`)
        .send({ legalName: 'E2E Expired Trial Co', country: 'US', timezone: 'America/Chicago', primaryShippingMarkets: ['Ghana'], serviceTypes: ['Ocean'] });
      await request(app.getHttpServer())
        .post(`/public/signup/${token}/checkout`)
        .send({ successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' });

      const signupSession = await prisma.signupSession.findUniqueOrThrow({ where: { token } });
      tenantId = signupSession.resultingTenantId!;
      createdTenantIds.push(tenantId);

      // Simulate 14 days having passed — no scheduled job exists (or is
      // needed); enforcement is lazy, on the next guarded request, exactly
      // like the existing PAST_DUE-past-grace-period mechanism.
      await prisma.tenantSubscription.update({ where: { tenantId }, data: { trialEndsAt: new Date(Date.now() - 60_000) } });

      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: ownerEmail, password: TEST_PASSWORD });
      ownerToken = loginRes.body.accessToken;
    });

    it('blocks a normal guarded route once trialEndsAt has passed, and persists the SUSPENDED status', async () => {
      const res = await request(app.getHttpServer()).get('/users/staff').set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(403);

      const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      expect(sub.status).toBe('SUSPENDED');
    });

    it('does NOT delete any tenant/customer/business data — the tenant row itself is untouched', async () => {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant.isActive).toBe(true);
      const user = await prisma.user.findFirst({ where: { tenantId, email: ownerEmail } });
      expect(user).toBeTruthy();
    });

    it('still allows the billing-activation route despite being suspended (@AllowWhenSuspended)', async () => {
      const res = await request(app.getHttpServer())
        .post('/onboarding/billing/subscribe')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' });
      expect(res.status).toBe(201);
      expect(res.body.url).toContain('stripe.com');
    });

    it('activating paid billing after expiry re-attaches the SAME tenant (never creates a new one) and restores access', async () => {
      const stripeCustomer = await stripe.customers.create({ email: `e2e-activate-${randomUUID()}@example.test` });
      const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', { customer: stripeCustomer.id });
      const stripePrice = await stripe.prices.create({
        unit_amount: 14900,
        currency: 'usd',
        recurring: { interval: 'month' },
        product_data: { name: 'E2E Trial Activation Plan' },
      });
      const subscription = await stripe.subscriptions.create({
        customer: stripeCustomer.id,
        items: [{ price: stripePrice.id }],
        default_payment_method: paymentMethod.id,
      });

      const tenantsBefore = await prisma.tenant.count();

      const payload = JSON.stringify(fakeActivationCheckoutEvent(`evt_test_${randomUUID()}`, subscription.id, tenantId));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const res = await request(app.getHttpServer()).post('/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
      expect(res.status).toBe(201);

      const tenantsAfter = await prisma.tenant.count();
      expect(tenantsAfter).toBe(tenantsBefore); // no new tenant created

      const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      expect(sub.stripeCustomerId).toBe(stripeCustomer.id);
      expect(sub.stripeSubscriptionId).toBe(subscription.id);
      expect(sub.status).toBe('ACTIVE');
      expect(sub.setupFeeStatus).toBe('PAID');

      // Access is restored — the same guarded route that was 403ing now works.
      const staffRes = await request(app.getHttpServer()).get('/users/staff').set('Authorization', `Bearer ${ownerToken}`);
      expect(staffRes.status).toBe(200);

      await stripe.subscriptions.cancel(subscription.id).catch(() => undefined);
    });
  });

  it('leaves the untouched trialDays===0 path (a real, non-trial paid signup) fully intact — sanity check against this suite\'s own refactor', async () => {
    // Deliberately a *separate*, momentarily-trial-free price row on the
    // same test plan, restored immediately after — never touches the
    // suite-wide trialDays:14 fixture price other tests in this file rely on.
    const activePrice = await prisma.saasPlanPrice.findFirstOrThrow({ where: { planId, isActive: true } });
    await prisma.saasPlanPrice.update({ where: { id: activePrice.id }, data: { trialDays: 0 } });

    try {
      const start = await request(app.getHttpServer()).post('/public/signup/start').send({ planKey: 'WEBSITE_AND_SOFTWARE' });
      const token = start.body.token;
      const ownerEmail = `nontrial-owner-${randomUUID()}@example.test`;
      await request(app.getHttpServer())
        .patch(`/public/signup/${token}/owner`)
        .send({ firstName: 'NonTrial', lastName: 'Owner', email: ownerEmail, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
      await request(app.getHttpServer())
        .patch(`/public/signup/${token}/company`)
        .send({ legalName: 'E2E NonTrial Co', country: 'US', timezone: 'America/Chicago', primaryShippingMarkets: ['Ghana'], serviceTypes: ['Ocean'] });

      const checkout = await request(app.getHttpServer())
        .post(`/public/signup/${token}/checkout`)
        .send({ successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' });
      expect(checkout.status).toBe(201);
      expect(checkout.body.url).toContain('stripe.com'); // real Stripe Checkout, exactly as before this stage existed
    } finally {
      await prisma.saasPlanPrice.update({ where: { id: activePrice.id }, data: { trialDays: 14 } });
    }
  });
});

function fakeActivationCheckoutEvent(eventId: string, subscriptionId: string, activateTenantId: string) {
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
        metadata: { activateTenantId },
      },
    },
  };
}
