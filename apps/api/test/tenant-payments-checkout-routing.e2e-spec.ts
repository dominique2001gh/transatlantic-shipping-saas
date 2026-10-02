import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
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
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Tenant Payments Phase 1: coverage for TenantPaymentsStripeService's
 * connected-account routing as exercised through the real checkout-session
 * endpoint (POST /portal/invoices/:id/checkout-session). Cross-tenant
 * invoice ownership rejection is already covered by
 * stripe-checkout.e2e-spec.ts ("Cross-customer and cross-tenant denial")
 * and is not duplicated here — this file is specifically about which
 * Stripe account a checkout session actually gets created against.
 *
 * Never creates a real Stripe Connect account (Express onboarding via
 * Account Links is explicitly out of scope for this phase) — the "active
 * but nonexistent" case deliberately exercises what happens when
 * TenantPaymentSettings points at an account Stripe has never heard of,
 * which is exactly the state a corrupted/stale row would be in, without
 * ever registering a real Connect account anywhere.
 */
describe('Tenant Payments Phase 1: connected-account checkout routing (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let stripe: Stripe;

  let tenantA: TestTenantFixture;
  let tenantAdminTokenA: string;
  let customer1A: TestPortalCustomerFixture;
  let customer1APortalToken: string;
  let shipment1A: { id: string };

  beforeAll(async () => {
    app = await createTestApp();

    const secretKey = process.env.PLATFORM_STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('PLATFORM_STRIPE_SECRET_KEY must be configured in apps/api/.env to run this suite.');
    }
    stripe = new Stripe(secretKey);

    tenantA = await createTestTenant(prisma, 'ConnectRouteA', UserRole.MANAGER);
    const tenantAdminA = await createUserInTenant(prisma, tenantA.tenantId, 'TenantAdmin', UserRole.OWNER);
    tenantAdminTokenA = await login(app, tenantAdminA.email, tenantAdminA.password);

    customer1A = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'C1');
    customer1APortalToken = await login(app, customer1A.user.email, customer1A.user.password);

    shipment1A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer1A.customerId);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  afterEach(async () => {
    // Every test in this file mutates tenantA's TenantPaymentSettings row —
    // start each test from a clean slate rather than relying on execution
    // order (same lesson as tenant-payments-connect-webhook.e2e-spec.ts).
    await prisma.tenantPaymentSettings.deleteMany({ where: { tenantId: tenantA.tenantId } });
  });

  it('with no TenantPaymentSettings row at all (every tenant\'s default), checkout is created on the platform account', async () => {
    const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 80);
    const res = await request(app.getHttpServer())
      .post(`/portal/invoices/${invoice.id}/checkout-session`)
      .set('Authorization', `Bearer ${customer1APortalToken}`);
    expect(res.status).toBe(201);

    const pending = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    // Retrieving with no {stripeAccount} option only succeeds if the
    // session actually lives on the platform's own account.
    const session = await stripe.checkout.sessions.retrieve(pending.providerReference!);
    expect(session.id).toBe(pending.providerReference);
  });

  it('an inactive connected account falls back to the platform account, exactly like no row at all', async () => {
    await prisma.tenantPaymentSettings.create({
      data: { tenantId: tenantA.tenantId, stripeConnectedAccountId: `acct_test_fixture_${randomUUID()}`, isActive: false },
    });

    const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 35);
    const res = await request(app.getHttpServer())
      .post(`/portal/invoices/${invoice.id}/checkout-session`)
      .set('Authorization', `Bearer ${customer1APortalToken}`);
    expect(res.status).toBe(201);

    const pending = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    const session = await stripe.checkout.sessions.retrieve(pending.providerReference!); // succeeds unscoped -> platform account
    expect(session.id).toBe(pending.providerReference);
  });

  it('an active but nonexistent connected account fails safely: no Payment row is created, and the error response leaks no Stripe/account detail', async () => {
    const fakeAccountId = `acct_test_fixture_${randomUUID()}`;
    await prisma.tenantPaymentSettings.create({
      data: { tenantId: tenantA.tenantId, stripeConnectedAccountId: fakeAccountId, isActive: true },
    });

    const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 50);
    const res = await request(app.getHttpServer())
      .post(`/portal/invoices/${invoice.id}/checkout-session`)
      .set('Authorization', `Bearer ${customer1APortalToken}`);

    // Must not silently succeed against the wrong (platform) account when
    // a connected account WAS configured — that would misattribute money.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain(fakeAccountId);
    expect(bodyText.toLowerCase()).not.toContain('stripe');

    const paymentRows = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(paymentRows).toHaveLength(0);

    const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(Number(invoiceAfter.amountPaid)).toBe(0);
  });

  it('the checkout-session request body cannot influence which Stripe account is used — there is no client-suppliable account/tenant field on this route at all', async () => {
    // Defense-in-depth documentation, not a new behavior: the route only
    // ever takes the invoice id from the URL and the tenantId from the
    // verified JWT (see CustomerPortalController.checkoutSession) — this
    // proves an arbitrary extra body field is simply ignored, not
    // silently honored as an override.
    const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 20);
    const res = await request(app.getHttpServer())
      .post(`/portal/invoices/${invoice.id}/checkout-session`)
      .set('Authorization', `Bearer ${customer1APortalToken}`)
      .send({ stripeConnectedAccountId: 'acct_attacker_supplied', tenantId: 'some-other-tenant-id' });
    expect(res.status).toBe(201);

    const pending = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(pending.tenantId).toBe(tenantA.tenantId);
    const session = await stripe.checkout.sessions.retrieve(pending.providerReference!); // still the platform account
    expect(session.id).toBe(pending.providerReference);
  });
});

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  return completeStaffLogin(app, email, password);
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
      items: [{ itemType: 'BOX', description: 'Tenant Payments Phase 1 checkout-routing test box' }],
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
      items: [{ description: 'Tenant Payments Phase 1 checkout-routing test charge', unitPrice: totalAmount, quantity: 1 }],
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
