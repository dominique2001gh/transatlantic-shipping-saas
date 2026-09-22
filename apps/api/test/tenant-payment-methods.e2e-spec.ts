import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import {
  createCustomerWithPortalUser,
  createTestTenant,
  createUserInTenant,
  deleteTestTenant,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Tenant Payment Configuration Phase C/D/E: coverage for the manual
 * payment-method configuration surface — GET/PUT /tenant-payments/methods
 * (OWNER), GET /tenant-payments/methods/enabled (staff Record Payment
 * dropdown), GET /portal/payment-methods (customer). Deliberately does NOT
 * re-test the Stripe Connect surface (see tenant-payments-*.e2e-spec.ts)
 * or the core recordPayment/invoice-balance math (see
 * invoice-payment-security.e2e-spec.ts) — this suite targets what's new:
 * RBAC on the new routes, tenant isolation, Cash App/Zelle configuration,
 * enabled/disabled filtering, the two different fallback rules (staff vs.
 * portal), and that recordPayment accepts the two new PaymentMethod values
 * exactly like any existing one.
 */
describe('Tenant Payment Configuration: manual payment methods (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let ownerTokenA: string;
  let managerTokenA: string;
  let staffTokenA: string;
  let financeTokenA: string;
  let ownerTokenB: string;

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'PayMethA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'PayMethB', UserRole.MANAGER);
    managerTokenA = await login(app, tenantA.user.email, tenantA.user.password);

    const ownerA = await createUserInTenant(prisma, tenantA.tenantId, 'Owner', UserRole.OWNER);
    ownerTokenA = await login(app, ownerA.email, ownerA.password);
    const staffA = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.STAFF);
    staffTokenA = await login(app, staffA.email, staffA.password);
    const financeA = await createUserInTenant(prisma, tenantA.tenantId, 'Finance', UserRole.FINANCE);
    financeTokenA = await login(app, financeA.email, financeA.password);

    const ownerB = await createUserInTenant(prisma, tenantB.tenantId, 'Owner', UserRole.OWNER);
    ownerTokenB = await login(app, ownerB.email, ownerB.password);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  afterEach(async () => {
    await prisma.tenantPaymentMethodConfig.deleteMany({ where: { tenantId: { in: [tenantA.tenantId, tenantB.tenantId] } } });
  });

  // -- RBAC -------------------------------------------------------------

  describe('RBAC', () => {
    it('OWNER can GET the full config', async () => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/methods').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
    });

    it('OWNER can PUT the config', async () => {
      const res = await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'CASH_APP', enabled: true, instructions: '$Test' }] });
      expect(res.status).toBe(200);
    });

    it.each([
      ['MANAGER', () => managerTokenA],
      ['STAFF', () => staffTokenA],
      ['FINANCE', () => financeTokenA],
    ])('%s gets 403 on GET /tenant-payments/methods', async (_role, getToken) => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/methods').set('Authorization', `Bearer ${getToken()}`);
      expect(res.status).toBe(403);
    });

    it.each([
      ['MANAGER', () => managerTokenA],
      ['STAFF', () => staffTokenA],
      ['FINANCE', () => financeTokenA],
    ])('%s gets 403 on PUT /tenant-payments/methods', async (_role, getToken) => {
      const res = await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${getToken()}`)
        .send({ methods: [{ method: 'CASH_APP', enabled: true }] });
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request gets 401, not 403, on GET and PUT', async () => {
      const getRes = await request(app.getHttpServer()).get('/tenant-payments/methods');
      expect(getRes.status).toBe(401);
      const putRes = await request(app.getHttpServer()).put('/tenant-payments/methods').send({ methods: [] });
      expect(putRes.status).toBe(401);
    });

    it.each([
      ['OWNER', () => ownerTokenA],
      ['MANAGER', () => managerTokenA],
      ['FINANCE', () => financeTokenA],
    ])('%s (INVOICE_MANAGE_ROLES) can GET /tenant-payments/methods/enabled', async (_role, getToken) => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/methods/enabled').set('Authorization', `Bearer ${getToken()}`);
      expect(res.status).toBe(200);
    });

    it('STAFF gets 403 on GET /tenant-payments/methods/enabled (not in INVOICE_MANAGE_ROLES)', async () => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/methods/enabled').set('Authorization', `Bearer ${staffTokenA}`);
      expect(res.status).toBe(403);
    });

    it('rejects CARD as a settable method — @IsIn(MANUAL_PAYMENT_METHODS) excludes it', async () => {
      const res = await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'CARD', enabled: true }] });
      expect(res.status).toBe(400);
    });

    it('rejects a garbage method value', async () => {
      const res = await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'BITCOIN', enabled: true }] });
      expect(res.status).toBe(400);
    });
  });

  // -- Cash App / Zelle configuration ------------------------------------

  describe('Cash App and Zelle configuration', () => {
    it('enabling Cash App with a $Cashtag persists and round-trips through GET', async () => {
      const putRes = await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'CASH_APP', enabled: true, instructions: '$TransAtlanticLogistics' }] });
      expect(putRes.status).toBe(200);

      const getRes = await request(app.getHttpServer()).get('/tenant-payments/methods').set('Authorization', `Bearer ${ownerTokenA}`);
      const cashApp = getRes.body.find((m: { method: string }) => m.method === 'CASH_APP');
      expect(cashApp).toEqual({ method: 'CASH_APP', enabled: true, instructions: '$TransAtlanticLogistics' });
    });

    it('enabling Zelle with customer-facing instructions persists and round-trips through GET', async () => {
      const putRes = await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'ZELLE', enabled: true, instructions: 'payments@transatlanticlogistics.com' }] });
      expect(putRes.status).toBe(200);

      const getRes = await request(app.getHttpServer()).get('/tenant-payments/methods').set('Authorization', `Bearer ${ownerTokenA}`);
      const zelle = getRes.body.find((m: { method: string }) => m.method === 'ZELLE');
      expect(zelle).toEqual({ method: 'ZELLE', enabled: true, instructions: 'payments@transatlanticlogistics.com' });
    });

    it('a second PUT updates the same row rather than creating a duplicate', async () => {
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'CASH_APP', enabled: true, instructions: '$First' }] });
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'CASH_APP', enabled: true, instructions: '$Second' }] });

      const rows = await prisma.tenantPaymentMethodConfig.findMany({ where: { tenantId: tenantA.tenantId, method: 'CASH_APP' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].instructions).toBe('$Second');
    });
  });

  // -- Enabled/disabled + defaults -----------------------------------------

  describe('enabled/disabled methods and synthesized defaults', () => {
    it('GET config always includes all 7 configurable methods, even with zero rows', async () => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/methods').set('Authorization', `Bearer ${ownerTokenA}`);
      const methods = res.body.map((m: { method: string }) => m.method).sort();
      expect(methods).toEqual(['BANK_TRANSFER', 'CASH', 'CASH_APP', 'CHECK', 'MOBILE_MONEY', 'OTHER', 'ZELLE'].sort());
    });

    it('with zero rows, the 5 legacy methods default to enabled and CASH_APP/ZELLE default to disabled', async () => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/methods').set('Authorization', `Bearer ${ownerTokenA}`);
      const byMethod = Object.fromEntries(res.body.map((m: { method: string; enabled: boolean }) => [m.method, m.enabled]));
      expect(byMethod).toEqual({
        CASH: true,
        BANK_TRANSFER: true,
        MOBILE_MONEY: true,
        CHECK: true,
        OTHER: true,
        CASH_APP: false,
        ZELLE: false,
      });
    });

    it('disabling a previously-enabled method removes it from the enabled list', async () => {
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({
          methods: [
            { method: 'CASH', enabled: false },
            { method: 'CASH_APP', enabled: true, instructions: '$Enabled' },
          ],
        });

      const res = await request(app.getHttpServer()).get('/tenant-payments/methods/enabled').set('Authorization', `Bearer ${ownerTokenA}`);
      const methods = res.body.map((m: { method: string }) => m.method);
      expect(methods).not.toContain('CASH');
      expect(methods).toContain('CASH_APP');
    });
  });

  // -- Fallback behavior for existing/unconfigured tenants -----------------

  describe('fallback behavior for existing tenants (zero configuration)', () => {
    it('staff GET /tenant-payments/methods/enabled falls back to the exact legacy 5 methods, unchanged from pre-Phase-C behavior', async () => {
      const res = await request(app.getHttpServer()).get('/tenant-payments/methods/enabled').set('Authorization', `Bearer ${ownerTokenA}`);
      const methods = res.body.map((m: { method: string }) => m.method).sort();
      expect(methods).toEqual(['BANK_TRANSFER', 'CASH', 'CHECK', 'MOBILE_MONEY', 'OTHER'].sort());
      expect(res.body.every((m: { instructions: unknown }) => m.instructions === null)).toBe(true);
    });

    it('customer portal GET /portal/payment-methods returns an empty list for an unconfigured tenant — no legacy fallback', async () => {
      const portal = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'Fallback');
      const portalToken = await login(app, portal.user.email, portal.user.password);

      const res = await request(app.getHttpServer()).get('/portal/payment-methods').set('Authorization', `Bearer ${portalToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('once a tenant configures anything, the staff fallback list is replaced entirely by their explicit choices', async () => {
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'ZELLE', enabled: true, instructions: 'zelle@test.com' }] });

      const res = await request(app.getHttpServer()).get('/tenant-payments/methods/enabled').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.body.map((m: { method: string }) => m.method)).toEqual(['ZELLE']);
    });
  });

  // -- Customer portal visibility ------------------------------------------

  describe('customer portal visibility', () => {
    it('shows only enabled methods with their tenant-authored instructions', async () => {
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({
          methods: [
            { method: 'CASH_APP', enabled: true, instructions: '$TransAtlanticLogistics' },
            { method: 'ZELLE', enabled: false, instructions: 'zelle@test.com' },
            { method: 'CASH', enabled: true },
          ],
        });

      const portal = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'Visible');
      const portalToken = await login(app, portal.user.email, portal.user.password);

      const res = await request(app.getHttpServer()).get('/portal/payment-methods').set('Authorization', `Bearer ${portalToken}`);
      expect(res.status).toBe(200);
      const methods = res.body.map((m: { method: string }) => m.method).sort();
      expect(methods).toEqual(['CASH', 'CASH_APP'].sort()); // ZELLE excluded — disabled
      const cashApp = res.body.find((m: { method: string }) => m.method === 'CASH_APP');
      expect(cashApp.instructions).toBe('$TransAtlanticLogistics');
    });

    it('a non-customer (staff) token gets 403 on the portal route', async () => {
      const res = await request(app.getHttpServer()).get('/portal/payment-methods').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(403);
    });
  });

  // -- Tenant isolation ------------------------------------------------------

  describe('tenant isolation — no cross-tenant configuration leakage', () => {
    it("tenant B's OWNER never sees tenant A's configured methods, even after A configures Cash App", async () => {
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ methods: [{ method: 'CASH_APP', enabled: true, instructions: '$TenantASecret' }] });

      const res = await request(app.getHttpServer()).get('/tenant-payments/methods').set('Authorization', `Bearer ${ownerTokenB}`);
      const cashApp = res.body.find((m: { method: string }) => m.method === 'CASH_APP');
      expect(cashApp.enabled).toBe(false); // tenant B's own default, never tenant A's
      expect(cashApp.instructions).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('$TenantASecret');
    });

    it("tenant B's OWNER cannot alter tenant A's configuration — there is no request field that can target another tenant", async () => {
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .send({ methods: [{ method: 'CASH_APP', enabled: true, instructions: '$FromTenantB' }] });

      const configA = await prisma.tenantPaymentMethodConfig.findMany({ where: { tenantId: tenantA.tenantId, method: 'CASH_APP' } });
      expect(configA).toHaveLength(0); // tenant A untouched

      const configB = await prisma.tenantPaymentMethodConfig.findMany({ where: { tenantId: tenantB.tenantId, method: 'CASH_APP' } });
      expect(configB).toHaveLength(1);
      expect(configB[0].instructions).toBe('$FromTenantB');
    });

    it("one tenant's customer portal never sees another tenant's payment methods", async () => {
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .send({ methods: [{ method: 'ZELLE', enabled: true, instructions: 'tenantB-only@test.com' }] });

      const portalA = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'IsolationCheck');
      const portalTokenA = await login(app, portalA.user.email, portalA.user.password);

      const res = await request(app.getHttpServer()).get('/portal/payment-methods').set('Authorization', `Bearer ${portalTokenA}`);
      expect(res.body).toEqual([]); // tenant A has configured nothing; tenant B's ZELLE never leaks across
    });
  });

  // -- Manual payment recording with the new methods ------------------------

  describe('manual payment recording accepts CASH_APP and ZELLE like any existing method', () => {
    it('records a CASH_APP payment and updates the invoice balance/status correctly', async () => {
      const shipment = await createShipmentForCustomerId(app, managerTokenA, tenantA.customerId);
      const invoice = await createIssuedInvoice(app, financeTokenA, tenantA.customerId, shipment.id, 100);

      const paymentRes = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${financeTokenA}`)
        .send({ amount: 100, method: 'CASH_APP', referenceNumber: 'CASHAPP-TX-123' });
      expect(paymentRes.status).toBe(201);
      expect(paymentRes.body.method).toBe('CASH_APP');
      expect(paymentRes.body.source).toBe('MANUAL'); // never auto-marked from method selection alone

      const invoiceRes = await request(app.getHttpServer()).get(`/invoices/${invoice.id}`).set('Authorization', `Bearer ${financeTokenA}`);
      expect(invoiceRes.body.status).toBe('PAID');
      expect(invoiceRes.body.amountPaid).toBe('100.00');
      expect(invoiceRes.body.balanceDue).toBe('0.00');
    });

    it('records a partial ZELLE payment, leaving the invoice PARTIALLY_PAID with the correct balance', async () => {
      const shipment = await createShipmentForCustomerId(app, managerTokenA, tenantA.customerId);
      const invoice = await createIssuedInvoice(app, financeTokenA, tenantA.customerId, shipment.id, 200);

      const paymentRes = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${financeTokenA}`)
        .send({ amount: 75, method: 'ZELLE', notes: 'Confirmed via bank text alert' });
      expect(paymentRes.status).toBe(201);
      expect(paymentRes.body.method).toBe('ZELLE');

      const invoiceRes = await request(app.getHttpServer()).get(`/invoices/${invoice.id}`).set('Authorization', `Bearer ${financeTokenA}`);
      expect(invoiceRes.body.status).toBe('PARTIALLY_PAID');
      expect(invoiceRes.body.amountPaid).toBe('75.00');
      expect(invoiceRes.body.balanceDue).toBe('125.00');
    });

    it('CASH/BANK_TRANSFER/CHECK/OTHER still record exactly as before — untouched by this feature', async () => {
      const shipment = await createShipmentForCustomerId(app, managerTokenA, tenantA.customerId);
      for (const method of ['CASH', 'BANK_TRANSFER', 'CHECK', 'OTHER']) {
        const invoice = await createIssuedInvoice(app, financeTokenA, tenantA.customerId, shipment.id, 50);
        const paymentRes = await request(app.getHttpServer())
          .post(`/invoices/${invoice.id}/payments`)
          .set('Authorization', `Bearer ${financeTokenA}`)
          .send({ amount: 50, method });
        expect(paymentRes.status).toBe(201);
        expect(paymentRes.body.method).toBe(method);
        expect(paymentRes.body.status).toBe('COMPLETED');
      }
    });
  });

  // -- Existing Stripe payment behavior is unaffected -----------------------

  describe('existing Stripe checkout/payment path is unaffected by manual-method configuration', () => {
    it('creating an online checkout session still succeeds normally regardless of manual-method configuration', async () => {
      await request(app.getHttpServer())
        .put('/tenant-payments/methods')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({
          methods: [
            { method: 'CASH_APP', enabled: true, instructions: '$Test' },
            { method: 'ZELLE', enabled: true, instructions: 'z@test.com' },
          ],
        });

      const shipment = await createShipmentForCustomerId(app, managerTokenA, tenantA.customerId);
      const invoice = await createIssuedInvoice(app, financeTokenA, tenantA.customerId, shipment.id, 60);

      const portal = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'StripeUnaffected');
      // Re-point the invoice at this portal customer so the checkout route's ownership check passes.
      await prisma.invoice.update({ where: { id: invoice.id }, data: { customerId: portal.customerId } });
      const portalToken = await login(app, portal.user.email, portal.user.password);

      const res = await request(app.getHttpServer())
        .post(`/portal/invoices/${invoice.id}/checkout-session`)
        .set('Authorization', `Bearer ${portalToken}`);
      expect(res.status).toBe(201);
      expect(res.body.url).toEqual(expect.stringContaining('checkout.stripe.com'));
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

async function createShipmentForCustomerId(app: INestApplication, staffToken: string, customerId: string): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      recipientName: 'Test Recipient',
      recipientPhone: '+15550000000',
      items: [{ itemType: ShipmentItemType.BOX, description: 'Payment methods e2e test box' }],
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
  const issueRes = await request(app.getHttpServer()).post(`/invoices/${createRes.body.id}/issue`).set('Authorization', `Bearer ${staffToken}`);
  if (issueRes.status !== 201) {
    throw new Error(`Invoice issue failed: ${issueRes.status} ${JSON.stringify(issueRes.body)}`);
  }
  return issueRes.body as { id: string; total: string };
}
