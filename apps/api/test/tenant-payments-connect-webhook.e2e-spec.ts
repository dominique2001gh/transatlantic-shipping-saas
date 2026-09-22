import { INestApplication } from '@nestjs/common';
import { PaymentMethod, PaymentSource, PaymentStatus, PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import {
  createCustomerWithPortalUser,
  createTestTenant,
  createUserInTenant,
  deleteTestTenant,
  TestPortalCustomerFixture,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Tenant Payments Phase 1: comprehensive coverage for POST
 * /webhooks/stripe-connect (WebhooksController.handleStripeConnectWebhook),
 * which was implemented in the pre-existing WIP but had zero automated
 * tests. Never creates a real Stripe Connect account (Express onboarding
 * via Account Links is explicitly out of scope for this phase) —
 * connected-account ids used here are fixture strings shaped like
 * Stripe's own (`acct_...`), never registered with Stripe. This is safe
 * because the handler never calls Stripe's API to validate an account id;
 * it only (a) verifies the event's signature — pure local HMAC, no
 * network call — and (b) looks up TenantPaymentSettings by whatever
 * `event.account` the signed payload claims. Session ids are similarly
 * fixture strings for every case except the one explicitly marked "real
 * Stripe test-mode session", which follows the same established,
 * no-mocking convention every other e2e spec in this suite uses.
 *
 * STRIPE_CONNECT_WEBHOOK_SECRET is a locally-generated value in
 * apps/api/.env (see its own comment) — webhook signature verification
 * is pure local HMAC (Stripe.webhooks.generateTestHeaderString /
 * constructEvent), so this never touches Stripe's API either.
 */
describe('Tenant Payments Phase 1: Stripe Connect webhook (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let connectWebhookSecret: string;
  let platformWebhookSecret: string;

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tenantAdminTokenA: string;
  let customer1A: TestPortalCustomerFixture;
  let customer1APortalToken: string;
  let shipment1A: { id: string };

  beforeAll(async () => {
    app = await createTestApp();

    connectWebhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? '';
    platformWebhookSecret = process.env.PLATFORM_STRIPE_WEBHOOK_SECRET ?? '';
    if (!connectWebhookSecret || !platformWebhookSecret) {
      throw new Error('STRIPE_CONNECT_WEBHOOK_SECRET and PLATFORM_STRIPE_WEBHOOK_SECRET must be configured in apps/api/.env to run this suite.');
    }

    tenantA = await createTestTenant(prisma, 'ConnectWhA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'ConnectWhB', UserRole.MANAGER);

    const tenantAdminA = await createUserInTenant(prisma, tenantA.tenantId, 'TenantAdmin', UserRole.OWNER);
    tenantAdminTokenA = await login(app, tenantAdminA.email, tenantAdminA.password);

    customer1A = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'C1');
    customer1APortalToken = await login(app, customer1A.user.email, customer1A.user.password);

    shipment1A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer1A.customerId);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  /** Creates an issued invoice (via tenant A's own staff token — every call site below uses tenant A) + a PENDING ONLINE Payment row with a fixture providerReference. */
  async function createPendingOnlinePayment(tenant: TestTenantFixture, customerId: string, shipmentId: string, amount: number) {
    const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customerId, shipmentId, amount);
    const providerReference = `cs_test_fixture_${randomUUID()}`;
    const payment = await prisma.payment.create({
      data: {
        tenantId: tenant.tenantId,
        invoiceId: invoice.id,
        customerId,
        amount,
        currency: 'USD',
        method: PaymentMethod.CARD,
        status: PaymentStatus.PENDING,
        source: PaymentSource.ONLINE,
        provider: 'STRIPE',
        providerReference,
      },
    });
    return { invoice, payment };
  }

  /** TenantPaymentSettings.tenantId is @unique — tests sharing tenantA must each start from a clean slate rather than colliding with (or silently inheriting) another test's row. */
  async function connectAccountFor(tenant: TestTenantFixture, overrides: { isActive?: boolean } = {}) {
    await prisma.tenantPaymentSettings.deleteMany({ where: { tenantId: tenant.tenantId } });
    const stripeConnectedAccountId = `acct_test_fixture_${randomUUID()}`;
    await prisma.tenantPaymentSettings.create({
      data: { tenantId: tenant.tenantId, stripeConnectedAccountId, isActive: overrides.isActive ?? true },
    });
    return stripeConnectedAccountId;
  }

  /** Ensures no leftover connected-account row from a prior test in this file affects a test that needs the pure platform-account path. */
  async function clearConnectAccountFor(tenant: TestTenantFixture) {
    await prisma.tenantPaymentSettings.deleteMany({ where: { tenantId: tenant.tenantId } });
  }

  function postConnectWebhook(payload: string, signature: string) {
    return request(app.getHttpServer()).post('/webhooks/stripe-connect').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
  }

  describe('signature verification', () => {
    it('rejects a request with no stripe-signature header', async () => {
      const res = await request(app.getHttpServer()).post('/webhooks/stripe-connect').set('Content-Type', 'application/json').send('{}');
      expect(res.status).toBe(400);
    });

    it('rejects a garbage/invalid signature', async () => {
      const res = await postConnectWebhook('{}', 'not-a-real-signature');
      expect(res.status).toBe(400);
    });

    it('rejects a payload validly signed with the WRONG secret (e.g. the platform webhook secret, never the Connect one)', async () => {
      const payload = JSON.stringify(fakeConnectEvent({ account: 'acct_irrelevant', sessionId: 'cs_test_irrelevant' }));
      // Deliberately signed with the platform secret — Stripe issues a
      // distinct signing secret per endpoint, so this must be rejected
      // exactly like an attacker guessing an unrelated valid secret.
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: platformWebhookSecret });
      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(400);
    });
  });

  describe('connected-account resolution and tenant routing', () => {
    it('a validly-signed event for an unrecognized connected account is safely ignored (200-class, no throw, nothing mutated)', async () => {
      const { payment } = await createPendingOnlinePayment(tenantA, customer1A.customerId, shipment1A.id, 60);
      const payload = JSON.stringify(fakeConnectEvent({ account: 'acct_never_registered', sessionId: payment.providerReference! }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });

      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201);

      const unchanged = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(unchanged.status).toBe('PENDING');
    });

    it('extracts the connected account id correctly and resolves it to the owning tenant, completing that tenant\'s own payment', async () => {
      const connectedAccountId = await connectAccountFor(tenantA);
      const { payment, invoice } = await createPendingOnlinePayment(tenantA, customer1A.customerId, shipment1A.id, 90);

      const payload = JSON.stringify(fakeConnectEvent({ account: connectedAccountId, sessionId: payment.providerReference! }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });

      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201);

      const completed = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(completed.status).toBe('COMPLETED');
      expect(completed.paidAt).not.toBeNull();

      const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(Number(invoiceAfter.amountPaid)).toBe(90);
    });

    it("one tenant's connected-account event can never complete another tenant's payment, even if the session id happens to match", async () => {
      // Tenant A has a connected account. Tenant B has its own PENDING
      // payment. A signed event claims to come from Tenant A's connected
      // account but references Tenant B's own providerReference — this
      // must never happen via Stripe's real attribution (event.account is
      // Stripe's own verified fact about the connected account an event
      // actually originated from), but this is exactly the defense-in-
      // depth case Phase 0's completeOnlinePayment guard exists for, now
      // exercised through the real HTTP endpoint end-to-end.
      const connectedAccountIdA = await connectAccountFor(tenantA);

      const customerB = await createCustomerWithPortalUser(prisma, tenantB.tenantId, 'CB');
      const tenantAdminB = await createUserInTenant(prisma, tenantB.tenantId, 'TenantAdminB', UserRole.OWNER);
      const tenantAdminTokenB = await login(app, tenantAdminB.email, tenantAdminB.password);
      const shipmentB = await createShipmentForCustomerId(app, tenantAdminTokenB, customerB.customerId);
      const invoiceB = await createInvoice(app, tenantAdminTokenB, customerB.customerId, shipmentB.id, 55);
      await request(app.getHttpServer()).post(`/invoices/${invoiceB.id}/issue`).set('Authorization', `Bearer ${tenantAdminTokenB}`);
      const providerReferenceB = `cs_test_fixture_${randomUUID()}`;
      const paymentB = await prisma.payment.create({
        data: {
          tenantId: tenantB.tenantId,
          invoiceId: invoiceB.id,
          customerId: customerB.customerId,
          amount: 55,
          currency: 'USD',
          method: PaymentMethod.CARD,
          status: PaymentStatus.PENDING,
          source: PaymentSource.ONLINE,
          provider: 'STRIPE',
          providerReference: providerReferenceB,
        },
      });

      const payload = JSON.stringify(fakeConnectEvent({ account: connectedAccountIdA, sessionId: providerReferenceB }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });

      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201); // acknowledged (so Stripe doesn't retry forever) — but must not mutate

      const stillPending = await prisma.payment.findUniqueOrThrow({ where: { id: paymentB.id } });
      expect(stillPending.status).toBe('PENDING');

      const invoiceBAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceB.id } });
      expect(Number(invoiceBAfter.amountPaid)).toBe(0);
    });

    it('Phase 2 policy: a checkout.session.completed for an inactive/unready connected account is acknowledged but NOT auto-completed — left PENDING for manual reconciliation', async () => {
      const connectedAccountId = await connectAccountFor(tenantA, { isActive: false });
      const { payment, invoice } = await createPendingOnlinePayment(tenantA, customer1A.customerId, shipment1A.id, 30);

      // The lookup itself still resolves the real tenant (findTenantPaymentSettingsByConnectedAccountId
      // has no isActive filter, by design — see its own doc comment), but
      // the webhook handler's own inactive-account guard refuses to call
      // completeOnlinePayment. See WebhooksController.handleStripeConnectWebhook's
      // own doc comment for the full reasoning.
      const payload = JSON.stringify(fakeConnectEvent({ account: connectedAccountId, sessionId: payment.providerReference! }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });

      const res = await postConnectWebhook(payload, signature);
      expect(res.status).toBe(201); // acknowledged (Stripe must not retry forever) — but never silently completed

      const afterEvent = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(afterEvent.status).toBe('PENDING');

      const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(Number(invoiceAfter.amountPaid)).toBe(0);
    });
  });

  describe('idempotency', () => {
    it('a validly-signed event delivered twice completes the payment exactly once — replay is a no-op', async () => {
      const connectedAccountId = await connectAccountFor(tenantA);
      const { payment, invoice } = await createPendingOnlinePayment(tenantA, customer1A.customerId, shipment1A.id, 45);

      const payload = JSON.stringify(fakeConnectEvent({ account: connectedAccountId, sessionId: payment.providerReference! }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: connectWebhookSecret });

      const first = await postConnectWebhook(payload, signature);
      expect(first.status).toBe(201);

      const second = await postConnectWebhook(payload, signature);
      expect(second.status).toBe(201);

      const afterBoth = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(afterBoth.status).toBe('COMPLETED');

      const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(Number(invoiceAfter.amountPaid)).toBe(45); // not double-applied to 90
    });
  });

  describe('ordinary platform webhook behavior is unaffected by the Connect endpoint existing', () => {
    it('POST /webhooks/stripe (platform account) still completes a real Stripe test-mode checkout session normally', async () => {
      const secretKey = process.env.PLATFORM_STRIPE_SECRET_KEY;
      if (!secretKey) throw new Error('PLATFORM_STRIPE_SECRET_KEY must be configured to run this test.');
      const stripe = new Stripe(secretKey);

      await clearConnectAccountFor(tenantA); // guarantee the pure platform-account path regardless of what earlier tests in this file left behind

      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 65);
      const checkoutRes = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(checkoutRes.status).toBe(201);

      const pending = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      const sessionId = pending.providerReference!;
      const session = await stripe.checkout.sessions.retrieve(sessionId); // succeeds unscoped — proves it's on the platform account, unaffected by Connect

      const payload = JSON.stringify(fakeConnectEvent({ account: undefined, sessionId, platformShape: true }));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: platformWebhookSecret });

      const res = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(res.status).toBe(201);

      const completed = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });
      expect(completed.status).toBe('COMPLETED');
      void session;
    });
  });
});

/** Shapes a fake checkout.session.completed event — `account` at the top level is what makes it a "Connect" event (Stripe's own attribution field); omitted entirely for the platform-shape case. */
function fakeConnectEvent(params: { account: string | undefined; sessionId: string; platformShape?: boolean }) {
  const event: Record<string, unknown> = {
    id: `evt_test_${randomUUID()}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: params.sessionId,
        object: 'checkout.session',
        payment_status: 'paid',
      },
    },
  };
  if (!params.platformShape && params.account) {
    event.account = params.account;
  }
  return event;
}

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function createShipmentForCustomerId(app: INestApplication, staffToken: string, customerId: string): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentMode: 'OCEAN_LCL',
      originCountry: 'US',
      destinationCountry: 'GH',
      recipientName: 'Test Recipient',
      recipientPhone: '+15550000000',
      items: [{ itemType: 'BOX', description: 'Tenant Payments Phase 1 test box' }],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}

async function createInvoice(app: INestApplication, staffToken: string, customerId: string, shipmentId: string, totalAmount: number): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/invoices')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentId,
      currency: 'USD',
      items: [{ description: 'Tenant Payments Phase 1 test charge', unitPrice: totalAmount, quantity: 1 }],
    });
  if (res.status !== 201) {
    throw new Error(`Invoice creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}

async function createIssuedInvoice(
  app: INestApplication,
  staffToken: string,
  customerId: string,
  shipmentId: string,
  totalAmount: number,
): Promise<{ id: string }> {
  const invoice = await createInvoice(app, staffToken, customerId, shipmentId, totalAmount);
  const issueRes = await request(app.getHttpServer())
    .post(`/invoices/${invoice.id}/issue`)
    .set('Authorization', `Bearer ${staffToken}`);
  if (issueRes.status !== 201) {
    throw new Error(`Invoice issue failed: ${issueRes.status} ${JSON.stringify(issueRes.body)}`);
  }
  return invoice;
}
