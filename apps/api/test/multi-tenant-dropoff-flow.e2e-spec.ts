import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Multi-tenant Drop-Off (2026-09): the full, continuous, real-HTTP journey
 * a customer takes from a tenant-scoped /dropoff/{tenantSlug} link through
 * to a staff member converting their prepared drop-off in Quick Receive —
 * unlike the individual-layer suites (dropoff-link.e2e-spec.ts,
 * customer-signup.e2e-spec.ts, pre-registrations.e2e-spec.ts,
 * quick-receive.e2e-spec.ts's own "pre-registration conversion" block,
 * each of which bypasses one or more of the earlier steps to isolate its
 * own layer), every step here goes through the real HTTP endpoint the
 * frontend actually calls, for TWO independently-provisioned tenants at
 * once, proving tenant identity survives the entire chain without ever
 * crossing between them:
 *
 *   GET /tenants/me/dropoff-link (staff)
 *     -> POST /auth/customer-signup { tenantSlug }
 *     -> POST /portal/pre-registrations (DRAFT)
 *     -> POST /portal/pre-registrations/:id/submit (-> PRE-####)
 *     -> GET /pre-registrations/scan?code=... (staff "Load Drop-Off")
 *     -> POST /shipments/quick-receive { preRegistrationId } (staff)
 */
describe('Multi-tenant Drop-Off: full /dropoff -> signup -> pre-registration -> Quick Receive chain (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let goldCoast: TestTenantFixture;
  let titanic: TestTenantFixture;
  let goldCoastStaffToken: string;
  let titanicStaffToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    goldCoast = await createTestTenant(prisma, 'FlowGoldCoast', UserRole.MANAGER);
    titanic = await createTestTenant(prisma, 'FlowTitanic', UserRole.MANAGER);
    goldCoastStaffToken = await login(app, goldCoast.user.email, goldCoast.user.password);
    titanicStaffToken = await login(app, titanic.user.email, titanic.user.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, goldCoast.tenantId);
    await deleteTestTenant(prisma, titanic.tenantId);
    await prisma.$disconnect();
  });

  /** Drives the entire customer-facing half of the chain for one tenant, starting from its own dropoff-link slug, ending with a submitted PRE reference. */
  async function runCustomerDropoffFlow(tenant: TestTenantFixture, staffToken: string, label: string) {
    // Step 1: staff's "Send Drop-Off Link" — the URL a real customer would open.
    const linkRes = await request(app.getHttpServer())
      .get('/tenants/me/dropoff-link')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(linkRes.status).toBe(200);
    expect(linkRes.body.url).toContain(`/dropoff/${tenant.slug}`);

    // Step 2: Create Account, carrying the slug this test extracted from that same link
    // — exactly what apps/web/src/app/(public)/dropoff/[tenantSlug]/page.tsx threads
    // through to /register, and /register threads to this endpoint as tenantSlug.
    const email = `e2e-flow-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const signupRes = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Flow',
      lastName: label,
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
      tenantSlug: tenant.slug,
    });
    expect(signupRes.status).toBe(201);
    expect(signupRes.body.user.tenantId).toBe(tenant.tenantId);
    const customerToken = signupRes.body.accessToken as string;

    // Step 3: the customer prepares their drop-off (/portal/pre-register).
    const draftRes = await request(app.getHttpServer())
      .post('/portal/pre-registrations')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ destinationCountry: 'GH', recipientName: `${label} Recipient`, recipientPhone: '+233209999999', packageCount: 1 });
    expect(draftRes.status).toBe(201);

    const submitRes = await request(app.getHttpServer())
      .post(`/portal/pre-registrations/${draftRes.body.id}/submit`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send();
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.referenceNumber).toMatch(/^PRE-/);

    return {
      preRegistrationId: submitRes.body.id as string,
      referenceNumber: submitRes.body.referenceNumber as string,
      customerId: signupRes.body.user.customerId as string,
    };
  }

  it('Gold Coast\'s full chain: dropoff link -> signup -> pre-registration stays under Gold Coast throughout', async () => {
    const flow = await runCustomerDropoffFlow(goldCoast, goldCoastStaffToken, 'GoldCoast');

    const dbPreReg = await prisma.shipmentPreRegistration.findUniqueOrThrow({ where: { id: flow.preRegistrationId } });
    expect(dbPreReg.tenantId).toBe(goldCoast.tenantId);
    const dbCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: flow.customerId } });
    expect(dbCustomer.tenantId).toBe(goldCoast.tenantId);
  });

  it('Titanic\'s full chain runs independently and lands under Titanic — never Gold Coast', async () => {
    const flow = await runCustomerDropoffFlow(titanic, titanicStaffToken, 'Titanic');

    const dbPreReg = await prisma.shipmentPreRegistration.findUniqueOrThrow({ where: { id: flow.preRegistrationId } });
    expect(dbPreReg.tenantId).toBe(titanic.tenantId);
    expect(dbPreReg.tenantId).not.toBe(goldCoast.tenantId);
  });

  it('Gold Coast staff can "Load Drop-Off" (scan) and convert their own customer\'s PRE reference via Quick Receive', async () => {
    const flow = await runCustomerDropoffFlow(goldCoast, goldCoastStaffToken, 'GoldCoastConvert');

    const scanRes = await request(app.getHttpServer())
      .get(`/pre-registrations/scan?code=${encodeURIComponent(flow.referenceNumber)}`)
      .set('Authorization', `Bearer ${goldCoastStaffToken}`);
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.id).toBe(flow.preRegistrationId);

    const quickReceiveRes = await request(app.getHttpServer())
      .post('/shipments/quick-receive')
      .set('Authorization', `Bearer ${goldCoastStaffToken}`)
      .send({
        customerId: flow.customerId,
        shipmentMode: 'OCEAN_LCL',
        destinationCountry: 'GH',
        originWarehouseId: goldCoast.warehouseId,
        recipientName: 'Flow Recipient',
        recipientPhone: '+233209999999',
        packageCount: 1,
        preRegistrationId: flow.preRegistrationId,
      });
    expect(quickReceiveRes.status).toBe(201);

    const dbShipment = await prisma.shipment.findUniqueOrThrow({ where: { id: quickReceiveRes.body.id } });
    expect(dbShipment.tenantId).toBe(goldCoast.tenantId);

    const updatedPreReg = await prisma.shipmentPreRegistration.findUniqueOrThrow({ where: { id: flow.preRegistrationId } });
    expect(updatedPreReg.status).toBe('CONVERTED');
    expect(updatedPreReg.convertedShipmentId).toBe(quickReceiveRes.body.id);
  });

  it('cross-tenant negative: Titanic staff cannot scan or convert Gold Coast\'s PRE reference, even knowing the exact code', async () => {
    const flow = await runCustomerDropoffFlow(goldCoast, goldCoastStaffToken, 'GoldCoastCrossCheck');

    const scanRes = await request(app.getHttpServer())
      .get(`/pre-registrations/scan?code=${encodeURIComponent(flow.referenceNumber)}`)
      .set('Authorization', `Bearer ${titanicStaffToken}`);
    expect(scanRes.status).toBe(404);

    const quickReceiveRes = await request(app.getHttpServer())
      .post('/shipments/quick-receive')
      .set('Authorization', `Bearer ${titanicStaffToken}`)
      .send({
        customerId: titanic.customerId, // Titanic staff would never actually have Gold Coast's customerId to pass — using their own tenant's as the realistic attempt
        shipmentMode: 'OCEAN_LCL',
        destinationCountry: 'GH',
        originWarehouseId: titanic.warehouseId,
        recipientName: 'Cross Tenant Attempt',
        recipientPhone: '+233209999999',
        packageCount: 1,
        preRegistrationId: flow.preRegistrationId, // Gold Coast's
      });
    expect(quickReceiveRes.status).toBe(404);

    const untouched = await prisma.shipmentPreRegistration.findUniqueOrThrow({ where: { id: flow.preRegistrationId } });
    expect(untouched.status).toBe('SUBMITTED'); // never converted by the wrong tenant's attempt
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
