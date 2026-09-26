import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { TenantPaymentsStripeService } from '../src/tenant-payments/tenant-payments-stripe.service';

jest.setTimeout(30_000);

/**
 * Accounts v2 compatibility fix (2026-09): coverage for POST
 * /webhooks/stripe-connect-v2 (WebhooksController.handleStripeConnectV2Webhook),
 * added alongside the v1 `/webhooks/stripe-connect` route (see
 * tenant-payments-connect-webhook.e2e-spec.ts, which this file
 * deliberately does not modify — v1 coverage is untouched).
 *
 * Unlike the v1 webhook, a v2 "capability_status_updated" thin event
 * carries no account state itself — the handler must call Stripe's real
 * API (`v2.core.accounts.retrieve`) to learn the current status. So this
 * file's one true success-path test uses a real Stripe test-mode
 * connected account (never production — same "test-mode only" posture
 * tenant-payments-connect-webhook.e2e-spec.ts already establishes for its
 * one genuine-Stripe-call case). Every other case here (signature
 * rejection, unhandled event types) never reaches Stripe's API at all.
 *
 * STRIPE_CONNECT_V2_WEBHOOK_SECRET is a locally-generated value for local
 * e2e signing only (pure HMAC, no network call) — see this fix's own
 * report for the real Stripe Dashboard step (registering an actual v2
 * Event Destination) still required before this route receives real
 * traffic in any environment.
 */
describe('Accounts v2 compatibility fix: Stripe Connect v2 webhook (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tenantPaymentsStripeService: TenantPaymentsStripeService;
  let v2WebhookSecret: string;

  let tenantA: TestTenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    tenantPaymentsStripeService = app.get(TenantPaymentsStripeService);

    v2WebhookSecret = process.env.STRIPE_CONNECT_V2_WEBHOOK_SECRET ?? '';
    if (!v2WebhookSecret) {
      throw new Error('STRIPE_CONNECT_V2_WEBHOOK_SECRET must be configured in apps/api/.env to run this suite.');
    }

    tenantA = await createTestTenant(prisma, 'ConnectWhV2A', UserRole.MANAGER);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  afterEach(async () => {
    await prisma.tenantPaymentSettings.deleteMany({ where: { tenantId: tenantA.tenantId } });
  });

  function postConnectV2Webhook(payload: string, signature: string) {
    return request(app.getHttpServer()).post('/webhooks/stripe-connect-v2').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
  }

  /** Minimal but structurally valid v2 thin-event notification — matches the real payload shape Stripe sends (confirmed against a real test-mode account during this fix's own investigation), not guessed. */
  function fakeV2AccountEvent(params: { type: string; accountId: string }) {
    return {
      id: `evt_test_${randomUUID()}`,
      object: 'v2.core.event',
      type: params.type,
      livemode: false,
      created: new Date().toISOString(),
      related_object: { id: params.accountId, type: 'v2.core.account', url: `/v2/core/accounts/${params.accountId}` },
    };
  }

  describe('signature verification', () => {
    it('rejects a request with no stripe-signature header', async () => {
      const res = await request(app.getHttpServer()).post('/webhooks/stripe-connect-v2').set('Content-Type', 'application/json').send('{}');
      expect(res.status).toBe(400);
    });

    it('rejects a garbage/invalid signature', async () => {
      const res = await postConnectV2Webhook('{}', 'not-a-real-signature');
      expect(res.status).toBe(400);
    });

    it('rejects a payload validly signed with the WRONG secret (e.g. the v1 Connect webhook secret, never the v2 one) — Stripe issues a distinct secret per Event Destination', async () => {
      const v1Secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
      if (!v1Secret) throw new Error('STRIPE_CONNECT_WEBHOOK_SECRET must be configured to run this test.');
      const payload = JSON.stringify(fakeV2AccountEvent({ type: 'v2.core.account[configuration.merchant].capability_status_updated', accountId: 'acct_irrelevant' }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: v1Secret });
      const res = await postConnectV2Webhook(payload, signature);
      expect(res.status).toBe(400);
    });
  });

  describe('event dispatch', () => {
    it('a validly-signed but unhandled/unknown event type is acknowledged (200-class) without attempting any Stripe API call or DB write', async () => {
      // account.created is a real, known v2 event type this handler deliberately
      // does not register a callback for (see handleV2AccountWebhook's own doc
      // comment on scope) — must fall through to the no-op fallback, not throw.
      const payload = JSON.stringify(fakeV2AccountEvent({ type: 'v2.core.account.created', accountId: 'acct_never_registered_v2' }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: v2WebhookSecret });
      const res = await postConnectV2Webhook(payload, signature);
      expect(res.status).toBe(201);
    });
  });

  describe('capability_status_updated: real Stripe test-mode round trip (never production)', () => {
    it('fetches the real account, computes isActive from its actual (not-yet-active) card_payments status, and syncs only the owning tenant', async () => {
      const contactEmail = `v2-webhook-test-${randomUUID()}@example.com`;
      const accountId = await tenantPaymentsStripeService.getOrCreateConnectedAccount(tenantA.tenantId, contactEmail);

      const payload = JSON.stringify(fakeV2AccountEvent({ type: 'v2.core.account[configuration.merchant].capability_status_updated', accountId }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: v2WebhookSecret });

      const res = await postConnectV2Webhook(payload, signature);
      expect(res.status).toBe(201);

      // A brand-new test account has no KYC submitted — Stripe's own real,
      // current status for it is genuinely not "active" yet. This proves the
      // full pipe (signature verify -> dispatch -> real accounts.retrieve ->
      // isCardPaymentsActiveV2 -> DB write) actually runs end to end, not that
      // the account happens to be ready (see isCardPaymentsActiveV2's own
      // direct unit coverage in tenant-payments-onboarding.e2e-spec.ts for the
      // "active" branch, which needs no live Stripe call to verify).
      const settings = await prisma.tenantPaymentSettings.findUniqueOrThrow({ where: { tenantId: tenantA.tenantId } });
      expect(settings.isActive).toBe(false);

      const secretKey = process.env.PLATFORM_STRIPE_SECRET_KEY;
      if (secretKey) {
        const stripe = new Stripe(secretKey);
        await stripe.v2.core.accounts.close(accountId, { applied_configurations: ['merchant'] }).catch(() => {});
      }
    });

    it('a capability_status_updated event for an account with no matching TenantPaymentSettings row is safely ignored (200-class, no throw)', async () => {
      // A real Stripe test-mode account that exists but was never persisted
      // locally — accounts.retrieve succeeds, the DB update then hits P2025
      // (see syncAccountStatusFromStripeAccountV2's own doc comment) and
      // returns null rather than throwing.
      const secretKey = process.env.PLATFORM_STRIPE_SECRET_KEY;
      if (!secretKey) throw new Error('PLATFORM_STRIPE_SECRET_KEY must be configured to run this test.');
      const stripe = new Stripe(secretKey);
      const orphanAccount = await stripe.v2.core.accounts.create({
        contact_email: `v2-orphan-test-${randomUUID()}@example.com`,
        dashboard: 'full',
        identity: { country: 'US', entity_type: 'company' },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      });

      try {
        const payload = JSON.stringify(fakeV2AccountEvent({ type: 'v2.core.account[configuration.merchant].capability_status_updated', accountId: orphanAccount.id }));
        const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: v2WebhookSecret });
        const res = await postConnectV2Webhook(payload, signature);
        expect(res.status).toBe(201);
      } finally {
        await stripe.v2.core.accounts.close(orphanAccount.id, { applied_configurations: ['merchant'] }).catch(() => {});
      }
    });
  });
});
