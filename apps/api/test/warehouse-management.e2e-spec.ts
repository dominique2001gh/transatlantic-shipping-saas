import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Warehouse Location Management (OWNER/MANAGER) e2e suite. Covers the new
 * /warehouse/manage* routes only — the pre-existing /warehouse/locations
 * (operational dropdown) route and its filtering/defaulting behavior are
 * intentionally untouched by this feature and are already covered by
 * warehouse-tenant-isolation.e2e-spec.ts.
 *
 * Also proves (see "operational visibility" below) that a warehouse
 * created here with isDestinationWarehouse: true is immediately visible
 * through the existing GET /warehouse/locations endpoint — i.e. this
 * feature required zero changes to the operational
 * listing/defaulting/dropdown code path.
 */
describe('Warehouse Location Management (e2e)', () => {
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
    tenantA = await createTestTenant(prisma, 'WhmA', UserRole.OWNER);
    tenantB = await createTestTenant(prisma, 'WhmB', UserRole.OWNER);

    const managerA = await createUserInTenant(prisma, tenantA.tenantId, 'Manager', UserRole.MANAGER);
    const staffA = await createUserInTenant(prisma, tenantA.tenantId, 'Staff', UserRole.STAFF);
    const financeA = await createUserInTenant(prisma, tenantA.tenantId, 'Finance', UserRole.FINANCE);

    ownerTokenA = await login(app, tenantA.user.email, tenantA.user.password);
    managerTokenA = await login(app, managerA.email, managerA.password);
    staffTokenA = await login(app, staffA.email, staffA.password);
    financeTokenA = await login(app, financeA.email, financeA.password);
    ownerTokenB = await login(app, tenantB.user.email, tenantB.user.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  // -- RBAC -----------------------------------------------------------------

  describe('RBAC', () => {
    it('allows OWNER to create a warehouse', async () => {
      const payload = newWarehousePayload('OWNER-CREATE');
      const res = await request(app.getHttpServer())
        .post('/warehouse/manage')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send(payload);
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(payload.code);
    });

    it('allows MANAGER to create a warehouse', async () => {
      const res = await request(app.getHttpServer())
        .post('/warehouse/manage')
        .set('Authorization', `Bearer ${managerTokenA}`)
        .send(newWarehousePayload('MANAGER-CREATE'));
      expect(res.status).toBe(201);
    });

    it('403s STAFF attempting to create a warehouse', async () => {
      const res = await request(app.getHttpServer())
        .post('/warehouse/manage')
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send(newWarehousePayload('STAFF-CREATE'));
      expect(res.status).toBe(403);
    });

    it('403s FINANCE attempting to create a warehouse', async () => {
      const res = await request(app.getHttpServer())
        .post('/warehouse/manage')
        .set('Authorization', `Bearer ${financeTokenA}`)
        .send(newWarehousePayload('FINANCE-CREATE'));
      expect(res.status).toBe(403);
    });

    it('403s STAFF attempting to list the management view', async () => {
      const res = await request(app.getHttpServer())
        .get('/warehouse/manage')
        .set('Authorization', `Bearer ${staffTokenA}`);
      expect(res.status).toBe(403);
    });

    it('403s STAFF attempting to update a warehouse', async () => {
      const created = await createWarehouse(app, ownerTokenA, newWarehousePayload('STAFF-UPDATE-TARGET'));
      const res = await request(app.getHttpServer())
        .patch(`/warehouse/manage/${created.id}`)
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send({ isDestinationWarehouse: true });
      expect(res.status).toBe(403);
    });
  });

  // -- Create / validation ----------------------------------------------------

  describe('create', () => {
    it('creates a warehouse with independent origin/destination flags, both true', async () => {
      const created = await createWarehouse(app, ownerTokenA, {
        ...newWarehousePayload('BOTH-FLAGS'),
        isOriginWarehouse: true,
        isDestinationWarehouse: true,
      });
      expect(created.isOriginWarehouse).toBe(true);
      expect(created.isDestinationWarehouse).toBe(true);
    });

    it('defaults both flags to false when omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/warehouse/manage')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({
          name: 'No Flags Warehouse',
          code: `NOFLAG-${Date.now()}`,
          addressLine1: '1 Test St',
          city: 'Testville',
          country: 'US',
        });
      expect(res.status).toBe(201);
      expect(res.body.isOriginWarehouse).toBe(false);
      expect(res.body.isDestinationWarehouse).toBe(false);
    });

    it('409s creating a warehouse with a code already used by the same tenant', async () => {
      const payload = newWarehousePayload('DUPLICATE');
      await createWarehouse(app, ownerTokenA, payload);
      const res = await request(app.getHttpServer())
        .post('/warehouse/manage')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send(payload);
      expect(res.status).toBe(409);
    });

    it('allows two different tenants to independently use the same warehouse code', async () => {
      const payload = newWarehousePayload('SHARED-CODE');
      const a = await createWarehouse(app, ownerTokenA, payload);
      const b = await createWarehouse(app, ownerTokenB, payload);
      expect(a.code).toBe(b.code);
      expect(a.id).not.toBe(b.id);
    });
  });

  // -- Update -----------------------------------------------------------------

  describe('update', () => {
    it('toggles isDestinationWarehouse on an existing warehouse', async () => {
      const created = await createWarehouse(app, ownerTokenA, newWarehousePayload('TOGGLE-DEST'));
      expect(created.isDestinationWarehouse).toBe(false);

      const res = await request(app.getHttpServer())
        .patch(`/warehouse/manage/${created.id}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ isDestinationWarehouse: true });
      expect(res.status).toBe(200);
      expect(res.body.isDestinationWarehouse).toBe(true);
      expect(res.body.isOriginWarehouse).toBe(created.isOriginWarehouse);
    });

    it('deactivates a warehouse via isActive', async () => {
      const created = await createWarehouse(app, ownerTokenA, newWarehousePayload('DEACTIVATE'));
      const res = await request(app.getHttpServer())
        .patch(`/warehouse/manage/${created.id}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ isActive: false });
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });

    it("404s Tenant B attempting to update Tenant A's warehouse", async () => {
      const created = await createWarehouse(app, ownerTokenA, newWarehousePayload('CROSS-TENANT-UPDATE'));
      const res = await request(app.getHttpServer())
        .patch(`/warehouse/manage/${created.id}`)
        .set('Authorization', `Bearer ${ownerTokenB}`)
        .send({ isDestinationWarehouse: true });
      expect(res.status).toBe(404);
    });

    it('404s updating a nonexistent warehouse id', async () => {
      const res = await request(app.getHttpServer())
        .patch('/warehouse/manage/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ isDestinationWarehouse: true });
      expect(res.status).toBe(404);
    });
  });

  // -- Tenant isolation on listing ---------------------------------------------

  describe('tenant isolation', () => {
    it("does not include Tenant B's warehouses in Tenant A's management list", async () => {
      const createdB = await createWarehouse(app, ownerTokenB, newWarehousePayload('ISOLATION-B'));
      const res = await request(app.getHttpServer())
        .get('/warehouse/manage')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((w: { id: string }) => w.id);
      expect(ids).not.toContain(createdB.id);
    });

    it('management list includes inactive warehouses, unlike the operational /warehouse/locations list', async () => {
      const created = await createWarehouse(app, ownerTokenA, newWarehousePayload('INACTIVE-VISIBLE'));
      await request(app.getHttpServer())
        .patch(`/warehouse/manage/${created.id}`)
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({ isActive: false });

      const manageRes = await request(app.getHttpServer())
        .get('/warehouse/manage')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(manageRes.body.map((w: { id: string }) => w.id)).toContain(created.id);

      const operationalRes = await request(app.getHttpServer())
        .get('/warehouse/locations')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(operationalRes.body.map((w: { id: string }) => w.id)).not.toContain(created.id);
    });
  });

  // -- Operational visibility: no change needed to the existing dropdown path --

  describe('operational visibility of a newly-created destination warehouse', () => {
    it('a warehouse created here with isDestinationWarehouse: true appears in GET /warehouse/locations untouched', async () => {
      const created = await createWarehouse(app, ownerTokenA, {
        ...newWarehousePayload('NEW-DESTINATION'),
        isDestinationWarehouse: true,
      });

      const res = await request(app.getHttpServer())
        .get('/warehouse/locations')
        .set('Authorization', `Bearer ${ownerTokenA}`);
      expect(res.status).toBe(200);
      const found = (res.body as { id: string; isDestinationWarehouse: boolean }[]).find((w) => w.id === created.id);
      expect(found).toBeDefined();
      expect(found?.isDestinationWarehouse).toBe(true);
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

let codeCounter = 0;

/** Warehouse.code has a 20-char max (see CreateWarehouseDto) — a short random suffix keeps every call unique without risking overflow. */
function newWarehousePayload(label: string) {
  codeCounter += 1;
  return {
    name: `${label} Warehouse`,
    code: `W${Date.now().toString(36)}${codeCounter}`.slice(0, 20),
    addressLine1: '1 Test Street',
    city: 'Testville',
    country: 'US',
  };
}

async function createWarehouse(
  app: INestApplication,
  token: string,
  payload: Record<string, unknown>,
): Promise<{
  id: string;
  code: string;
  isOriginWarehouse: boolean;
  isDestinationWarehouse: boolean;
  isActive: boolean;
}> {
  const res = await request(app.getHttpServer())
    .post('/warehouse/manage')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
  if (res.status !== 201) {
    throw new Error(`Warehouse creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
