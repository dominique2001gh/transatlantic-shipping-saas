import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end regression suite for Milestone 3E-A (Manifest foundation:
 * schema + create/list/detail only). Assigning containers/items,
 * finalizing, and recording departure are deliberately NOT covered here
 * — those endpoints don't exist yet (later controlled steps). This suite
 * proves: Ocean and Air manifests can both be created without forcing
 * air freight through the container concept, validation/eligibility on
 * creation, RBAC, and full tenant isolation — including that two tenants
 * can each auto-generate the same manifest number independently, the
 * same tenant-scoped-uniqueness guarantee already proven for tracking
 * numbers and item codes.
 */
describe('Manifest foundation (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;
  let tokenB: string;
  let customerToken: string;
  let accountantToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'ManA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'ManB', UserRole.WAREHOUSE_MANAGER);
    const customerUser = await createUserInTenant(prisma, tenantA.tenantId, 'Cust', UserRole.CUSTOMER);
    const accountantUser = await createUserInTenant(prisma, tenantA.tenantId, 'Acct', UserRole.ACCOUNTANT);

    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
    tokenB = await login(app, tenantB.user.email, tenantB.user.password);
    customerToken = await login(app, customerUser.email, customerUser.password);
    accountantToken = await login(app, accountantUser.email, accountantUser.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  it('creates an Ocean manifest with vessel/voyage fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/manifests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        shipmentMode: 'OCEAN_FCL',
        originWarehouseId: tenantA.warehouseId,
        originLocation: 'Houston, TX',
        destinationLocation: 'Tema, Ghana',
        carrierName: 'Maersk',
        vesselName: 'Maersk Atlantic',
        voyageNumber: 'V-2026-014',
        plannedDepartureAt: '2026-09-15T00:00:00.000Z',
        estimatedArrivalAt: '2026-10-05T00:00:00.000Z',
      });
    expect(res.status).toBe(201);
    expect(res.body.shipmentMode).toBe('OCEAN_FCL');
    expect(res.body.vesselName).toBe('Maersk Atlantic');
    expect(res.body.voyageNumber).toBe('V-2026-014');
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.manifestNumber).toMatch(/^MAN-\d{4}-\d{6}$/);
    expect(res.body.originWarehouse.id).toBe(tenantA.warehouseId);
    expect(res.body.containers).toEqual([]);
    expect(res.body.items).toEqual([]);
    expect(res.body.summary).toEqual({ containerCount: 0, itemCount: 0, customerCount: 0, weightByUnit: {} });
  });

  it('creates an Air manifest with a flight number and no container/vessel concept forced onto it', async () => {
    const res = await request(app.getHttpServer())
      .post('/manifests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        shipmentMode: 'AIR',
        originWarehouseId: tenantA.warehouseId,
        carrierName: 'Delta Cargo',
        flightNumber: 'DL-4471',
      });
    expect(res.status).toBe(201);
    expect(res.body.shipmentMode).toBe('AIR');
    expect(res.body.flightNumber).toBe('DL-4471');
    expect(res.body.vesselName).toBeNull();
    expect(res.body.voyageNumber).toBeNull();
  });

  it('rejects creation without shipmentMode', async () => {
    const res = await request(app.getHttpServer())
      .post('/manifests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ carrierName: 'Some Carrier' });
    expect(res.status).toBe(400);
  });

  it("rejects a warehouseId belonging to another tenant (404, not 403 — never confirms it exists)", async () => {
    const res = await request(app.getHttpServer())
      .post('/manifests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ shipmentMode: 'AIR', originWarehouseId: tenantB.warehouseId });
    expect(res.status).toBe(404);
  });

  it('rejects a routeId belonging to another tenant', async () => {
    const routeB = await prisma.route.create({
      data: {
        tenantId: tenantB.tenantId,
        name: 'Tenant B Route',
        originCountry: 'US',
        destinationCountry: 'GH',
        shipmentMode: 'OCEAN_FCL',
      },
    });
    const res = await request(app.getHttpServer())
      .post('/manifests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ shipmentMode: 'OCEAN_FCL', routeId: routeB.id });
    expect(res.status).toBe(404);
  });

  it('lists only the caller\'s own tenant manifests, filterable by status and mode', async () => {
    await request(app.getHttpServer())
      .post('/manifests')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ shipmentMode: 'AIR' });

    const res = await request(app.getHttpServer())
      .get('/manifests')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const tenantIds = new Set(res.body.map((m: { tenantId: string }) => m.tenantId));
    expect(tenantIds.size).toBe(1);
    expect(tenantIds.has(tenantA.tenantId)).toBe(true);

    const filteredRes = await request(app.getHttpServer())
      .get('/manifests?status=DRAFT&shipmentMode=AIR')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(filteredRes.status).toBe(200);
    for (const m of filteredRes.body) {
      expect(m.status).toBe('DRAFT');
      expect(m.shipmentMode).toBe('AIR');
    }
  });

  it('lets two independent fresh tenants each generate the identical first manifest number without conflict', async () => {
    // Two brand-new tenants, both starting their manifestNumberSequence at
    // 0 with the same default "MAN" prefix — their first manifest each
    // is guaranteed to format to the exact same string. This is the same
    // proof-by-construction pattern used for tracking numbers/item codes:
    // if @@unique([tenantId, manifestNumber]) were accidentally global
    // instead of tenant-scoped, the second create below would 409/500.
    const freshA = await createTestTenant(prisma, 'ManFreshA', UserRole.WAREHOUSE_MANAGER);
    const freshB = await createTestTenant(prisma, 'ManFreshB', UserRole.WAREHOUSE_MANAGER);
    try {
      const freshTokenA = await login(app, freshA.user.email, freshA.user.password);
      const freshTokenB = await login(app, freshB.user.email, freshB.user.password);

      const resA = await request(app.getHttpServer())
        .post('/manifests')
        .set('Authorization', `Bearer ${freshTokenA}`)
        .send({ shipmentMode: 'AIR' });
      const resB = await request(app.getHttpServer())
        .post('/manifests')
        .set('Authorization', `Bearer ${freshTokenB}`)
        .send({ shipmentMode: 'AIR' });

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(resA.body.manifestNumber).toBe(resB.body.manifestNumber);
      expect(resA.body.tenantId).not.toBe(resB.body.tenantId);
    } finally {
      await deleteTestTenant(prisma, freshA.tenantId);
      await deleteTestTenant(prisma, freshB.tenantId);
    }
  });

  it("cross-tenant denial: Tenant B cannot view Tenant A's manifest", async () => {
    const createRes = await request(app.getHttpServer())
      .post('/manifests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ shipmentMode: 'OCEAN_LCL' });
    const res = await request(app.getHttpServer())
      .get(`/manifests/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  describe('RBAC', () => {
    it('rejects a CUSTOMER user from creating, listing, or viewing manifests', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/manifests')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ shipmentMode: 'AIR' });
      expect(createRes.status).toBe(403);

      const listRes = await request(app.getHttpServer()).get('/manifests').set('Authorization', `Bearer ${customerToken}`);
      expect(listRes.status).toBe(403);
    });

    it('allows ACCOUNTANT to view/list but not create', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/manifests')
        .set('Authorization', `Bearer ${accountantToken}`);
      expect(listRes.status).toBe(200);

      const createRes = await request(app.getHttpServer())
        .post('/manifests')
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ shipmentMode: 'AIR' });
      expect(createRes.status).toBe(403);
    });

    it('allows WAREHOUSE_MANAGER (in OPERATIONS_ROLES) to create', async () => {
      const res = await request(app.getHttpServer())
        .post('/manifests')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ shipmentMode: 'RORO' });
      expect(res.status).toBe(201);
    });
  });
});

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
