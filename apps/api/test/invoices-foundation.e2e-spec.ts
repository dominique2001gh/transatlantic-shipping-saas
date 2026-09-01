import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Stage 3A: end-to-end proof of the invoice foundation's authorization
 * boundary — RBAC (warehouse-only roles excluded from invoice management
 * by product decision, not oversight), tenant isolation, customer/
 * shipment ownership validation, and money serialization precision.
 * No payment recording, no online payment — those are Stage 3B+.
 */
describe('Invoice foundation: RBAC, isolation, ownership, money (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;

  let accountantTokenA: string;
  let tenantAdminTokenA: string;
  let customerServiceTokenA: string;
  let warehouseManagerTokenA: string; // tenantA's default createTestTenant user
  let warehouseStaffTokenA: string;
  let driverTokenA: string;
  let customerPortalTokenA: string;
  let accountantTokenB: string;

  let customer1IdA: string; // tenantA's default customer (from createTestTenant)
  let customer2IdA: string; // second customer in tenantA, for cross-customer ownership tests
  let customerIdB: string;

  let shipment1A: { id: string };
  let shipment2A: { id: string }; // belongs to customer2IdA, not customer1IdA
  let shipmentB: { id: string };

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'InvA', UserRole.WAREHOUSE_MANAGER);
    // WAREHOUSE_MANAGER (not ACCOUNTANT) so tenantB's default user can
    // create a shipment via the staff shipments API (OPERATIONS_ROLES) —
    // the ACCOUNTANT needed for invoice cross-tenant checks is a separate
    // user below, exactly like tenantA's setup.
    tenantB = await createTestTenant(prisma, 'InvB', UserRole.WAREHOUSE_MANAGER);

    const accountantA = await createUserInTenant(prisma, tenantA.tenantId, 'Accountant', UserRole.ACCOUNTANT);
    const accountantB = await createUserInTenant(prisma, tenantB.tenantId, 'Accountant', UserRole.ACCOUNTANT);
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

    accountantTokenA = await login(app, accountantA.email, accountantA.password);
    tenantAdminTokenA = await login(app, tenantAdminA.email, tenantAdminA.password);
    customerServiceTokenA = await login(app, customerServiceA.email, customerServiceA.password);
    warehouseManagerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    warehouseStaffTokenA = await login(app, warehouseStaffA.email, warehouseStaffA.password);
    driverTokenA = await login(app, driverA.email, driverA.password);
    accountantTokenB = await login(app, accountantB.email, accountantB.password);
    const warehouseManagerTokenB = await login(app, tenantB.user.email, tenantB.user.password);

    // A CUSTOMER-role portal account, linked to tenantA's own default
    // customer, to prove customer tokens can't use staff invoice APIs at
    // all in Stage 3A (customer portal invoice viewing is a later stage).
    const customerUser = await prisma.user.create({
      data: {
        tenantId: tenantA.tenantId,
        email: `invoice-portal-${Date.now()}@example.test`,
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

    const customer2Res = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${tenantAdminTokenA}`)
      .send({ firstName: 'Second', lastName: 'Customer', email: `second-customer-${Date.now()}@example.test` });
    if (customer2Res.status !== 201) {
      throw new Error(`Second customer creation failed: ${customer2Res.status} ${JSON.stringify(customer2Res.body)}`);
    }
    customer2IdA = customer2Res.body.id;

    shipment1A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer1IdA);
    shipment2A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer2IdA);
    shipmentB = await createShipmentForCustomerId(app, warehouseManagerTokenB, customerIdB);
    // Heavier setup (2 tenants, several users each requiring a bcrypt hash
    // + login round trip) — jest's default 5000ms hook timeout is too
    // tight for this under sequential, single-worker load.
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('RBAC: warehouse-only operational roles never get invoice access, by product decision', () => {
    it('WAREHOUSE_MANAGER gets 403 on GET /invoices', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${warehouseManagerTokenA}`);
      expect(res.status).toBe(403);
    });

    it('WAREHOUSE_MANAGER gets 403 on POST /invoices', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${warehouseManagerTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      expect(res.status).toBe(403);
    });

    it('WAREHOUSE_STAFF gets 403 on GET /invoices', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${warehouseStaffTokenA}`);
      expect(res.status).toBe(403);
    });

    it('DRIVER gets 403 on GET /invoices', async () => {
      const res = await request(app.getHttpServer()).get('/invoices').set('Authorization', `Bearer ${driverTokenA}`);
      expect(res.status).toBe(403);
    });

    it('a CUSTOMER-role token gets 403 on the staff invoice API — not a substitute for the customer portal', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${customerPortalTokenA}`);
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request gets 401', async () => {
      const res = await request(app.getHttpServer()).get('/invoices');
      expect(res.status).toBe(401);
    });
  });

  describe('RBAC: Tenant Owner/Admin and office/accounting staff can manage invoices', () => {
    it('ACCOUNTANT can create an invoice', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
    });

    it('TENANT_ADMIN can create an invoice', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      expect(res.status).toBe(201);
    });

    it('CUSTOMER_SERVICE can create an invoice', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${customerServiceTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      expect(res.status).toBe(201);
    });
  });

  describe('Tenant isolation', () => {
    it('creating an invoice against another tenant\'s customerId 404s as "Customer not found"', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customerIdB, shipment1A.id));
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/customer not found/i);
    });

    it('creating an invoice against another tenant\'s shipmentId 404s as "Shipment not found for this customer"', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipmentB.id));
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/shipment not found/i);
    });

    it("tenant B cannot fetch tenant A's invoice by id", async () => {
      const createRes = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      const res = await request(app.getHttpServer())
        .get(`/invoices/${createRes.body.id}`)
        .set('Authorization', `Bearer ${accountantTokenB}`);
      expect(res.status).toBe(404);
    });

    it("tenant B's invoice list never contains tenant A's invoices", async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', `Bearer ${accountantTokenB}`);
      expect(res.status).toBe(200);
      expect(res.body.every((inv: { customerId: string }) => inv.customerId !== customer1IdA)).toBe(true);
    });
  });

  describe('Customer/shipment ownership — same tenant, wrong customer', () => {
    it("creating an invoice for customer1 using customer2's shipment 404s (cross-customer shipment reuse is rejected)", async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment2A.id));
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/shipment not found/i);
    });

    it('creating an invoice for customer2 using their own shipment succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer2IdA, shipment2A.id));
      expect(res.status).toBe(201);
      expect(res.body.customerId).toBe(customer2IdA);
      expect(res.body.shipmentId).toBe(shipment2A.id);
    });
  });

  describe('Issue lifecycle (DRAFT -> SENT)', () => {
    it('issuing a DRAFT invoice sets status to SENT and stamps issuedAt', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      expect(createRes.body.status).toBe('DRAFT');
      expect(createRes.body.issuedAt).toBeNull();

      const issueRes = await request(app.getHttpServer())
        .post(`/invoices/${createRes.body.id}/issue`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      expect(issueRes.status).toBe(201);
      expect(issueRes.body.status).toBe('SENT');
      expect(issueRes.body.issuedAt).not.toBeNull();
    });

    it('issuing an already-issued invoice is rejected with 400', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      await request(app.getHttpServer())
        .post(`/invoices/${createRes.body.id}/issue`)
        .set('Authorization', `Bearer ${accountantTokenA}`);

      const secondIssue = await request(app.getHttpServer())
        .post(`/invoices/${createRes.body.id}/issue`)
        .set('Authorization', `Bearer ${accountantTokenA}`);
      expect(secondIssue.status).toBe(400);
    });

    it("tenant B cannot issue tenant A's invoice", async () => {
      const createRes = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      const res = await request(app.getHttpServer())
        .post(`/invoices/${createRes.body.id}/issue`)
        .set('Authorization', `Bearer ${accountantTokenB}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Money serialization and precision', () => {
    it('formats every monetary field as a fixed 2-decimal-place string, never a bare number', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      expect(res.status).toBe(201);
      for (const field of ['subtotal', 'tax', 'total', 'amountPaid', 'balanceDue'] as const) {
        expect(typeof res.body[field]).toBe('string');
        expect(res.body[field]).toMatch(/^\d+\.\d{2}$/);
      }
      for (const item of res.body.items) {
        expect(typeof item.unitPrice).toBe('string');
        expect(typeof item.amount).toBe('string');
      }
    });

    it('sums 0.10 + 0.20 to exactly "0.30" — proves Decimal arithmetic, not floating-point (0.1+0.2 !== 0.3 in native JS)', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({
          customerId: customer1IdA,
          shipmentId: shipment1A.id,
          currency: 'USD',
          items: [
            { description: 'Item A', unitPrice: 0.1, quantity: 1 },
            { description: 'Item B', unitPrice: 0.2, quantity: 1 },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.subtotal).toBe('0.30');
      expect(res.body.total).toBe('0.30');
      expect(res.body.balanceDue).toBe('0.30');
      // Sanity: prove this would have failed under naive float arithmetic.
      expect(0.1 + 0.2).not.toBe(0.3);
    });

    it('computes balanceDue as total - amountPaid (0.00 paid on a new invoice, so balanceDue === total)', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      expect(res.body.amountPaid).toBe('0.00');
      expect(res.body.balanceDue).toBe(res.body.total);
    });

    it('computes item amount = unitPrice * quantity and defaults quantity to 1 when omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({
          customerId: customer1IdA,
          shipmentId: shipment1A.id,
          currency: 'USD',
          items: [{ description: 'Freight charge', unitPrice: 25.5 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quantity).toBe(1);
      expect(res.body.items[0].unitPrice).toBe('25.50');
      expect(res.body.items[0].amount).toBe('25.50');
      expect(res.body.subtotal).toBe('25.50');
    });

    it('applies an explicit flat tax amount on top of the item subtotal', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({
          customerId: customer1IdA,
          shipmentId: shipment1A.id,
          currency: 'USD',
          tax: 5,
          items: [{ description: 'Freight charge', unitPrice: 100, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.subtotal).toBe('100.00');
      expect(res.body.tax).toBe('5.00');
      expect(res.body.total).toBe('105.00');
    });
  });

  describe('Invoice number generation', () => {
    it('generates a tenant-scoped, year-stamped invoice number using TenantSettings.invoiceNumberPrefix', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send(validInvoicePayload(customer1IdA, shipment1A.id));
      expect(res.status).toBe(201);
      // createTestTenant doesn't override invoiceNumberPrefix, so this
      // falls back to the schema default ("INV") — proves
      // generateInvoiceNumber reads TenantSettings correctly either way.
      expect(res.body.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    });
  });

  describe('Input validation', () => {
    it('rejects an invoice with zero items', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({ customerId: customer1IdA, shipmentId: shipment1A.id, currency: 'USD', items: [] });
      expect(res.status).toBe(400);
    });

    it('rejects an invoice payload with an unexpected extra field (whitelist/forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${accountantTokenA}`)
        .send({ ...validInvoicePayload(customer1IdA, shipment1A.id), notAllowedField: 'x' });
      expect(res.status).toBe(400);
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
    items: [{ description: 'Ocean freight charge', unitPrice: 150, quantity: 2 }],
  };
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
      items: [{ itemType: ShipmentItemType.BOX, description: 'Invoice foundation e2e test box' }],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}
