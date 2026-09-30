import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createCustomerWithPortalUser, createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Multi-tenant customer login fix (2026-09): GET /auth/customer-entry-point
 * — what /ananselogix/login calls to decide what happens to a CUSTOMER-role
 * login on ananselogix.com (the only login form any customer can reach on
 * that hostname — middleware.ts rewrites /login there for every role).
 * Proves the dead-end this fix closes: Gold Coast, Titanic, and every
 * other tenant sharing this platform's own domain (no customDomain, not
 * the legacy-grandfathered slug) now resolve `available: true, url: null`
 * — "sign in here, /portal already knows your tenant from the JWT" —
 * instead of the old hardcoded `available: false` dead end.
 *
 * Does NOT exercise the legacy-tenant branch (Trans Atlantic's own
 * `url: '/login'`) end-to-end here — same reason dropoff-link.e2e-spec.ts
 * doesn't either: LEGACY_CUSTOM_DOMAIN_TENANT_SLUG isn't set in this
 * local/test .env, so even the real seeded "transatlantic" tenant falls
 * into the shared-domain branch in this environment (config-driven, not
 * an implicit slug check — see tenant-web-app-url.e2e-spec.ts's own test
 * #3 for the identical, already-covered behavior of the underlying
 * isSharedAnanseLogixDomain predicate this method calls unchanged). That
 * suite's fake-config tests already exhaustively cover the legacy branch;
 * this method's own 3-line dispatch onto it is unchanged code from before
 * this fix, not re-tested here.
 */
describe('Customer entry point: multi-tenant login resolution (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let goldCoast: TestTenantFixture;
  let titanic: TestTenantFixture;
  let customDomainTenant: TestTenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    goldCoast = await createTestTenant(prisma, 'EntryGoldCoast', UserRole.MANAGER);
    titanic = await createTestTenant(prisma, 'EntryTitanic', UserRole.MANAGER);
    customDomainTenant = await createTestTenant(prisma, 'EntryCustomDomain', UserRole.MANAGER);
    await prisma.tenant.update({ where: { id: customDomainTenant.tenantId }, data: { customDomain: 'app.entry-fixture.example.test' } });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, goldCoast.tenantId);
    await deleteTestTenant(prisma, titanic.tenantId);
    await deleteTestTenant(prisma, customDomainTenant.tenantId);
    await prisma.$disconnect();
  });

  async function loginAsPortalCustomer(tenantId: string, label: string): Promise<string> {
    const customer = await createCustomerWithPortalUser(prisma, tenantId, label);
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: customer.user.email, password: customer.user.password });
    if (res.status !== 200) {
      throw new Error(`Login failed for ${customer.user.email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.accessToken as string;
  }

  function getEntryPoint(token: string) {
    return request(app.getHttpServer()).get('/auth/customer-entry-point').set('Authorization', `Bearer ${token}`);
  }

  it("Gold Coast's customer resolves available:true, url:null — shares the platform, sign in here, no dead end", async () => {
    const token = await loginAsPortalCustomer(goldCoast.tenantId, 'GC');
    const res = await getEntryPoint(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, url: null });
  });

  it("Titanic's customer independently resolves available:true, url:null too — same rule, not copied/hardcoded per tenant", async () => {
    const token = await loginAsPortalCustomer(titanic.tenantId, 'Titanic');
    const res = await getEntryPoint(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, url: null });
  });

  it('a tenant with its own customDomain resolves an absolute URL to that domain\'s own /login — the future per-tenant-domain extension point', async () => {
    const token = await loginAsPortalCustomer(customDomainTenant.tenantId, 'CustomDomain');
    const res = await getEntryPoint(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, url: 'https://app.entry-fixture.example.test/login' });
  });

  it('an unauthenticated request is rejected with 401', async () => {
    const res = await request(app.getHttpServer()).get('/auth/customer-entry-point');
    expect(res.status).toBe(401);
  });
});
