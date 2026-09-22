import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { PaymentsService } from '../src/payments/payments.service';
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
 * Tenant Payments Phase 0: regression coverage for the one concrete
 * tenant-isolation gap identified in the pre-implementation assessment —
 * PaymentsService.completeOnlinePayment previously looked up a Payment
 * row by providerReference alone, with no cross-check against which
 * tenant a Stripe Connect webhook actually resolved. This proves the new
 * optional `expectedTenantId` guard rejects a mismatch without touching
 * the payment, while leaving the existing (no-tenantId-passed) platform-
 * webhook call path — covered by stripe-checkout.e2e-spec.ts — completely
 * unchanged.
 *
 * Calls PaymentsService directly (app.get(PaymentsService), the same
 * pattern phase2-saas-additions.e2e-spec.ts already uses for
 * BillingSchedulerService) rather than over HTTP — this is the
 * server-to-server webhook boundary itself, not a client-facing route,
 * and no Stripe Connect account exists in any test environment to
 * legitimately sign a real Connect webhook event against.
 */
describe('Tenant Payments Phase 0: completeOnlinePayment tenant isolation (e2e)', () => {
  let app: INestApplication;
  let paymentsService: PaymentsService;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tenantAdminTokenA: string;
  let customer1A: TestPortalCustomerFixture;
  let customer1APortalToken: string;
  let shipment1A: { id: string };

  beforeAll(async () => {
    app = await createTestApp();
    paymentsService = app.get(PaymentsService);

    tenantA = await createTestTenant(prisma, 'TPPhase0A', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'TPPhase0B', UserRole.MANAGER);

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

  it('refuses to complete a payment when expectedTenantId does not match the payment\'s own tenant', async () => {
    const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 150);
    const checkoutRes = await request(app.getHttpServer())
      .post(`/portal/invoices/${invoice.id}/checkout-session`)
      .set('Authorization', `Bearer ${customer1APortalToken}`);
    expect(checkoutRes.status).toBe(201);

    const pending = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(pending.tenantId).toBe(tenantA.tenantId);

    // Simulates what a Connect webhook would do if event.account resolved
    // to the WRONG tenant for this session — must never happen in
    // practice (Stripe's own account attribution is what resolves
    // tenantId before this is ever called), but this is exactly the
    // defense-in-depth check that must hold if it somehow did.
    const rejected = await paymentsService.completeOnlinePayment(pending.providerReference!, new Date(), tenantB.tenantId);
    expect(rejected).toBeNull();

    const stillPending = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stillPending.status).toBe('PENDING');

    const invoiceUntouched = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(Number(invoiceUntouched.amountPaid)).toBe(0);
  });

  it('completes normally when expectedTenantId matches the payment\'s own tenant', async () => {
    const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 75);
    const checkoutRes = await request(app.getHttpServer())
      .post(`/portal/invoices/${invoice.id}/checkout-session`)
      .set('Authorization', `Bearer ${customer1APortalToken}`);
    expect(checkoutRes.status).toBe(201);

    const pending = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });

    const completed = await paymentsService.completeOnlinePayment(pending.providerReference!, new Date(), tenantA.tenantId);
    expect(completed).not.toBeNull();

    const afterComplete = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });
    expect(afterComplete.status).toBe('COMPLETED');
  });

  it('omitting expectedTenantId (the existing platform-webhook call shape) still completes the payment unchanged', async () => {
    const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 40);
    const checkoutRes = await request(app.getHttpServer())
      .post(`/portal/invoices/${invoice.id}/checkout-session`)
      .set('Authorization', `Bearer ${customer1APortalToken}`);
    expect(checkoutRes.status).toBe(201);

    const pending = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });

    const completed = await paymentsService.completeOnlinePayment(pending.providerReference!, new Date());
    expect(completed).not.toBeNull();

    const afterComplete = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });
    expect(afterComplete.status).toBe('COMPLETED');
  });
});

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
      items: [{ itemType: 'BOX', description: 'Tenant Payments Phase 0 test box' }],
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
      items: [{ description: 'Tenant Payments Phase 0 test charge', unitPrice: totalAmount, quantity: 1 }],
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
