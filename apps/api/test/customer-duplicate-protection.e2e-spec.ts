import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Quick Receive Phase 2: CustomersService.create's duplicate-email/phone
 * check (see customers.service.ts's own doc comment). Lives in
 * CustomersService, not Quick Receive itself, so this is tested as its own
 * suite rather than folded into quick-receive.e2e-spec.ts — it protects
 * every customer-creation path, not just the inline one Quick Receive uses.
 */
describe('Customer duplicate protection (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenant: TestTenantFixture;
  let otherTenant: TestTenantFixture;
  let managerToken: string;
  let otherTenantToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'DupeCheck', UserRole.MANAGER);
    otherTenant = await createTestTenant(prisma, 'DupeCheckOther', UserRole.MANAGER);
    managerToken = await login(app, tenant.user.email, tenant.user.password);
    otherTenantToken = await login(app, otherTenant.user.email, otherTenant.user.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await deleteTestTenant(prisma, otherTenant.tenantId);
    await prisma.$disconnect();
  });

  function createCustomer(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/customers').set('Authorization', `Bearer ${token}`).send(body);
  }

  it('creates a customer normally when there is no existing match', async () => {
    const res = await createCustomer(managerToken, {
      firstName: 'Kwame',
      lastName: 'Boateng',
      email: `kwame-${Date.now()}@example.test`,
      phone: '+233241111111',
    });
    expect(res.status).toBe(201);
  });

  it('409s with the matching customer on an exact (case-insensitive) email match, and creates nothing', async () => {
    const email = `dupe-email-${Date.now()}@example.test`;
    const first = await createCustomer(managerToken, { firstName: 'Ama', lastName: 'Owusu', email });
    expect(first.status).toBe(201);

    const countBefore = await prisma.customer.count({ where: { tenantId: tenant.tenantId } });
    const second = await createCustomer(managerToken, { firstName: 'Different', lastName: 'Person', email: email.toUpperCase() });
    expect(second.status).toBe(409);
    expect(second.body.duplicates).toHaveLength(1);
    expect(second.body.duplicates[0].email.toLowerCase()).toBe(email.toLowerCase());

    const countAfter = await prisma.customer.count({ where: { tenantId: tenant.tenantId } });
    expect(countAfter).toBe(countBefore);
  });

  it('409s on an exact phone match even with a different email', async () => {
    const phone = '+15557654321';
    const first = await createCustomer(managerToken, { firstName: 'Kojo', lastName: 'Asante', email: `kojo-${Date.now()}@example.test`, phone });
    expect(first.status).toBe(201);

    const second = await createCustomer(managerToken, { firstName: 'Someone', lastName: 'Else', email: `someone-${Date.now()}@example.test`, phone });
    expect(second.status).toBe(409);
    expect(second.body.duplicates.some((d: { phone: string | null }) => d.phone === phone)).toBe(true);
  });

  it('confirmDuplicate: true creates the second customer anyway — a warning, never a hard block', async () => {
    const email = `confirm-${Date.now()}@example.test`;
    const first = await createCustomer(managerToken, { firstName: 'Yaw', lastName: 'Mensah', email });
    expect(first.status).toBe(201);

    const second = await createCustomer(managerToken, { firstName: 'Yaw', lastName: 'Mensah Jr', email, confirmDuplicate: true });
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
  });

  it('never fuzzy-matches on name alone — two different customers with the same name and different email/phone both succeed', async () => {
    const first = await createCustomer(managerToken, { firstName: 'John', lastName: 'Smith', email: `john-smith-1-${Date.now()}@example.test` });
    expect(first.status).toBe(201);

    const second = await createCustomer(managerToken, { firstName: 'John', lastName: 'Smith', email: `john-smith-2-${Date.now()}@example.test` });
    expect(second.status).toBe(201);
  });

  it('is tenant-scoped — the same email already used by another tenant does not block or leak across tenants', async () => {
    const email = `cross-tenant-${Date.now()}@example.test`;
    const inOtherTenant = await createCustomer(otherTenantToken, { firstName: 'Cross', lastName: 'TenantA', email });
    expect(inOtherTenant.status).toBe(201);

    const inThisTenant = await createCustomer(managerToken, { firstName: 'Cross', lastName: 'TenantB', email });
    expect(inThisTenant.status).toBe(201);
  });
});

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  return completeStaffLogin(app, email, password);
}
