import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { isCardPaymentsActiveV2, TenantPaymentsStripeService } from '../src/tenant-payments/tenant-payments-stripe.service';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Tenant Payments Phase 2: RBAC, tenant isolation, account-reuse, and
 * account.updated status-sync coverage for the OWNER-only onboarding
 * surface (TenantPaymentsController) and its supporting service methods.
 *
 * Deliberately does NOT exercise a genuine "create a brand-new Stripe
 * Connect account" success path — that requires a real (even if
 * test-mode) call to stripe.accounts.create, which is the one action
 * Phase 2 was explicitly scoped to implement but not yet invoke without
 * separate, explicit approval (see the Phase 2 completion report). Every
 * test here either (a) never reaches a live Stripe API call at all
 * (RBAC guards reject before any service code runs; account.updated
 * sync is pure local-HMAC-verified-webhook + DB write, no Stripe call),
 * or (b) pre-seeds a fixture (never-registered) connected account id so
 * getOrCreateConnectedAccount's *reuse* branch returns without ever
 * calling Stripe — the same "fixture account id, zero live resource
 * creation" convention tenant-payments-connect-webhook.e2e-spec.ts and
 * tenant-payments-checkout-routing.e2e-spec.ts already established in
 * Phase 1.
 */
describe('Tenant Payments Phase 2: onboarding RBAC, isolation, and account status sync (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tenantPaymentsStripeService: TenantPaymentsStripeService;
  let connectWebhookSecret: string;

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let ownerTokenA: string;
  let managerTokenA: string;
  let staffTokenA: string;
  let financeTokenA: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantPaymentsStripeService = app.get(TenantPaymentsStripeService);

    connectWebhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? '';
    if (!connectWebhookSecret) {
      throw new Error('STRIPE_CONNECT_WEBHOOK_SECRET must be configured in apps/api/.env to run this suite.');
    }

    tenantA = await createTestTenant(prisma, 'ConnectOnbA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'ConnectOnbB', UserRole.MANAGER);
    managerTokenA = await login(app, tenantA.user.email, tenantA.user.password);

    const ownerA = await createUserInTenant(prisma, tenantA.tenantId, 'Owner', UserRole.OWNER);
    ownerTokenA = await login(app, ownerA.email, ownerA.password);
    const staffA = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.STAFF);
    staffTokenA = await login(app, staffA.email, staffA.password);
    const financeA = await createUserInTenant(prisma, tenantA.tenantId, 'Finance', UserRole.FINANCE);
    financeTokenA = await login(app, financeA.email, financeA.password);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  afterEach(async () => {
    await prisma.tenantPaymentSettings.deleteMany({ where: { tenantId: { in: [tenantA.tenantId, tenantB.tenantId] } } });
  });

  // -- RBAC ---------------------------------------------------------------

  describe('RBAC: only OWNER may initiate/resume onboarding or read connection status', () => {
    it('OWNER can read connection status (200)', async () => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/connect/status').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false, isActive: false });
    });

    it.each([
      ['MANAGER', () => managerTokenA],
      ['STAFF', () => staffTokenA],
      ['FINANCE', () => financeTokenA],
    ])('%s gets 403 on GET /tenant-payments/connect/status', async (_role, getToken) => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/connect/status').set('Authorization', `Bearer ${getToken()}`);
      expect(res.status).toBe(403);
    });

    it.each([
      ['MANAGER', () => managerTokenA],
      ['STAFF', () => staffTokenA],
      ['FINANCE', () => financeTokenA],
    ])('%s gets 403 on POST /tenant-payments/connect/onboarding-link', async (_role, getToken) => {
      const res = await request(app.getHttpServer()).post('/tenant-payments/connect/onboarding-link').set('Authorization', `Bearer ${getToken()}`);
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request gets 401, not 403, on both routes', async () => {
      const statusRes = await request(app.getHttpServer()).get('/tenant-payments/connect/status');
      expect(statusRes.status).toBe(401);
      const linkRes = await request(app.getHttpServer()).post('/tenant-payments/connect/onboarding-link');
      expect(linkRes.status).toBe(401);
    });
  });

  // -- Tenant isolation -----------------------------------------------------

  describe('tenant isolation', () => {
    it("tenant A's OWNER never sees tenant B's connection status, even when tenant B has an active connected account", async () => {
      await prisma.tenantPaymentSettings.create({
        data: { tenantId: tenantB.tenantId, stripeConnectedAccountId: `acct_test_fixture_${randomUUID()}`, isActive: true },
      });

      const res = await request(app.getHttpServer()).get('/tenant-payments/connect/status').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false, isActive: false }); // tenant A's own (empty) state, never tenant B's
    });

    it('tenantId is always read from the verified JWT — there is no request field that can target another tenant', async () => {
      // No such field exists on either route's request shape at all (see
      // TenantPaymentsController's own doc comment) — this documents that
      // an attempted override is simply ignored, not silently honored.
      const res = await request(app.getHttpServer())
        .get('/tenant-payments/connect/status')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .query({ tenantId: tenantB.tenantId });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false, isActive: false });
    });
  });

  // -- Resuming onboarding without duplicating the connected account --------

  describe('resuming onboarding reuses the existing connected account', () => {
    it('getOrCreateConnectedAccount returns the SAME id on a second call — never creates a duplicate', async () => {
      const fixtureAccountId = `acct_test_fixture_${randomUUID()}`;
      await prisma.tenantPaymentSettings.create({
        data: { tenantId: tenantA.tenantId, stripeConnectedAccountId: fixtureAccountId, isActive: false },
      });

      const first = await tenantPaymentsStripeService.getOrCreateConnectedAccount(tenantA.tenantId, 'reuse-test@example.com');
      const second = await tenantPaymentsStripeService.getOrCreateConnectedAccount(tenantA.tenantId, 'reuse-test@example.com');
      expect(first).toBe(fixtureAccountId);
      expect(second).toBe(fixtureAccountId);

      const rows = await prisma.tenantPaymentSettings.findMany({ where: { tenantId: tenantA.tenantId } });
      expect(rows).toHaveLength(1); // tenantId is @unique anyway, but this documents the intent explicitly
    });

    it('POST /tenant-payments/connect/onboarding-link reuses an existing fixture account (no new Stripe account created) — Account Link creation against it fails safely since the fixture account was never registered with Stripe', async () => {
      const fixtureAccountId = `acct_test_fixture_${randomUUID()}`;
      await prisma.tenantPaymentSettings.create({
        data: { tenantId: tenantA.tenantId, stripeConnectedAccountId: fixtureAccountId, isActive: false },
      });

      const res = await request(app.getHttpServer()).post('/tenant-payments/connect/onboarding-link').set('Authorization', `Bearer ${ownerTokenA}`);

      // Same safe-failure posture as Phase 1's checkout-routing test for a
      // nonexistent connected account: Stripe correctly rejects an
      // Account Link request for an account it doesn't recognize, and
      // that rejection must never leak the account id or Stripe's own raw
      // SDK error text to the caller — a generic message that simply
      // names the feature ("Stripe onboarding") is fine and expected;
      // it's the account id / raw "No such account" detail that must
      // never reach the client.
      expect(res.status).toBeGreaterThanOrEqual(400);
      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toContain(fixtureAccountId);
      expect(bodyText.toLowerCase()).not.toContain('no such account');

      // Reused, not replaced/duplicated.
      const settings = await prisma.tenantPaymentSettings.findUniqueOrThrow({ where: { tenantId: tenantA.tenantId } });
      expect(settings.stripeConnectedAccountId).toBe(fixtureAccountId);
    });
  });

  // -- Accounts v2 compatibility fix (2026-09) -------------------------------

  describe('isCardPaymentsActiveV2: pure v2 readiness check (no Stripe/DB call)', () => {
    it('is true only when configuration.merchant.capabilities.card_payments.status is exactly "active"', () => {
      expect(isCardPaymentsActiveV2({ configuration: { merchant: { capabilities: { card_payments: { status: 'active' } } } } })).toBe(true);
    });

    it.each(['pending', 'restricted', 'unsupported'] as const)('is false when card_payments.status is "%s"', (status) => {
      expect(isCardPaymentsActiveV2({ configuration: { merchant: { capabilities: { card_payments: { status } } } } })).toBe(false);
    });

    it('is false when no merchant configuration exists at all', () => {
      expect(isCardPaymentsActiveV2({ configuration: {} })).toBe(false);
      expect(isCardPaymentsActiveV2({ configuration: undefined })).toBe(false);
    });

    it('is false when merchant configuration exists but card_payments capability was never requested', () => {
      expect(isCardPaymentsActiveV2({ configuration: { merchant: { capabilities: {} } } })).toBe(false);
    });
  });

  describe('Accounts v2 connected-account creation (real Stripe test-mode — never touches production)', () => {
    it('creates a v2 (not v1) account with no legacy `type`, dashboard=full, and Stripe as both fees_collector and losses_collector', async () => {
      const contactEmail = `v2-create-test-${randomUUID()}@example.com`;
      const accountId = await tenantPaymentsStripeService.getOrCreateConnectedAccount(tenantA.tenantId, contactEmail);

      const secretKey = process.env.PLATFORM_STRIPE_SECRET_KEY;
      if (!secretKey) throw new Error('PLATFORM_STRIPE_SECRET_KEY must be configured to run this test.');
      const stripe = new Stripe(secretKey);

      try {
        const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ['configuration.merchant', 'defaults'] });

        // Proves this is a genuine v2 object, not a v1 Account wearing a v2-shaped id —
        // a legacy `type`-based create would never produce this object type.
        expect(account.object).toBe('v2.core.account');
        expect((account as unknown as { type?: unknown }).type).toBeUndefined();

        expect(account.dashboard).toBe('full');
        expect(account.defaults?.responsibilities?.fees_collector).toBe('stripe');
        expect(account.defaults?.responsibilities?.losses_collector).toBe('stripe');
        expect(account.configuration?.merchant?.capabilities?.card_payments).toBeDefined();

        // Brand new, no KYC submitted yet — must never read as ready.
        expect(isCardPaymentsActiveV2(account)).toBe(false);
      } finally {
        await stripe.v2.core.accounts.close(accountId, { applied_configurations: ['merchant'] }).catch(() => {
          // Best-effort cleanup of the test-mode account — never affects the assertions above.
        });
      }
    });
  });

  // -- account.updated status synchronization --------------------------------

  describe('account.updated synchronizes isActive from real Stripe readiness fields', () => {
    function fakeAccountUpdatedEvent(account: { id: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean }) {
      return {
        id: `evt_test_${randomUUID()}`,
        object: 'event',
        type: 'account.updated',
        account: account.id,
        data: { object: { object: 'account', ...account } },
      };
    }

    function postConnectWebhook(payload: string, signature: string) {
      return request(app.getHttpServer()).post('/webhooks/stripe-connect').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
    }

    it('a fully ready account (charges_enabled + payouts_enabled) sets isActive: true', async () => {
      const accountId = `acct_test_fixture_${randomUUID()}`;
      await prisma.tenantPaymentSettings.create({ data: { tenantId: tenantA.tenantId, stripeConnectedAccountId: accountId, isActive: false } });

      const payload = JSON.stringify(fakeAccountUpdatedEvent({ id: accountId, charges_enabled: true, payouts_enabled: true, details_submitted: true }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });
      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201);

      const settings = await prisma.tenantPaymentSettings.findUniqueOrThrow({ where: { tenantId: tenantA.tenantId } });
      expect(settings.isActive).toBe(true);
    });

    it('an account with details submitted but payouts not yet enabled remains isActive: false — details_submitted alone is not readiness', async () => {
      const accountId = `acct_test_fixture_${randomUUID()}`;
      await prisma.tenantPaymentSettings.create({ data: { tenantId: tenantA.tenantId, stripeConnectedAccountId: accountId, isActive: false } });

      const payload = JSON.stringify(fakeAccountUpdatedEvent({ id: accountId, charges_enabled: true, payouts_enabled: false, details_submitted: true }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });
      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201);

      const settings = await prisma.tenantPaymentSettings.findUniqueOrThrow({ where: { tenantId: tenantA.tenantId } });
      expect(settings.isActive).toBe(false);
    });

    it('a previously-ready account that becomes restricted (charges_enabled flips false) is synced back to isActive: false', async () => {
      const accountId = `acct_test_fixture_${randomUUID()}`;
      await prisma.tenantPaymentSettings.create({ data: { tenantId: tenantA.tenantId, stripeConnectedAccountId: accountId, isActive: true } });

      const payload = JSON.stringify(fakeAccountUpdatedEvent({ id: accountId, charges_enabled: false, payouts_enabled: true, details_submitted: true }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });
      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201);

      const settings = await prisma.tenantPaymentSettings.findUniqueOrThrow({ where: { tenantId: tenantA.tenantId } });
      expect(settings.isActive).toBe(false);
    });

    it('an account.updated event for an unrecognized connected account is safely ignored (200-class, no throw)', async () => {
      const payload = JSON.stringify(fakeAccountUpdatedEvent({ id: 'acct_never_registered', charges_enabled: true, payouts_enabled: true, details_submitted: true }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });
      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201);
    });

    it('an account.updated event updates ONLY the tenant that owns that connected account — a sibling tenant with its own account is untouched', async () => {
      const accountIdA = `acct_test_fixture_${randomUUID()}`;
      const accountIdB = `acct_test_fixture_${randomUUID()}`;
      await prisma.tenantPaymentSettings.create({ data: { tenantId: tenantA.tenantId, stripeConnectedAccountId: accountIdA, isActive: false } });
      await prisma.tenantPaymentSettings.create({ data: { tenantId: tenantB.tenantId, stripeConnectedAccountId: accountIdB, isActive: false } });

      const payload = JSON.stringify(fakeAccountUpdatedEvent({ id: accountIdA, charges_enabled: true, payouts_enabled: true, details_submitted: true }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });
      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201);

      const settingsA = await prisma.tenantPaymentSettings.findUniqueOrThrow({ where: { tenantId: tenantA.tenantId } });
      const settingsB = await prisma.tenantPaymentSettings.findUniqueOrThrow({ where: { tenantId: tenantB.tenantId } });
      expect(settingsA.isActive).toBe(true);
      expect(settingsB.isActive).toBe(false); // untouched
    });
  });
});

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  return completeStaffLogin(app, email, password);
}
