import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Website Launch: public lead capture (Contact + Request-a-Quote forms)
 * and its staff-facing view. Proves the same three things every module
 * in this codebase is proven against:
 *   1. Tenant isolation — leads are tenantId-scoped like everything else.
 *   2. Role authorization — LEAD_MANAGE_ROLES only for staff routes;
 *      the public submit route is deliberately open to everyone.
 *   3. Correctness — a CONTACT lead and a QUOTE_REQUEST lead both persist
 *      exactly what was submitted, quoteDetails only for the latter, an
 *      unknown tenantSlug 404s, and status transitions work.
 */
describe('Leads: public capture + staff triage (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let ownerTokenA: string;
  let warehouseStaffTokenA: string;
  let managerTokenA: string;
  let ownerTokenB: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'LeadsA', UserRole.TENANT_OWNER);
    tenantB = await createTestTenant(prisma, 'LeadsB', UserRole.TENANT_OWNER);
    ownerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    ownerTokenB = await login(app, tenantB.user.email, tenantB.user.password);

    const warehouseStaffA = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.WAREHOUSE_STAFF);
    warehouseStaffTokenA = await login(app, warehouseStaffA.email, warehouseStaffA.password);
    const managerA = await createUserInTenant(prisma, tenantA.tenantId, 'Manager', UserRole.WAREHOUSE_MANAGER);
    managerTokenA = await login(app, managerA.email, managerA.password);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('Public lead capture (POST /public/leads)', () => {
    it('accepts a CONTACT lead with no auth required', async () => {
      const res = await request(app.getHttpServer()).post('/public/leads').send({
        tenantSlug: tenantA.slug,
        type: 'CONTACT',
        firstName: 'Visitor',
        lastName: 'One',
        email: 'visitor1@example.test',
        phone: '+15550001111',
        subject: 'Quick question',
        message: 'Do you ship to Lagos?',
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });

      const stored = await prisma.websiteLead.findFirst({ where: { tenantId: tenantA.tenantId, email: 'visitor1@example.test' } });
      expect(stored).not.toBeNull();
      expect(stored?.type).toBe('CONTACT');
      expect(stored?.status).toBe('NEW');
      expect(stored?.subject).toBe('Quick question');
      expect(stored?.quoteDetails).toBeNull();
    });

    it('accepts a QUOTE_REQUEST lead with structured quoteDetails', async () => {
      const res = await request(app.getHttpServer()).post('/public/leads').send({
        tenantSlug: tenantA.slug,
        type: 'QUOTE_REQUEST',
        firstName: 'Visitor',
        email: 'visitor2@example.test',
        quoteDetails: {
          originCountry: 'US',
          destinationCountry: 'Ghana',
          shipmentMode: 'OCEAN_LCL',
          itemType: 'BOX',
          approximateWeight: '75',
        },
      });
      expect(res.status).toBe(201);

      const stored = await prisma.websiteLead.findFirst({ where: { tenantId: tenantA.tenantId, email: 'visitor2@example.test' } });
      expect(stored?.type).toBe('QUOTE_REQUEST');
      expect(stored?.quoteDetails).toEqual({
        originCountry: 'US',
        destinationCountry: 'Ghana',
        shipmentMode: 'OCEAN_LCL',
        itemType: 'BOX',
        approximateWeight: '75',
      });
    });

    it('rejects an unknown tenantSlug with 404, and creates nothing', async () => {
      const before = await prisma.websiteLead.count();
      const res = await request(app.getHttpServer()).post('/public/leads').send({
        tenantSlug: 'this-tenant-does-not-exist',
        type: 'CONTACT',
        firstName: 'X',
        email: 'x@example.test',
      });
      expect(res.status).toBe(404);
      const after = await prisma.websiteLead.count();
      expect(after).toBe(before);
    });

    it('rejects a missing required field with 400', async () => {
      const res = await request(app.getHttpServer()).post('/public/leads').send({
        tenantSlug: tenantA.slug,
        type: 'CONTACT',
      });
      expect(res.status).toBe(400);
    });

    it("a lead submitted for tenant B never appears in tenant A's list", async () => {
      await request(app.getHttpServer()).post('/public/leads').send({
        tenantSlug: tenantB.slug,
        type: 'CONTACT',
        firstName: 'TenantB',
        email: 'tenantb-visitor@example.test',
      });
      const res = await request(app.getHttpServer()).get('/leads').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.body.find((l: { email: string }) => l.email === 'tenantb-visitor@example.test')).toBeUndefined();
    });
  });

  describe('Staff list + status (role authorization + tenant isolation)', () => {
    it('unauthenticated requests get 401', async () => {
      const res = await request(app.getHttpServer()).get('/leads');
      expect(res.status).toBe(401);
    });

    it('WAREHOUSE_STAFF (not a LEAD_MANAGE_ROLES member) gets 403', async () => {
      const res = await request(app.getHttpServer()).get('/leads').set('Authorization', `Bearer ${warehouseStaffTokenA}`);
      expect(res.status).toBe(403);
    });

    it('WAREHOUSE_MANAGER (a LEAD_MANAGE_ROLES member) can list leads', async () => {
      const res = await request(app.getHttpServer()).get('/leads').set('Authorization', `Bearer ${managerTokenA}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("tenant B's owner never sees tenant A's leads", async () => {
      const res = await request(app.getHttpServer()).get('/leads').set('Authorization', `Bearer ${ownerTokenB}`);
      expect(res.status).toBe(200);
      expect(res.body.find((l: { email: string }) => l.email === 'visitor1@example.test')).toBeUndefined();
    });

    it('filters correctly by status and type', async () => {
      const contactOnly = await request(app.getHttpServer()).get('/leads?type=CONTACT').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(contactOnly.body.every((l: { type: string }) => l.type === 'CONTACT')).toBe(true);

      const newOnly = await request(app.getHttpServer()).get('/leads?status=NEW').set('Authorization', `Bearer ${ownerTokenA}`);
      expect(newOnly.body.every((l: { status: string }) => l.status === 'NEW')).toBe(true);
    });

    it('updates a lead status, and a stranger tenant gets 404 trying the same id', async () => {
      const list = await request(app.getHttpServer()).get('/leads').set('Authorization', `Bearer ${ownerTokenA}`);
      const leadId = list.body[0].id;

      const updateRes = await request(app.getHttpServer())
        .patch(`/leads/${leadId}/status`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ status: 'CONTACTED' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.status).toBe('CONTACTED');

      const crossTenant = await request(app.getHttpServer())
        .patch(`/leads/${leadId}/status`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .send({ status: 'CLOSED' });
      expect(crossTenant.status).toBe(404);

      // Confirm tenant B's attempt had no effect on tenant A's row.
      const stillA = await prisma.websiteLead.findUnique({ where: { id: leadId } });
      expect(stillA?.status).toBe('CONTACTED');
    });

    it('WAREHOUSE_STAFF gets 403 attempting to update a lead status', async () => {
      const list = await request(app.getHttpServer()).get('/leads').set('Authorization', `Bearer ${ownerTokenA}`);
      const leadId = list.body[0].id;
      const res = await request(app.getHttpServer())
        .patch(`/leads/${leadId}/status`)
        .set('Authorization', `Bearer ${warehouseStaffTokenA}`)
        .send({ status: 'CLOSED' });
      expect(res.status).toBe(403);
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention.
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
