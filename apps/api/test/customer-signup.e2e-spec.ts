import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Customer Self-Service Pre-Registration, Stage 2: POST /auth/customer-signup.
 *
 * This endpoint is hardcoded to the real "transatlantic" tenant (see
 * AuthService.customerSignup's own doc comment) — there is no way to
 * request signup into an arbitrary/test tenant, which is exactly the
 * safety property this suite exists to prove. Since e2e fixtures never
 * touch the real seeded "transatlantic" tenant (see fixtures.ts's own
 * doc comment), this suite drives the endpoint against whatever tenant
 * actually has that slug in the target database — local dev's seeded
 * tenant — and cleans up every User/Customer row it creates itself
 * afterward rather than deleting the tenant.
 */
describe('Customer signup (Stage 2, e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let transAtlanticTenantId: string;

  const createdUserIds: string[] = [];
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const tenant = await prisma.tenant.findFirst({ where: { slug: 'transatlantic' } });
    if (!tenant) {
      throw new Error('This suite requires the real "transatlantic" tenant to exist in the target database.');
    }
    transAtlanticTenantId = tenant.id;
  });

  afterEach(async () => {
    // Clean up only what this suite itself created — never touches any
    // pre-existing transatlantic user/customer.
    if (createdCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      createdCustomerIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function uniqueEmail(): string {
    return `e2e-signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  }

  async function trackCreated(email: string) {
    const user = await prisma.user.findFirst({ where: { tenantId: transAtlanticTenantId, email } });
    if (user) createdUserIds.push(user.id);
    const customer = await prisma.customer.findFirst({ where: { tenantId: transAtlanticTenantId, email } });
    if (customer) createdCustomerIds.push(customer.id);
  }

  it('creates a CUSTOMER-role account tenant-scoped to Trans Atlantic, with a linked Customer record and a usable JWT', async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      phone: '+233-20-555-0100',
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(res.body.user.tenantId).toBe(transAtlanticTenantId);
    expect(res.body.user.customerId).toBeTruthy();

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(dbUser.role).toBe(UserRole.CUSTOMER);
    expect(dbUser.tenantId).toBe(transAtlanticTenantId);
    expect(dbUser.passwordHash).not.toBe('CorrectHorse123'); // actually hashed, not stored plaintext

    const dbCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: res.body.user.customerId } });
    expect(dbCustomer.tenantId).toBe(transAtlanticTenantId);
    expect(dbCustomer.userId).toBe(res.body.user.id);
    expect(dbCustomer.firstName).toBe('Ama');

    await trackCreated(email);
  });

  it('rejects mismatched password/confirmPassword before creating anything', async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Kofi',
      lastName: 'Owusu',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'DifferentPassword',
    });
    expect(res.status).toBe(400);

    const dbUser = await prisma.user.findFirst({ where: { tenantId: transAtlanticTenantId, email } });
    expect(dbUser).toBeNull();
  });

  it('rejects a second signup with the same email — duplicate account handling', async () => {
    const email = uniqueEmail();
    const first = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(first.status).toBe(201);
    await trackCreated(email);

    const second = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'AnotherPassword123',
      confirmPassword: 'AnotherPassword123',
    });
    expect(second.status).toBe(409);

    const users = await prisma.user.findMany({ where: { tenantId: transAtlanticTenantId, email } });
    expect(users).toHaveLength(1); // no duplicate row
  });

  it('is case-insensitive on email for duplicate detection', async () => {
    const email = uniqueEmail();
    const first = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(first.status).toBe(201);
    await trackCreated(email);

    const second = await request(app.getHttpServer())
      .post('/auth/customer-signup')
      .send({
        firstName: 'Ama',
        lastName: 'Boateng',
        email: email.toUpperCase(),
        password: 'AnotherPassword123',
        confirmPassword: 'AnotherPassword123',
      });
    expect(second.status).toBe(409);
  });

  it('links to an existing staff-created Customer record with no prior login, instead of creating a duplicate', async () => {
    const email = uniqueEmail();
    const preExisting = await prisma.customer.create({
      data: {
        tenantId: transAtlanticTenantId,
        customerNumber: `E2E-SIGNUP-${Date.now()}`,
        firstName: 'Existing',
        lastName: 'Shopper',
        email,
      },
    });
    createdCustomerIds.push(preExisting.id);

    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Existing',
      lastName: 'Shopper',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.customerId).toBe(preExisting.id); // linked, not duplicated

    const allCustomersWithEmail = await prisma.customer.findMany({ where: { tenantId: transAtlanticTenantId, email } });
    expect(allCustomersWithEmail).toHaveLength(1);

    await trackCreated(email);
  });

  it('rejects a whitelist-violating body attempting to set role/tenantId directly (cannot create privileged users or pick a tenant)', async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer())
      .post('/auth/customer-signup')
      .send({
        firstName: 'Attacker',
        lastName: 'Test',
        email,
        password: 'CorrectHorse123',
        confirmPassword: 'CorrectHorse123',
        role: 'OWNER',
        tenantId: 'some-other-tenant-id',
      });
    expect(res.status).toBe(400); // forbidNonWhitelisted rejects the extra fields outright

    const dbUser = await prisma.user.findFirst({ where: { tenantId: transAtlanticTenantId, email } });
    expect(dbUser).toBeNull();
  });

  it('the new account can immediately log in via the normal /auth/login endpoint — no separate auth system', async () => {
    const email = uniqueEmail();
    const signupRes = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(signupRes.status).toBe(201);
    await trackCreated(email);

    const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'CorrectHorse123' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.role).toBe('CUSTOMER');
    expect(loginRes.body.user.tenantId).toBe(transAtlanticTenantId);
  });

  it("the resulting token can access the customer portal (/portal/me) but not any staff route", async () => {
    const email = uniqueEmail();
    const signupRes = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    await trackCreated(email);
    const token = signupRes.body.accessToken;

    const meRes = await request(app.getHttpServer()).get('/portal/me').set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.firstName).toBe('Ama');

    const staffRes = await request(app.getHttpServer()).get('/customers').set('Authorization', `Bearer ${token}`);
    expect(staffRes.status).toBe(403);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'short1',
      confirmPassword: 'short1',
    });
    expect(res.status).toBe(400);
  });
});

/**
 * Separate isolated-tenant fixture describe block: proves tenant scoping
 * holds even when an *isolated* e2e test tenant (not the real
 * transatlantic one) exists in the same database at the same time — a
 * signup must never accidentally land in it.
 */
describe('Customer signup does not leak into unrelated tenants (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let otherTenant: TestTenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    otherTenant = await createTestTenant(prisma, 'SignupIsolation', UserRole.MANAGER);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, otherTenant.tenantId);
    await prisma.$disconnect();
  });

  it('never creates the new account under an unrelated tenant, even one that exists in the same database', async () => {
    const email = `e2e-isolation-${Date.now()}@example.test`;
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.tenantId).not.toBe(otherTenant.tenantId);

    const leaked = await prisma.user.findFirst({ where: { tenantId: otherTenant.tenantId, email } });
    expect(leaked).toBeNull();

    // Clean up — this account did land in the real transatlantic tenant.
    await prisma.customer.deleteMany({ where: { email, tenantId: res.body.user.tenantId } });
    await prisma.user.deleteMany({ where: { email, tenantId: res.body.user.tenantId } });
  });
});

/**
 * SMS/Twilio A2P Phase 1: proves the registration checkbox is the only
 * thing that can ever set Customer.smsConsentGiven, and that it's recorded
 * distinctly from Customer.notifyBySms — see AuthService.customerSignup's
 * own doc comment for why the two must never be conflated.
 */
describe('Customer signup: SMS consent (Phase 1, e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let transAtlanticTenantId: string;

  const createdUserIds: string[] = [];
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const tenant = await prisma.tenant.findFirst({ where: { slug: 'transatlantic' } });
    if (!tenant) {
      throw new Error('This suite requires the real "transatlantic" tenant to exist in the target database.');
    }
    transAtlanticTenantId = tenant.id;
  });

  afterEach(async () => {
    if (createdCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      createdCustomerIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function uniqueEmail(): string {
    return `e2e-sms-consent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  }

  it('omitting smsConsent leaves consent and notifyBySms both false, and registration still succeeds (SMS declined)', async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(res.status).toBe(201); // registration succeeds even though SMS was declined

    const dbCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: res.body.user.customerId } });
    expect(dbCustomer.notifyBySms).toBe(false);
    expect(dbCustomer.smsConsentGiven).toBe(false);
    expect(dbCustomer.smsConsentAt).toBeNull();
    expect(dbCustomer.smsConsentSource).toBeNull();

    createdUserIds.push(res.body.user.id);
    createdCustomerIds.push(res.body.user.customerId);
  });

  it('explicitly unchecked (smsConsent: false) behaves identically to omitted', async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
      smsConsent: false,
    });
    expect(res.status).toBe(201);

    const dbCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: res.body.user.customerId } });
    expect(dbCustomer.notifyBySms).toBe(false);
    expect(dbCustomer.smsConsentGiven).toBe(false);

    createdUserIds.push(res.body.user.id);
    createdCustomerIds.push(res.body.user.customerId);
  });

  it('smsConsent: true records affirmative consent with a timestamp, source, and version, and enables notifyBySms', async () => {
    const email = uniqueEmail();
    const before = new Date();
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Kwame',
      lastName: 'Mensah',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
      smsConsent: true,
    });
    expect(res.status).toBe(201);

    const dbCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: res.body.user.customerId } });
    expect(dbCustomer.notifyBySms).toBe(true);
    expect(dbCustomer.smsConsentGiven).toBe(true);
    expect(dbCustomer.smsConsentAt).not.toBeNull();
    expect(dbCustomer.smsConsentAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(dbCustomer.smsConsentSource).toBe('register_web_form');
    expect(dbCustomer.smsConsentVersion).toBe('v1');

    createdUserIds.push(res.body.user.id);
    createdCustomerIds.push(res.body.user.customerId);
  });

  it('a pre-existing Customer row with notifyBySms already true is NOT treated as having given consent', async () => {
    const email = uniqueEmail();
    // Simulates a staff-created (or pre-Phase-1) Customer row that already
    // has notifyBySms:true from before consent infrastructure existed —
    // exactly the scenario Phase 1 must never silently "grandfather in".
    const preExisting = await prisma.customer.create({
      data: {
        tenantId: transAtlanticTenantId,
        customerNumber: `E2E-CONSENT-${Date.now()}`,
        firstName: 'Existing',
        lastName: 'Shopper',
        email,
        notifyBySms: true,
      },
    });
    createdCustomerIds.push(preExisting.id);
    expect(preExisting.smsConsentGiven).toBe(false); // schema default, confirms the premise

    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Existing',
      lastName: 'Shopper',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
      // smsConsent omitted — this signup does not itself grant consent
    });
    expect(res.status).toBe(201);
    expect(res.body.user.customerId).toBe(preExisting.id); // linked, not duplicated

    const dbCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: preExisting.id } });
    expect(dbCustomer.notifyBySms).toBe(true); // untouched, pre-existing value preserved
    expect(dbCustomer.smsConsentGiven).toBe(false); // still never inferred from notifyBySms

    createdUserIds.push(res.body.user.id);
  });
});
