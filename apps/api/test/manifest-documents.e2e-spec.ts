import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, createUserInTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Print Manifest / Download PDF (GET /manifests/:id/print, GET
 * /manifests/:id/pdf) — proves the five things that actually matter for a
 * document a destination team reconciles real cargo against:
 *   1. Tenant isolation — a cross-tenant id 404s on both endpoints, same
 *      as every other manifest route (never a 403 that would confirm the
 *      id exists on someone else's tenant).
 *   2. Permissions — VIEW_ROLES (same set GET /manifests/:id already
 *      uses) can reach both; a role outside it cannot.
 *   3. Cargo accuracy — every field the packing list promises, for both
 *      the container path (Ocean/RoRo) and the direct-item path (Air),
 *      across multiple containers and multiple customers.
 *   4. The DRAFT (live) vs FINALIZED+ (snapshot) source-switch works, and
 *      critically, that quantity/description — not present in
 *      Manifest.snapshotJson at all — are still correctly populated after
 *      finalize via the documented read-only enrichment lookup. Covered
 *      for both the container-path (Ocean, snapshot.containers[].items)
 *      and the direct-item path (Air, snapshot.items) — the two snapshot
 *      shapes buildFinalizeSnapshot produces are structurally different,
 *      so both need their own proof, not just one standing in for both.
 *   5. GET /manifests/:id/pdf actually returns a real PDF: correct
 *      Content-Type/Content-Disposition and real "%PDF-" bytes.
 *
 * Never asserts anything about finalize()/depart() themselves changing
 * behavior — this manifest lifecycle is explicitly out of scope for this
 * feature and untouched by it (see manifest-finalize.e2e-spec.ts /
 * manifest-departure.e2e-spec.ts for that coverage).
 */
describe('Manifest print/PDF documents (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;
  let tokenB: string;
  let accountantToken: string;
  let driverToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'DocA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'DocB', UserRole.MANAGER);
    tokenA = await login(app, tenantA.user.email, tenantA.user.password);
    tokenB = await login(app, tenantB.user.email, tenantB.user.password);

    const accountant = await createUserInTenant(prisma, tenantA.tenantId, 'Acct', UserRole.FINANCE);
    accountantToken = await login(app, accountant.email, accountant.password);
    const driver = await createUserInTenant(prisma, tenantA.tenantId, 'Driver', UserRole.STAFF);
    driverToken = await login(app, driver.email, driver.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  it('1. a DRAFT Ocean manifest documents its live, current cargo correctly across two containers/customers', async () => {
    const customer2 = await createCustomer(app, tokenA, 'Second Customer');

    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'OCEAN_FCL',
      originWarehouseId: tenantA.warehouseId,
      destinationLocation: 'Accra, Ghana',
      carrierName: 'Maersk',
      vesselName: 'Maersk Atlantic',
      voyageNumber: 'V-2026-014',
    });

    const container1 = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
    const item1 = await createReadyItem(app, tokenA, tenantA, tenantA.customerId, {
      itemType: 'BOX',
      description: 'Household goods',
      quantity: 1,
    });
    await loadIntoContainer(app, tokenA, container1.id, item1.itemId);
    await finalizeContainer(app, tokenA, container1.id);
    await assignContainer(app, tokenA, manifest.id, container1.id);

    const container2 = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
    const item2 = await createReadyItem(app, tokenA, tenantA, customer2.id, {
      itemType: 'PALLET',
      description: 'Commercial inventory',
      quantity: 12,
    });
    await loadIntoContainer(app, tokenA, container2.id, item2.itemId);
    await finalizeContainer(app, tokenA, container2.id);
    await assignContainer(app, tokenA, manifest.id, container2.id);

    const res = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/print`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.manifest.status).toBe('DRAFT');
    expect(res.body.containers.sort((a: { containerNumber: string }, b: { containerNumber: string }) =>
      a.containerNumber.localeCompare(b.containerNumber),
    )).toEqual(
      [
        { containerNumber: container1.containerNumber, containerType: 'TWENTY_FT' },
        { containerNumber: container2.containerNumber, containerType: 'TWENTY_FT' },
      ].sort((a, b) => a.containerNumber.localeCompare(b.containerNumber)),
    );
    expect(res.body.summary).toEqual({
      containerCount: 2,
      itemCount: 2,
      customerCount: 2,
      weightByUnit: {},
    });

    // item1 belongs to tenantA's default fixture customer ("Test Customer",
    // see createTestTenant in utils/fixtures.ts); item2 belongs to the
    // second customer created above ("E2E Second Customer").
    const row1 = res.body.cargo.find((r: { itemCode: string }) => r.itemCode === item1.itemCode);
    expect(row1).toMatchObject({
      itemCode: item1.itemCode,
      trackingNumber: item1.trackingNumber,
      customerName: 'Test Customer',
      itemType: 'BOX',
      description: 'Household goods',
      quantity: 1,
      containerNumber: container1.containerNumber,
    });
    expect(row1.destination as string).toContain('GH');

    const row2 = res.body.cargo.find((r: { itemCode: string }) => r.itemCode === item2.itemCode);
    expect(row2).toMatchObject({
      itemCode: item2.itemCode,
      trackingNumber: item2.trackingNumber,
      customerName: 'E2E Second Customer',
      itemType: 'PALLET',
      description: 'Commercial inventory',
      quantity: 12,
      containerNumber: container2.containerNumber,
    });
  });

  it('2. an Air manifest documents direct (no-container) items correctly — containerNumber is null', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      destinationLocation: 'Accra, Ghana',
      carrierName: 'Delta Cargo',
      flightNumber: 'DL-4471',
    });
    const item = await createReadyItem(app, tokenA, tenantA, tenantA.customerId, {
      itemType: 'CRATE',
      description: 'Air freight test crate',
      quantity: 3,
    });
    await assignItem(app, tokenA, manifest.id, item.itemId);

    const res = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/print`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.containers).toEqual([]);
    expect(res.body.cargo).toHaveLength(1);
    expect(res.body.cargo[0]).toMatchObject({
      itemCode: item.itemCode,
      itemType: 'CRATE',
      description: 'Air freight test crate',
      quantity: 3,
      containerNumber: null,
    });
  });

  it('3. after finalize + depart, the document reads from the immutable snapshot and still has quantity/description via live enrichment', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'OCEAN_FCL',
      originWarehouseId: tenantA.warehouseId,
      destinationLocation: 'Accra, Ghana',
      carrierName: 'Maersk',
      vesselName: 'Maersk Atlantic',
      voyageNumber: 'V-2026-020',
    });
    const container = await createContainer(app, tokenA, { warehouseId: tenantA.warehouseId });
    const item = await createReadyItem(app, tokenA, tenantA, tenantA.customerId, {
      itemType: 'BARREL',
      description: 'Snapshot enrichment test',
      quantity: 4,
    });
    await loadIntoContainer(app, tokenA, container.id, item.itemId);
    await finalizeContainer(app, tokenA, container.id);
    await assignContainer(app, tokenA, manifest.id, container.id);
    await finalizeManifest(app, tokenA, manifest.id);
    await departManifestReq(app, tokenA, manifest.id);

    // Confirm the DB snapshot really does NOT carry description/quantity —
    // proving the print endpoint's values below come from the documented
    // enrichment lookup, not accidentally from the snapshot itself.
    const dbManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.id } });
    const snapshot = dbManifest.snapshotJson as { containers: { items: Record<string, unknown>[] }[] };
    expect(snapshot.containers[0].items[0]).not.toHaveProperty('description');
    expect(snapshot.containers[0].items[0]).not.toHaveProperty('quantity');

    const res = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/print`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.manifest.status).toBe('DEPARTED');
    expect(res.body.cargo[0]).toMatchObject({
      itemCode: item.itemCode,
      description: 'Snapshot enrichment test',
      quantity: 4,
      containerNumber: container.containerNumber,
    });
  });

  it('4. an Air manifest, after finalize + depart, reads its direct items from snapshot.items (not snapshot.containers) with quantity/description enrichment', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      originWarehouseId: tenantA.warehouseId,
      destinationLocation: 'Accra, Ghana',
      carrierName: 'Delta Cargo',
      flightNumber: 'DL-5500',
    });
    const item = await createReadyItem(app, tokenA, tenantA, tenantA.customerId, {
      itemType: 'CRATE',
      description: 'Air snapshot enrichment test',
      quantity: 7,
    });
    await assignItem(app, tokenA, manifest.id, item.itemId);
    await finalizeManifest(app, tokenA, manifest.id);
    await departManifestReq(app, tokenA, manifest.id);

    // Confirm this is genuinely the direct-item snapshot shape (snapshot.items,
    // no containers at all) and that it too lacks description/quantity —
    // same proof as the Ocean/container case above, for the other path.
    const dbManifest = await prisma.manifest.findUniqueOrThrow({ where: { id: manifest.id } });
    const snapshot = dbManifest.snapshotJson as { containers: unknown[]; items: Record<string, unknown>[] };
    expect(snapshot.containers).toEqual([]);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).not.toHaveProperty('description');
    expect(snapshot.items[0]).not.toHaveProperty('quantity');

    const res = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/print`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.manifest.status).toBe('DEPARTED');
    expect(res.body.containers).toEqual([]);
    expect(res.body.cargo).toHaveLength(1);
    expect(res.body.cargo[0]).toMatchObject({
      itemCode: item.itemCode,
      description: 'Air snapshot enrichment test',
      quantity: 7,
      containerNumber: null,
    });
  });

  it('5. tenant isolation — tenant B gets 404 (not 403) on tenant A manifest print/pdf by id', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      carrierName: 'Delta',
      flightNumber: 'DL-1',
      originLocation: 'A',
      destinationLocation: 'B',
    });

    const printRes = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/print`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(printRes.status).toBe(404);

    const pdfRes = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/pdf`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(pdfRes.status).toBe(404);
  });

  /**
   * RBAC V1: manifest view (including print/PDF) is OPERATIONS_ROLES
   * (OWNER/MANAGER/STAFF) now — STAFF (the old DRIVER role's successor)
   * can reach both. FINANCE (the old ACCOUNTANT role's successor) has no
   * manifest access at all, not even view — its V1 scope is a closed list
   * that doesn't include manifests. Both assertions are the inverse of
   * this test's pre-RBAC-V1 version, reflecting that deliberate change.
   */
  it('6. permissions — STAFF (OPERATIONS_ROLES) can access; FINANCE (no manifest access) gets 403', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      carrierName: 'Delta',
      flightNumber: 'DL-2',
      originLocation: 'A',
      destinationLocation: 'B',
    });

    const staffPrintRes = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/print`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(staffPrintRes.status).toBe(200);

    const staffPdfRes = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/pdf`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(staffPdfRes.status).toBe(200);

    const financeRes = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/print`)
      .set('Authorization', `Bearer ${accountantToken}`);
    expect(financeRes.status).toBe(403);
  });

  it('7. GET /manifests/:id/pdf returns a real PDF file', async () => {
    const manifest = await createManifest(app, tokenA, {
      shipmentMode: 'AIR',
      carrierName: 'Delta',
      flightNumber: 'DL-3',
      originLocation: 'A',
      destinationLocation: 'B',
    });
    const item = await createReadyItem(app, tokenA, tenantA, tenantA.customerId, {
      itemType: 'BOX',
      description: 'PDF smoke test',
      quantity: 1,
    });
    await assignItem(app, tokenA, manifest.id, item.itemId);

    const res = await request(app.getHttpServer())
      .get(`/manifests/${manifest.id}/pdf`)
      .set('Authorization', `Bearer ${tokenA}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`Manifest-${manifest.manifestNumber}.pdf`);
    const bytes: Buffer = res.body;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention (see manifest-finalize.e2e-spec.ts).
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function createManifest(
  app: INestApplication,
  token: string,
  body: Record<string, unknown>,
): Promise<{ id: string; manifestNumber: string }> {
  const res = await request(app.getHttpServer()).post('/manifests').set('Authorization', `Bearer ${token}`).send(body);
  if (res.status !== 201) {
    throw new Error(`Manifest creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function finalizeManifest(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/finalize`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (res.status !== 201) {
    throw new Error(`Finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function departManifestReq(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/depart`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (res.status !== 201) {
    throw new Error(`Depart failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function assignContainer(app: INestApplication, token: string, manifestId: string, containerId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/containers/${containerId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (res.status !== 201) {
    throw new Error(`Assign container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function assignItem(app: INestApplication, token: string, manifestId: string, itemId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/items/${itemId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ scanned: false });
  if (res.status !== 201) {
    throw new Error(`Assign item failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function createCustomer(app: INestApplication, token: string, label: string): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/customers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      firstName: 'E2E',
      lastName: label,
      email: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@example.test`,
    });
  if (res.status !== 201) {
    throw new Error(`Customer creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function createSingleShipment(
  app: INestApplication,
  token: string,
  customerId: string,
  item: { itemType: string; description?: string; quantity?: number },
): Promise<{ id: string; trackingNumber: string; items: { id: string; itemCode: string }[] }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      shipmentMode: 'OCEAN_LCL',
      originCountry: 'US',
      destinationCountry: 'GH',
      items: [item],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function receiveItem(app: INestApplication, token: string, itemId: string, warehouseId: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false });
  if (res.status !== 201) {
    throw new Error(`Receive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function processOnce(app: INestApplication, token: string, itemId: string, warehouseId: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/process`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, condition: 'GOOD', result: 'READY', scanned: false });
  if (res.status !== 201) {
    throw new Error(`Process failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function createReadyItem(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  customerId: string,
  item: { itemType: string; description?: string; quantity?: number },
): Promise<{ itemId: string; itemCode: string; shipmentId: string; trackingNumber: string }> {
  const shipment = await createSingleShipment(app, token, customerId, item);
  const shipmentItem = shipment.items[0];
  await receiveItem(app, token, shipmentItem.id, tenant.warehouseId);
  await processOnce(app, token, shipmentItem.id, tenant.warehouseId);
  return { itemId: shipmentItem.id, itemCode: shipmentItem.itemCode, shipmentId: shipment.id, trackingNumber: shipment.trackingNumber };
}

async function createContainer(app: INestApplication, token: string, opts: { warehouseId?: string }): Promise<{ id: string; containerNumber: string }> {
  const res = await request(app.getHttpServer())
    .post('/containers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      containerNumber: `E2E-CN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      containerType: 'TWENTY_FT',
      ...opts,
    });
  if (res.status !== 201) {
    throw new Error(`Container creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function loadIntoContainer(app: INestApplication, token: string, containerId: string, itemId: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/containers/${containerId}/items/${itemId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ scanned: false });
  if (res.status !== 201) {
    throw new Error(`Load into container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function finalizeContainer(app: INestApplication, token: string, containerId: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/containers/${containerId}/finalize`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (res.status !== 201) {
    throw new Error(`Finalize container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}
