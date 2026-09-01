import { INestApplication } from '@nestjs/common';
import { InvoiceStatus, PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Stage 3B: end-to-end proof of manual payment recording's authorization
 * boundary and money/balance correctness — RBAC (mirrors invoice
 * management roles exactly), tenant isolation, customer-attribution
 * safety, overpayment/zero/negative rejection, and Decimal-accurate
 * balance derivation across multiple payments. No provider integration,
 * no refunds, no payment editing — all out of scope for this stage.
 */
describe('Payment foundation: RBAC, isolation, balance/status derivation, money (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;

  let accountantTokenA: string;
  let tenantAdminTokenA: string;
  let customerServiceTokenA: string;
  let warehouseManagerTokenA: string;
  let warehouseStaffTokenA: string;
  let driverTokenA: string;
  let customerPortalTokenA: string;
  let accountantTokenB: string;

  let customer1IdA: string;
  let shipment1A: { id: string };
  let customerIdB: string;
  let shipmentB: { id: string };

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'PayA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'PayB', UserRole.WAREHOUSE_MANAGER);

    const accountantA = await createUserInTenant(prisma, tenantA.tenantId, 'Accountant', UserRole.ACCOUNTANT);
    const tenantAdminA = await createUserInTenant(prisma, tenantA.tenantId, 'TenantAdmin', UserRole.TENANT_ADMIN);
    const customerServiceA = await createUserInTenant(
      prisma,
      tenantA.tenantId,
      'CustomerService',
      UserRole.CUSTOMER_SERVICE,
    );
    const warehouseStaffA = await createUserInTenant(
      prisma,
      tenantA.tenantId,
      'WarehouseStaff',
      UserRole.WAREHOUSE_STAFF,
    );
    const driverA = await createUserInTenant(prisma, tenantA.tenantId, 'Driver', UserRole.DRIVER);
    const accountantB = await createUserInTenant(prisma, tenantB.tenantId, 'Accountant', UserRole.ACCOUNTANT);

    accountantTokenA = await login(app, accountantA.email, accountantA.password);
    tenantAdminTokenA = await login(app, tenantAdminA.email, tenantAdminA.password);
    customerServiceTokenA = await login(app, customerServiceA.email, customerServiceA.password);
    warehouseManagerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    warehouseStaffTokenA = await login(app, warehouseStaffA.email, warehouseStaffA.password);
    driverTokenA = await login(app, driverA.email, driverA.password);
    accountantTokenB = await login(app, accountantB.email, accountantB.password);

    const customerUser = await prisma.user.create({
      data: {
        tenantId: tenantA.tenantId,
        email: `payment-portal-${Date.now()}@example.test`,
        passwordHash: await bcrypt.hash('TestPass123!', 10),
        firstName: 'Portal',
        lastName: 'Customer',
        role: UserRole.CUSTOMER,
      },
    });
    await prisma.customer.update({ where: { id: tenantA.customerId }, data: { userId: customerUser.id } });
    customerPortalTokenA = await login(app, customerUser.email, 'TestPass123!');

    customer1IdA = tenantA.customerId;
    customerIdB = tenantB.customerId;

    const warehouseManagerTokenB = await login(app, tenantB.user.email, tenantB.user.password);
    shipment1A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer1IdA);
    shipmentB = await createShipmentForCustomerId(app, warehouseManagerTokenB, customerIdB);
    // Heavier setup than most other suites (2 tenants, 7 users each requiring
    // its own bcrypt hash + login round trip) — jest's default 5000ms hook
    // timeout is too tight for this under sequential, single-worker load.
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('RBAC: warehouse-only operational roles never get payment access', () => {
    it('WAREHOUSE_MANAGER gets 403 on both GET and POST payments', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const getRes = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${warehouseManagerTokenA}`);
      expect(getRes.status).toBe(403);
      const postRes = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${warehouseManagerTokenA}`)
        .send(validPaymentPayload(50));
      expect(postRes.status).toBe(403);
    });

    it('WAREHOUSE_STAFF gets 403', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${warehouseStaffTokenA}`);
      expect(res.status).toBe(403);
    });

    it('DRIVER gets 403', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${driverTokenA}`);
      expect(res.status).toBe(403);
    });

    it('a CUSTOMER-role token gets 403 — cannot record its own payment via the staff API', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${customerPortalTokenA}`)
        .send(validPaymentPayload(50));
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request gets 401', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer()).get(`/invoices/${invoice.id}/payments`);
      expect(res.status).toBe(401);
    });
  });

  describe('RBAC: office/accounting staff can record payments', () => {
    it.each([
      ['ACCOUNTANT', () => accountantTokenA],
      ['TENANT_ADMIN', () => tenantAdminTokenA],
      ['CUSTOMER_SERVICE', () => customerServiceTokenA],
    ])('%s can record a payment', async (_label, getToken) => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${getToken()}`)
        .send(validPaymentPayload(50));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('COMPLETED');
    });
  });

  describe('Partial and full payment, invoice balance/status derivation', () => {
    it('a partial payment sets the invoice to PARTIALLY_PAID with the correct balance', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 300);
      await postPayment(app, accountantTokenA, invoice.id, 100);

      const detail = await getInvoice(app, accountantTokenA, invoice.id);
      expect(detail.amountPaid).toBe('100.00');
      expect(detail.balanceDue).toBe('200.00');
      expect(detail.status).toBe('PARTIALLY_PAID');
    });

    it('paying the remaining balance moves the invoice to PAID', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 300);
      await postPayment(app, accountantTokenA, invoice.id, 100);
      await postPayment(app, accountantTokenA, invoice.id, 200);

      const detail = await getInvoice(app, accountantTokenA, invoice.id);
      expect(detail.amountPaid).toBe('300.00');
      expect(detail.balanceDue).toBe('0.00');
      expect(detail.status).toBe('PAID');
    });

    it('paying the full amount in one payment moves a SENT invoice straight to PAID', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 150);
      await postPayment(app, accountantTokenA, invoice.id, 150);
      const detail = await getInvoice(app, accountantTokenA, invoice.id);
      expect(detail.status).toBe('PAID');
      expect(detail.balanceDue).toBe('0.00');
    });

    it('three sequential payments summing to the exact total avoid floating-point drift (33.33 + 33.33 + 33.34 = 100.00)', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      await postPayment(app, accountantTokenA, invoice.id, 33.33);
      await postPayment(app, accountantTokenA, invoice.id, 33.33);
      const finalPayment = await postPayment(app, accountantTokenA, invoice.id, 33.34);
      expect(finalPayment.amount).toBe('33.34');

      const detail = await getInvoice(app, accountantTokenA, invoice.id);
      expect(detail.amountPaid).toBe('100.00');
      expect(detail.balanceDue).toBe('0.00');
      expect(detail.status).toBe('PAID');
    });

    it('lists all payments recorded against an invoice, oldest first', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 300);
      await postPayment(app, accountantTokenA, invoice.id, 100);
      await postPayment(app, accountantTokenA, invoice.id, 100);

      const res = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.every((p: { amount: string }) => p.amount === '100.00')).toBe(true);
    });
  });

  describe('Zero/negative payment rejection', () => {
    it('rejects a zero-amount payment', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(0));
      expect(res.status).toBe(400);
    });

    it('rejects a negative-amount payment', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(-10));
      expect(res.status).toBe(400);
    });
  });

  describe('Overpayment rejection (no credit-balance concept in V1)', () => {
    it('rejects a payment that would exceed the invoice total', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(100.01));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/exceed/i);
    });

    it('rejects any further payment once an invoice is already fully paid', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      await postPayment(app, accountantTokenA, invoice.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(0.01));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already fully paid/i);
    });

    it('accepts a payment that exactly equals the remaining balance (not treated as overpayment)', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(100));
      expect(res.status).toBe(201);
    });
  });

  describe('Invoice status guards', () => {
    it('rejects a payment against a DRAFT (never issued) invoice', async () => {
      const draftRes = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({
          customerId: customer1IdA,
          shipmentId: shipment1A.id,
          currency: 'USD',
          items: [{ description: 'Freight', unitPrice: 100, quantity: 1 }],
        });
      expect(draftRes.body.status).toBe('DRAFT');

      const res = await request(app.getHttpServer())
        .post(`/invoices/${draftRes.body.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(50));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/must be issued/i);
    });

    it('rejects a payment against a VOID invoice', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.VOID } });

      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(50));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/voided/i);
    });
  });

  describe('Cross-customer attribution safety', () => {
    it('rejects a request body that tries to inject a customerId field (structurally impossible, not just ignored)', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({ ...validPaymentPayload(50), customerId: 'someone-elses-customer-id' });
      expect(res.status).toBe(400);
    });

    it("a recorded payment's customerId always matches the invoice's own customer, never anything else", async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const payment = await postPayment(app, accountantTokenA, invoice.id, 50);
      expect(payment.customerId).toBe(customer1IdA);
    });
  });

  describe('Cross-tenant isolation', () => {
    it("tenant B cannot record a payment against tenant A's invoice", async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenB}`)
        .send(validPaymentPayload(50));
      expect(res.status).toBe(404);
    });

    it("tenant B cannot list tenant A's invoice payments", async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      await postPayment(app, accountantTokenA, invoice.id, 50);
      const res = await request(app.getHttpServer())
        .get(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenB}`);
      expect(res.status).toBe(404);
    });

    it("tenant A cannot record a payment against tenant B's invoice", async () => {
      const invoiceB = await createIssuedInvoice(app, accountantTokenB, customerIdB, shipmentB.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoiceB.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validPaymentPayload(50));
      expect(res.status).toBe(404);
    });
  });

  describe('Money serialization', () => {
    it('formats amount as a fixed 2-decimal-place string, stores currency/method/reference/notes/paidAt correctly', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({
          amount: 42.5,
          method: 'BANK_TRANSFER',
          referenceNumber: 'TXN-12345',
          notes: 'Confirmed via bank statement',
          paidAt: '2026-08-15T00:00:00.000Z',
        });
      expect(res.status).toBe(201);
      expect(typeof res.body.amount).toBe('string');
      expect(res.body.amount).toBe('42.50');
      expect(res.body.currency).toBe('USD'); // derived from the invoice, never client-supplied
      expect(res.body.method).toBe('BANK_TRANSFER');
      expect(res.body.referenceNumber).toBe('TXN-12345');
      expect(res.body.notes).toBe('Confirmed via bank statement');
      expect(res.body.paidAt).toBe('2026-08-15T00:00:00.000Z');
    });

    it('defaults paidAt to now() when omitted', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      const before = Date.now();
      const payment = await postPayment(app, accountantTokenA, invoice.id, 50);
      const paidAtMs = new Date(payment.paidAt).getTime();
      expect(paidAtMs).toBeGreaterThanOrEqual(before - 5000);
      expect(paidAtMs).toBeLessThanOrEqual(Date.now() + 5000);
    });
  });

  describe('Stage 3D: tenant-wide payment list (GET /payments)', () => {
    it('WAREHOUSE_MANAGER gets 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${warehouseManagerTokenA}`);
      expect(res.status).toBe(403);
    });

    it('a CUSTOMER-role token gets 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set('Authorization', `Bearer ${customerPortalTokenA}`);
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request gets 401', async () => {
      const res = await request(app.getHttpServer()).get('/payments');
      expect(res.status).toBe(401);
    });

    it('ACCOUNTANT/TENANT_ADMIN/CUSTOMER_SERVICE can list tenant-wide payments, enriched with invoiceNumber/customerName', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 100);
      await postPayment(app, accountantTokenA, invoice.id, 60);

      for (const token of [accountantTokenA, tenantAdminTokenA, customerServiceTokenA]) {
        const res = await request(app.getHttpServer()).get('/payments').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        const row = res.body.find((p: { invoiceId: string }) => p.invoiceId === invoice.id);
        expect(row).toBeDefined();
        expect(row.amount).toBe('60.00');
        expect(typeof row.invoiceNumber).toBe('string');
        expect(typeof row.customerName).toBe('string');
      }
    });

    it("tenant A's payment list never contains tenant B's payments, even with payments recorded on both sides", async () => {
      const invoiceA = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 50);
      await postPayment(app, accountantTokenA, invoiceA.id, 50);
      const invoiceB = await createIssuedInvoice(app, accountantTokenB, customerIdB, shipmentB.id, 70);
      await postPayment(app, accountantTokenB, invoiceB.id, 70);

      const listA = await request(app.getHttpServer()).get('/payments').set('Authorization', `Bearer ${accountantTokenA}`);
      expect(listA.status).toBe(200);
      expect(listA.body.every((p: { tenantId: string }) => p.tenantId === tenantA.tenantId)).toBe(true);
      expect(listA.body.some((p: { invoiceId: string }) => p.invoiceId === invoiceB.id)).toBe(false);
    });

    it('filters by invoiceId and customerId, scoped to the caller\'s own tenant', async () => {
      const invoice = await createIssuedInvoice(app, accountantTokenA, customer1IdA, shipment1A.id, 40);
      await postPayment(app, accountantTokenA, invoice.id, 40);

      const byInvoice = await request(app.getHttpServer())
        .get(`/payments?invoiceId=${invoice.id}`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      expect(byInvoice.body).toHaveLength(1);
      expect(byInvoice.body[0].invoiceId).toBe(invoice.id);

      const byForeignCustomer = await request(app.getHttpServer())
        .get(`/payments?customerId=${customerIdB}`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      expect(byForeignCustomer.body).toEqual([]);
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
      items: [{ itemType: ShipmentItemType.BOX, description: 'Payment foundation e2e test box' }],
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
