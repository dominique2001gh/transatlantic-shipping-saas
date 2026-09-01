import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import {
  createCustomerWithPortalUser,
  createTestTenant,
  createUserInTenant,
  deleteTestTenant,
  TestPortalCustomerFixture,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Stage 3E: proves the Customer Portal's invoice-viewing surface — built
 * on the exact same requireTenantId/requireCustomerId ownership pattern
 * Stage 2C already established for shipments — correctly hides DRAFT
 * invoices, isolates customers from each other and from other tenants
 * (including by guessed/manipulated ids), and surfaces payment history
 * with accurate balance derivation. Reuses createCustomerWithPortalUser
 * from Stage 2C's own fixtures rather than duplicating that setup.
 */
describe('Customer Portal invoices: draft-visibility, isolation, payments (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tenantAdminTokenA: string;
  let tenantAdminTokenB: string;

  let customer1A: TestPortalCustomerFixture;
  let customer2A: TestPortalCustomerFixture;
  let customerB: TestPortalCustomerFixture;
  let customer1APortalToken: string;
  let customer2APortalToken: string;
  let customerBPortalToken: string;

  let shipment1A: { id: string };
  let shipment2A: { id: string };
  let shipmentB: { id: string };

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'PInvA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'PInvB', UserRole.WAREHOUSE_MANAGER);

    const tenantAdminA = await createUserInTenant(prisma, tenantA.tenantId, 'TenantAdmin', UserRole.TENANT_ADMIN);
    const tenantAdminB = await createUserInTenant(prisma, tenantB.tenantId, 'TenantAdmin', UserRole.TENANT_ADMIN);
    tenantAdminTokenA = await login(app, tenantAdminA.email, tenantAdminA.password);
    tenantAdminTokenB = await login(app, tenantAdminB.email, tenantAdminB.password);

    customer1A = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'C1');
    customer2A = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'C2');
    customerB = await createCustomerWithPortalUser(prisma, tenantB.tenantId, 'CB');
    customer1APortalToken = await login(app, customer1A.user.email, customer1A.user.password);
    customer2APortalToken = await login(app, customer2A.user.email, customer2A.user.password);
    customerBPortalToken = await login(app, customerB.user.email, customerB.user.password);

    shipment1A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer1A.customerId);
    shipment2A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer2A.customerId);
    shipmentB = await createShipmentForCustomerId(app, tenantAdminTokenB, customerB.customerId);
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

  describe('RBAC', () => {
    it('a staff token gets 403 on GET /portal/invoices — not a substitute for the staff invoice API', async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/invoices')
        .set('Authorization', `Bearer ${tenantAdminTokenA}`);
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request gets 401', async () => {
      const res = await request(app.getHttpServer()).get('/portal/invoices');
      expect(res.status).toBe(401);
    });
  });

  describe('Draft invoices are never visible to the customer', () => {
    it('a DRAFT invoice does not appear in the customer\'s list', async () => {
      const draft = await createInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get('/portal/invoices')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((inv: { id: string }) => inv.id === draft.id)).toBe(false);
    });

    it('a DRAFT invoice 404s on direct detail access, even by its own owning customer', async () => {
      const draft = await createInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${draft.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(res.status).toBe(404);
    });

    it('an issued invoice appears in the list and is fully accessible', async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);

      const listRes = await request(app.getHttpServer())
        .get('/portal/invoices')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.some((inv: { id: string }) => inv.id === invoice.id)).toBe(true);

      const detailRes = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.status).toBe('SENT');
      expect(Array.isArray(detailRes.body.items)).toBe(true);
      expect(detailRes.body.items.length).toBeGreaterThan(0);
      expect(Array.isArray(detailRes.body.payments)).toBe(true);
    });
  });

  describe('Cross-customer isolation (same tenant)', () => {
    it("customer2 does not see customer1's issued invoice in their own list", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get('/portal/invoices')
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(res.body.some((inv: { id: string }) => inv.id === invoice.id)).toBe(false);
    });

    it("customer2 gets 404 fetching customer1's real invoice id directly", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(res.status).toBe(404);
    });

    it('the 404 for a real cross-customer id is byte-identical to a genuinely nonexistent id — existence is never confirmable', async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const crossCustomer = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      const nonexistent = await request(app.getHttpServer())
        .get('/portal/invoices/does-not-exist-at-all')
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(crossCustomer.status).toBe(404);
      expect(nonexistent.status).toBe(404);
      expect(crossCustomer.body.message).toBe(nonexistent.body.message);
    });
  });

  describe('Cross-tenant isolation', () => {
    it("a tenant B customer does not see tenant A's invoice in their list", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get('/portal/invoices')
        .set('Authorization', `Bearer ${customerBPortalToken}`);
      expect(res.body.some((inv: { id: string }) => inv.id === invoice.id)).toBe(false);
    });

    it("a tenant B customer gets 404 fetching tenant A's invoice id directly", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${customerBPortalToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Payments visibility and balance derivation', () => {
    it("shows recorded payments and correct amountPaid/balanceDue/status on the customer's own invoice", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 200);
      await recordPayment(app, tenantAdminTokenA, invoice.id, 80);

      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(res.status).toBe(200);
      expect(res.body.amountPaid).toBe('80.00');
      expect(res.body.balanceDue).toBe('120.00');
      expect(res.body.status).toBe('PARTIALLY_PAID');
      expect(res.body.payments).toHaveLength(1);
      expect(res.body.payments[0].amount).toBe('80.00');
      expect(res.body.payments[0].method).toBe('CASH');
    });

    it("one customer's payment never bleeds into another customer's invoice", async () => {
      const invoice1 = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      await recordPayment(app, tenantAdminTokenA, invoice1.id, 100);
      const invoice2 = await createIssuedInvoice(app, tenantAdminTokenA, customer2A.customerId, shipment2A.id, 50);

      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice2.id}`)
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(res.body.amountPaid).toBe('0.00');
      expect(res.body.payments).toEqual([]);
    });
  });

  describe('Money serialization', () => {
    it('formats every monetary field as a fixed 2-decimal-place string', async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 99);
      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      for (const field of ['subtotal', 'tax', 'total', 'amountPaid', 'balanceDue'] as const) {
        expect(res.body[field]).toMatch(/^\d+\.\d{2}$/);
      }
    });
  });

  describe('No cross-customer/cross-tenant data leakage in the response body', () => {
    it("never contains another customer's or another tenant's id", async () => {
      const invoice = await createIssuedInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 100);
      const res = await request(app.getHttpServer())
        .get(`/portal/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(customer2A.customerId);
      expect(raw).not.toContain(customerB.customerId);
      expect(raw).not.toContain(tenantB.tenantId);
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
      items: [{ itemType: ShipmentItemType.BOX, description: 'Portal invoice e2e test box' }],
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

async function recordPayment(
  app: INestApplication,
  staffToken: string,
  invoiceId: string,
  amount: number,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/invoices/${invoiceId}/payments`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ amount, method: 'CASH' });
  if (res.status !== 201) {
    throw new Error(`Payment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}
