import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import Stripe from 'stripe';
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
 * Stage 3F: proves the customer self-service online-payment surface —
 * Checkout Session creation (POST /portal/invoices/:id/checkout-session)
 * and the Stripe webhook (POST /webhooks/stripe) that confirms it.
 *
 * This hits Stripe's real test-mode API using the STRIPE_SECRET_KEY
 * already configured in apps/api/.env — the same "no mocking layer,
 * exercise the real thing" convention every other e2e spec in this suite
 * already follows for Postgres (see test-app.ts's own doc comment).
 * Webhook events are constructed and signed locally with
 * Stripe.webhooks.generateTestHeaderString (the SDK's own supported
 * testing utility) against the real STRIPE_WEBHOOK_SECRET, so these tests
 * never depend on the `stripe listen` CLI actually running.
 */
describe('Stripe Checkout: online invoice payments (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let stripe: Stripe;
  let webhookSecret: string;

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tenantAdminTokenA: string;

  let customer1A: TestPortalCustomerFixture;
  let customer2A: TestPortalCustomerFixture;
  let customerB: TestPortalCustomerFixture;
  let customer1APortalToken: string;
  let customer2APortalToken: string;
  let customerBPortalToken: string;

  let shipment1A: { id: string };

  beforeAll(async () => {
    app = await createTestApp();

    // Booting the real AppModule (ConfigModule.forRoot) loads apps/api/.env
    // via dotenv, which populates process.env as a side effect — reading
    // these here (never logging them) is how this file signs webhook
    // payloads with the exact same secret the running app verifies
    // against, without ever hard-coding or printing a secret value.
    const secretKey = process.env.STRIPE_SECRET_KEY;
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    if (!secretKey || !webhookSecret) {
      throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured in apps/api/.env to run this suite.');
    }
    stripe = new Stripe(secretKey);

    tenantA = await createTestTenant(prisma, 'StripeA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'StripeB', UserRole.WAREHOUSE_MANAGER);

    const tenantAdminA = await createUserInTenant(prisma, tenantA.tenantId, 'TenantAdmin', UserRole.TENANT_ADMIN);
    tenantAdminTokenA = await login(app, tenantAdminA.email, tenantAdminA.password);

    customer1A = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'C1');
    customer2A = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'C2');
    customerB = await createCustomerWithPortalUser(prisma, tenantB.tenantId, 'CB');
    customer1APortalToken = await login(app, customer1A.user.email, customer1A.user.password);
    customer2APortalToken = await login(app, customer2A.user.email, customer2A.user.password);
    customerBPortalToken = await login(app, customerB.user.email, customerB.user.password);

    shipment1A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer1A.customerId);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('RBAC', () => {
    it('a staff token gets 403 on POST /portal/invoices/:id/checkout-session', async () => {
      const res = await request(app.getHttpServer())
        .post('/portal/invoices/does-not-matter/checkout-session')
        .set('Authorization', `Bearer ${tenantAdminTokenA}`);
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request gets 401', async () => {
      const res = await request(app.getHttpServer()).post('/portal/invoices/does-not-matter/checkout-session');
      expect(res.status).toBe(401);
    });
  });

  describe('Draft/paid invoice denial', () => {
    it('a DRAFT invoice 404s exactly like Stage 3E invoice detail — never distinguishable from nonexistent', async () => {
      const draft = await createInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/portal/invoices/${draft.id}/checkout-session`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(res.status).toBe(404);
    });

    it('a fully-PAID invoice is rejected with 400 — nothing left to pay online', async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 60);
      await recordPayment(app, tenantAdminTokenA, invoice.id, 60);

      const res = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Cross-customer and cross-tenant denial', () => {
    it("customer2 gets 404 starting checkout on customer1's invoice", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(res.status).toBe(404);
    });

    it("a tenant B customer gets 404 starting checkout on tenant A's invoice", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${customerBPortalToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Valid checkout creation — balance, currency, and superseding', () => {
    it("creates a real Stripe Checkout Session for exactly the invoice's balance and currency", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 150);

      const res = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(res.status).toBe(201);
      expect(typeof res.body.url).toBe('string');
      expect(res.body.url).toContain('stripe.com');

      const pending = await prisma.payment.findFirst({ where: { invoiceId: invoice.id } });
      expect(pending).not.toBeNull();
      expect(pending?.status).toBe('PENDING');
      expect(pending?.source).toBe('ONLINE');
      expect(pending?.provider).toBe('STRIPE');
      expect(pending?.providerReference).toBeTruthy();
      expect(Number(pending?.amount)).toBe(150);

      const session = await stripe.checkout.sessions.retrieve(pending!.providerReference!);
      expect(session.amount_total).toBe(15000); // $150.00 in cents
      expect(session.currency).toBe('usd');
    });

    it('creating a second checkout session expires the first (at most one payable session per invoice)', async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 80);

      const first = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(first.status).toBe(201);
      const firstPending = await prisma.payment.findFirst({ where: { invoiceId: invoice.id } });

      const second = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(second.status).toBe(201);

      const allPayments = await prisma.payment.findMany({ where: { invoiceId: invoice.id }, orderBy: { createdAt: 'asc' } });
      expect(allPayments).toHaveLength(2);
      expect(allPayments[0].id).toBe(firstPending?.id);
      expect(allPayments[0].status).toBe('FAILED');
      expect(allPayments[1].status).toBe('PENDING');

      const expiredSession = await stripe.checkout.sessions.retrieve(allPayments[0].providerReference!);
      expect(expiredSession.status).toBe('expired');
    });
  });

  describe('Webhook: signature verification', () => {
    it('rejects a request with no stripe-signature header', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'checkout.session.completed' }));
      expect(res.status).toBe(400);
    });

    it('rejects a request with a garbage/invalid signature', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=not-a-real-signature')
        .send(JSON.stringify({ type: 'checkout.session.completed' }));
      expect(res.status).toBe(400);
    });

    it('rejects a payload signed with the wrong secret', async () => {
      const payload = JSON.stringify(fakeCheckoutCompletedEvent('cs_test_doesnotexist', 'paid'));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_totally_wrong_secret' });
      const res = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(res.status).toBe(400);
    });
  });

  describe('Webhook: successful payment recording and idempotency', () => {
    it('a validly-signed checkout.session.completed event completes the payment and updates the invoice — replaying the identical event does not double-apply it', async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 200);
      const checkoutRes = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(checkoutRes.status).toBe(201);
      const pending = await prisma.payment.findFirst({ where: { invoiceId: invoice.id } });
      const sessionId = pending!.providerReference!;

      const payload = JSON.stringify(fakeCheckoutCompletedEvent(sessionId, 'paid'));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      // First delivery: applies the payment.
      const first = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(first.status).toBe(201);

      const afterFirst = await prisma.payment.findUnique({ where: { id: pending!.id } });
      expect(afterFirst?.status).toBe('COMPLETED');
      expect(afterFirst?.paidAt).not.toBeNull();

      const invoiceAfterFirst = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(Number(invoiceAfterFirst.amountPaid)).toBe(200);
      expect(invoiceAfterFirst.status).toBe('PAID');

      // Second, identical delivery (Stripe's own "at least once" retry
      // behavior): must be a no-op, not a double-apply.
      const second = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(second.status).toBe(201);

      const allPaymentsForInvoice = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
      expect(allPaymentsForInvoice).toHaveLength(1);

      const invoiceAfterReplay = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(Number(invoiceAfterReplay.amountPaid)).toBe(200); // unchanged, not 400
      expect(invoiceAfterReplay.status).toBe('PAID');

      // Confirms the customer portal, invoice status, amount paid, balance,
      // and payment history all update consistently from this one webhook.
      const portalDetail = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(portalDetail.status).toBe(200);
      expect(portalDetail.body.status).toBe('PAID');
      expect(portalDetail.body.amountPaid).toBe('200.00');
      expect(portalDetail.body.balanceDue).toBe('0.00');
      expect(portalDetail.body.payments).toHaveLength(1);
      expect(portalDetail.body.payments[0].source).toBe('ONLINE');
      expect(portalDetail.body.payments[0].status).toBe('COMPLETED');
      expect(portalDetail.body.payments[0].amount).toBe('200.00');

      // Staff-side view agrees.
      const staffPayments = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`);
      expect(staffPayments.status).toBe(200);
      expect(staffPayments.body).toHaveLength(1);
      expect(staffPayments.body[0].source).toBe('ONLINE');
    });

    it('a webhook event for an unknown session id is safely ignored (200-class response, no throw)', async () => {
      const payload = JSON.stringify(fakeCheckoutCompletedEvent('cs_test_never_created_by_this_app', 'paid'));
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const res = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);
      expect(res.status).toBe(201);
    });
  });

  describe('Existing manual payment recording is unaffected', () => {
    it('a staff-recorded manual payment is still tagged source MANUAL with no provider', async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 40);
      const res = await recordPaymentRaw(app, tenantAdminTokenA, invoice.id, 40);
      expect(res.status).toBe(201);
      expect(res.body.source).toBe('MANUAL');
      expect(res.body.provider).toBeNull();
      expect(res.body.status).toBe('COMPLETED');
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention (see customer-portal-invoices.e2e-spec.ts).
// ---------------------------------------------------------------------------

/** Shapes a minimal Stripe checkout.session.completed event body — just enough for this app's webhook handler, which only reads event.type and data.object.{id,payment_status}. */
function fakeCheckoutCompletedEvent(sessionId: string, paymentStatus: 'paid' | 'unpaid') {
  return {
    id: `evt_test_${sessionId}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_status: paymentStatus,
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

async function createShipmentForCustomerId(
  app: INestApplication,
  staffToken: string,
  customerId: string,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      items: [{ itemType: ShipmentItemType.BOX, description: 'Stripe checkout e2e test box' }],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}

async function createInvoice(
  app: INestApplication,
  staffToken: string,
  customerId: string,
  shipmentId: string,
  totalAmount: number,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/invoices')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentId,
      currency: 'USD',
      items: [{ description: 'Freight charge', unitPrice: totalAmount, quantity: 1 }],
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

async function recordPayment(app: INestApplication, staffToken: string, invoiceId: string, amount: number): Promise<void> {
  const res = await recordPaymentRaw(app, staffToken, invoiceId, amount);
  if (res.status !== 201) {
    throw new Error(`Payment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

function recordPaymentRaw(app: INestApplication, staffToken: string, invoiceId: string, amount: number) {
  return request(app.getHttpServer())
    .post(`/invoices/${invoiceId}/payments`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ amount, method: 'CASH' });
}
