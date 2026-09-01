import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Stage 3C: dedicated hardening/verification suite for the Stage 3A
 * invoice foundation and Stage 3B manual payment foundation, ahead of
 * exposing either through a UI. Deliberately does NOT re-test everything
 * invoices-foundation.e2e-spec.ts / payments-foundation.e2e-spec.ts
 * already cover (RBAC per role, straightforward cross-tenant/cross-
 * customer rejection, partial/full payment math, basic money formatting)
 * — this suite targets the gaps a security review pass surfaces on top of
 * that: defense-in-depth for the one cross-tenant-capable role, proof
 * that 404s are byte-for-byte indistinguishable between "doesn't exist"
 * and "exists but isn't yours", malformed-id robustness, numeric-overflow
 * protection, and payment-rejection atomicity.
 */
describe('Invoice/Payment security hardening (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let accountantTokenA: string;
  let accountantTokenB: string;
  let customer1IdA: string;
  let shipment1A: { id: string };
  let customerIdB: string;
  let shipmentB: { id: string };

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'SecA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'SecB', UserRole.WAREHOUSE_MANAGER);

    const accountantA = await createUserInTenant(prisma, tenantA.tenantId, 'Accountant', UserRole.ACCOUNTANT);
    const accountantB = await createUserInTenant(prisma, tenantB.tenantId, 'Accountant', UserRole.ACCOUNTANT);
    accountantTokenA = await login(app, accountantA.email, accountantA.password);
    accountantTokenB = await login(app, accountantB.email, accountantB.password);

    customer1IdA = tenantA.customerId;
    customerIdB = tenantB.customerId;

    // tenantA.user/tenantB.user default to WAREHOUSE_MANAGER (in
    // ShipmentsController.OPERATIONS_ROLES) — ACCOUNTANT is deliberately
    // NOT in that list, so shipment creation must use the warehouse
    // manager token, not the accountant token.
    const warehouseManagerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    const warehouseManagerTokenB = await login(app, tenantB.user.email, tenantB.user.password);
    shipment1A = await createShipmentForCustomerId(app, warehouseManagerTokenA, customer1IdA);
    shipmentB = await createShipmentForCustomerId(app, warehouseManagerTokenB, customerIdB);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('Defense-in-depth: the one role with legitimate cross-tenant reach elsewhere is still denied here', () => {
    it('PLATFORM_ADMIN gets 403 on every invoice/payment route, not treated as staff of any tenant', async () => {
      const admin = await prisma.user.create({
        data: {
          tenantId: null,
          email: `platform-admin-invoice-sec-${Date.now()}@example.test`,
          passwordHash: await bcrypt.hash('TestPass123!', 10),
          firstName: 'E2E',
          lastName: 'PlatformAdmin',
          role: UserRole.PLATFORM_ADMIN,
        },
      });
      const adminToken = await login(app, admin.email, 'TestPass123!');

      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);

      const listRes = await request(app.getHttpServer()).get('/invoices').set('Authorization', `Bearer ${adminToken}`);
      const detailRes = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const createRes = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      const paymentRes = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPaymentPayload(10));

      expect(listRes.status).toBe(403);
      expect(detailRes.status).toBe(403);
      expect(createRes.status).toBe(403);
      expect(paymentRes.status).toBe(403);

      await prisma.user.delete({ where: { id: admin.id } });
    });
  });

  describe('Generic 404s never distinguish "does not exist" from "exists but is not yours"', () => {
    it('GET /invoices/:id returns byte-identical 404s for a nonexistent id and a real cross-tenant id', async () => {
      const invoiceA = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);

      const crossTenant = await request(app.getHttpServer())
        .get(`/invoices/${invoiceA.id}`)
        .set('Authorization', `Bearer ${accountantTokenB}`);
      const nonexistent = await request(app.getHttpServer())
        .get('/invoices/definitely-does-not-exist')
        .set('Authorization', `Bearer ${accountantTokenB}`);

      expect(crossTenant.status).toBe(404);
      expect(nonexistent.status).toBe(404);
      expect(crossTenant.body.message).toBe(nonexistent.body.message);
    });

    it('POST /invoices/:id/payments returns byte-identical 404s for both cases', async () => {
      const invoiceA = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);

      const crossTenant = await request(app.getHttpServer())
        .post(`/invoices/${invoiceA.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenB}`)
        .send(validPaymentPayload(10));
      const nonexistent = await request(app.getHttpServer())
        .post('/invoices/definitely-does-not-exist/payments')
        .set('Authorization', `Bearer ${accountantTokenB}`)
        .send(validPaymentPayload(10));

      expect(crossTenant.status).toBe(404);
      expect(nonexistent.status).toBe(404);
      expect(crossTenant.body.message).toBe(nonexistent.body.message);
    });

    it('POST /invoices (create) returns byte-identical 404s for a cross-tenant customerId and a nonexistent customerId', async () => {
      const crossTenant = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customerIdB, shipment1A.id));
      const nonexistent = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload('definitely-does-not-exist', shipment1A.id));

      expect(crossTenant.status).toBe(404);
      expect(nonexistent.status).toBe(404);
      expect(crossTenant.body.message).toBe(nonexistent.body.message);
    });

    it('issuing returns byte-identical 404s for a cross-tenant id and a nonexistent id', async () => {
      const invoiceA = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);

      const crossTenant = await request(app.getHttpServer())
        .post(`/invoices/${invoiceA.id}/issue`)
        .set('Authorization', `Bearer ${accountantTokenB}`);
      const nonexistent = await request(app.getHttpServer())
        .post('/invoices/definitely-does-not-exist/issue')
        .set('Authorization', `Bearer ${accountantTokenB}`);

      expect(crossTenant.status).toBe(404);
      expect(nonexistent.status).toBe(404);
      expect(crossTenant.body.message).toBe(nonexistent.body.message);
    });
  });

  describe('Manipulated/malformed id robustness — never a 500, never a crash', () => {
    it('a garbage, non-cuid-shaped invoice id 404s cleanly on every route', async () => {
      const garbage = "'; DROP TABLE invoices; --";
      const getRes = await request(app.getHttpServer())
        .get(`/invoices/${encodeURIComponent(garbage)}`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      const paymentsRes = await request(app.getHttpServer())
        .get(`/invoices/${encodeURIComponent(garbage)}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      expect(getRes.status).toBe(404);
      expect(paymentsRes.status).toBe(404);
    });

    it('filtering the invoice list by a foreign tenant\'s customerId/shipmentId returns an empty list, never an error or a leaked row', async () => {
      await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);

      const byForeignCustomer = await request(app.getHttpServer())
        .get(`/invoices?customerId=${customerIdB}`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      const byForeignShipment = await request(app.getHttpServer())
        .get(`/invoices?shipmentId=${shipmentB.id}`)
        .set('Authorization', `Bearer ${accountantTokenA}`);

      expect(byForeignCustomer.status).toBe(200);
      expect(byForeignCustomer.body).toEqual([]);
      expect(byForeignShipment.status).toBe(200);
      expect(byForeignShipment.body).toEqual([]);
    });

    it("tenant A's unfiltered invoice list never contains any of tenant B's invoices, even with several invoices on both sides", async () => {
      await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 50);
      await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 75);
      const invoiceB1 = await createIssuedInvoice(app, accountantTokenB, customerIdB, shipmentB.id, 60);
      const invoiceB2 = await createIssuedInvoice(app, accountantTokenB, customerIdB, shipmentB.id, 90);

      const listA = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`);
      expect(listA.status).toBe(200);
      const idsInA = listA.body.map((inv: { id: string }) => inv.id);
      expect(idsInA).not.toContain(invoiceB1.id);
      expect(idsInA).not.toContain(invoiceB2.id);
      expect(listA.body.every((inv: { tenantId: string }) => inv.tenantId === tenantA.tenantId)).toBe(true);
    });
  });

  describe('Numeric overflow protection (Decimal(12,2) column ceiling)', () => {
    it('rejects an invoice whose computed total would exceed the money column\'s precision, with a clean 400 (never a raw DB error)', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({
          customerId: customer1IdA,
          shipmentId: shipment1A.id,
          currency: 'USD',
          items: [{ description: 'Absurd charge', unitPrice: 99999999999, quantity: 1 }],
        });
      expect(res.status).toBe(400);
      expect(res.body.message).not.toMatch(/prisma|postgres|internal server error/i);
    });
  });

  describe('Payment rejection is atomic — no partial mutation on a rejected attempt', () => {
    it("invoice amountPaid/status are unchanged after a rejected overpayment attempt", async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      await postPayment(app, accountantTokenA, invoice.id, 40);

      const beforeAttempt = await getInvoice(app, accountantTokenA, invoice.id);
      expect(beforeAttempt.amountPaid).toBe('40.00');
      expect(beforeAttempt.status).toBe('PARTIALLY_PAID');

      const overpayAttempt = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(1000));
      expect(overpayAttempt.status).toBe(400);

      const afterAttempt = await getInvoice(app, accountantTokenA, invoice.id);
      expect(afterAttempt.amountPaid).toBe('40.00');
      expect(afterAttempt.status).toBe('PARTIALLY_PAID');
      expect(afterAttempt.balanceDue).toBe('60.00');
    });

    it('no payment row is created for a rejected (zero-amount) attempt', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(0));

      const listRes = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      expect(listRes.body).toEqual([]);
    });
  });

  describe('Money serialization edge cases', () => {
    it('a whole-dollar amount still serializes with two decimal places ("100.00", never "100")', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const detail = await getInvoice(app, accountantTokenA, invoice.id);
      expect(detail.total).toBe('100.00');

      const payment = await postPayment(app, accountantTokenA, invoice.id, 100);
      expect(payment.amount).toBe('100.00');
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing per-file-helpers convention.
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

function validInvoicePayload(customerId: string, shipmentId: string) {
  return {
    customerId,
    shipmentId,
    currency: 'USD',
    items: [{ description: 'Ocean freight charge', unitPrice: 100, quantity: 1 }],
  };
}

function validPaymentPayload(amount: number) {
  return { amount, method: 'CASH' as const };
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
      items: [{ itemType: ShipmentItemType.BOX, description: 'Security e2e test box' }],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}

async function createIssuedInvoice(
  app: INestApplication,
  staffToken: string,
  customerId: string,
  shipmentId: string,
  totalAmount: number,
): Promise<{ id: string; total: string }> {
  const createRes = await request(app.getHttpServer())
    .post('/invoices')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentId,
      currency: 'USD',
      items: [{ description: 'Freight charge', unitPrice: totalAmount, quantity: 1 }],
    });
  if (createRes.status !== 201) {
    throw new Error(`Invoice creation failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  }
  const issueRes = await request(app.getHttpServer())
    .post(`/invoices/${createRes.body.id}/issue`)
    .set('Authorization', `Bearer ${staffToken}`);
  if (issueRes.status !== 201) {
    throw new Error(`Invoice issue failed: ${issueRes.status} ${JSON.stringify(issueRes.body)}`);
  }
  return issueRes.body as { id: string; total: string };
}

async function postPayment(
  app: INestApplication,
  staffToken: string,
  invoiceId: string,
  amount: number,
): Promise<{ id: string; amount: string; customerId: string; paidAt: string }> {
  const res = await request(app.getHttpServer())
    .post(`/invoices/${invoiceId}/payments`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send(validPaymentPayload(amount));
  if (res.status !== 201) {
    throw new Error(`Payment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function getInvoice(app: INestApplication, staffToken: string, invoiceId: string) {
  const res = await request(app.getHttpServer())
    .get(`/invoices/${invoiceId}`)
    .set('Authorization', `Bearer ${staffToken}`);
  if (res.status !== 200) {
    throw new Error(`Get invoice failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
