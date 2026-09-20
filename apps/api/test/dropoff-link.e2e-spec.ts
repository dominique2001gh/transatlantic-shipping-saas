import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Quick Receive "Send Drop-Off Link" (staff convenience, 2026-09): proves
 * GET/POST /tenants/me/dropoff-link* are tenant-aware (each tenant's own
 * customDomain, when set, is reflected — never a hardcoded Trans Atlantic
 * URL), correctly RBAC-gated the same way Quick Receive itself is, and
 * that the customer-facing link always ends at /dropoff.
 */
describe('Send Drop-Off Link (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let managerTokenA: string;
  let managerTokenB: string;
  let ownerTokenA: string;
  let staffTokenA: string;
  let financeTokenA: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'DropoffLinkA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'DropoffLinkB', UserRole.MANAGER);

    managerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    managerTokenB = await login(app, tenantB.user.email, tenantB.user.password);

    const owner = await createUserInTenant(prisma, tenantA.tenantId, 'Owner', UserRole.OWNER);
    ownerTokenA = await login(app, owner.email, owner.password);
    const staff = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.STAFF);
    staffTokenA = await login(app, staff.email, staff.password);
    const finance = await createUserInTenant(prisma, tenantA.tenantId, 'Finance', UserRole.FINANCE);
    financeTokenA = await login(app, finance.email, finance.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  function getLink(token: string) {
    return request(app.getHttpServer()).get('/tenants/me/dropoff-link').set('Authorization', `Bearer ${token}`);
  }

  function sendEmail(token: string, email: string) {
    return request(app.getHttpServer())
      .post('/tenants/me/dropoff-link/email')
      .set('Authorization', `Bearer ${token}`)
      .send({ email });
  }

  describe('tenant-aware URL resolution', () => {
    it('always ends at /dropoff', async () => {
      const res = await getLink(managerTokenA);
      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(/\/dropoff$/);
    });

    it("two different tenants with their own customDomain each get their OWN domain reflected — never a shared/hardcoded URL", async () => {
      await prisma.tenant.update({ where: { id: tenantA.tenantId }, data: { customDomain: 'dropofflink-a.example.test' } });
      await prisma.tenant.update({ where: { id: tenantB.tenantId }, data: { customDomain: 'dropofflink-b.example.test' } });

      const resA = await getLink(managerTokenA);
      const resB = await getLink(managerTokenB);

      expect(resA.body.url).toBe('https://dropofflink-a.example.test/dropoff');
      expect(resB.body.url).toBe('https://dropofflink-b.example.test/dropoff');
      expect(resA.body.url).not.toBe(resB.body.url);

      // Reset for the tests below, which exercise the no-customDomain fallback path.
      await prisma.tenant.update({ where: { id: tenantA.tenantId }, data: { customDomain: null } });
      await prisma.tenant.update({ where: { id: tenantB.tenantId }, data: { customDomain: null } });
    });

    it('falls back to a real (non-empty) URL when no customDomain is configured — the common case for every tenant today', async () => {
      const res = await getLink(managerTokenA);
      expect(res.status).toBe(200);
      expect(typeof res.body.url).toBe('string');
      expect(res.body.url.length).toBeGreaterThan('/dropoff'.length);
    });
  });

  describe('RBAC — OPERATIONS_ROLES only, same gate as Quick Receive', () => {
    it('OWNER can fetch the link', async () => {
      expect((await getLink(ownerTokenA)).status).toBe(200);
    });

    it('MANAGER can fetch the link', async () => {
      expect((await getLink(managerTokenA)).status).toBe(200);
    });

    it('STAFF can fetch the link', async () => {
      expect((await getLink(staffTokenA)).status).toBe(200);
    });

    it('FINANCE is rejected with 403', async () => {
      expect((await getLink(financeTokenA)).status).toBe(403);
    });

    it('an unauthenticated request is rejected with 401', async () => {
      const res = await request(app.getHttpServer()).get('/tenants/me/dropoff-link');
      expect(res.status).toBe(401);
    });
  });

  describe('Send by Email', () => {
    it('sends successfully to a valid email (console provider in this environment)', async () => {
      const res = await sendEmail(managerTokenA, `dropoff-link-test-${Date.now()}@example.test`);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });
    });

    it('rejects an invalid email with 400', async () => {
      const res = await sendEmail(managerTokenA, 'not-an-email');
      expect(res.status).toBe(400);
    });

    it('FINANCE is rejected with 403', async () => {
      const res = await sendEmail(financeTokenA, 'someone@example.test');
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request is rejected with 401', async () => {
      const res = await request(app.getHttpServer()).post('/tenants/me/dropoff-link/email').send({ email: 'someone@example.test' });
      expect(res.status).toBe(401);
    });
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
