import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { MAX_DOCUMENT_SIZE_BYTES } from '../src/documents/documents.service';
import {
  createCustomerWithPortalUser,
  createTestTenant,
  createUserInTenant,
  deleteTestTenant,
  TestPortalCustomerFixture,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

const FAKE_PDF = Buffer.from('%PDF-1.4\n%fake pdf content for e2e testing\n%%EOF');

/**
 * Stage 3G: proves the Documents feature's tenant/customer isolation and
 * staff-only vs customer-visible controls — built on the exact same
 * ownership pattern Stage 2C/3E already established for shipments and
 * invoices (findByIdForCustomer, byte-identical 404s). Also covers
 * upload validation (file type/size) and download integrity (the bytes
 * that come back match the bytes uploaded).
 */
describe('Documents: upload, visibility, isolation, download (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tenantAdminTokenA: string;
  let warehouseStaffTokenA: string;

  let customer1A: TestPortalCustomerFixture;
  let customer2A: TestPortalCustomerFixture;
  let customerB: TestPortalCustomerFixture;
  let customer1APortalToken: string;
  let customer2APortalToken: string;
  let customerBPortalToken: string;

  let shipment1A: { id: string };

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'DocsA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'DocsB', UserRole.WAREHOUSE_MANAGER);

    const tenantAdminA = await createUserInTenant(prisma, tenantA.tenantId, 'TenantAdmin', UserRole.TENANT_ADMIN);
    tenantAdminTokenA = await login(app, tenantAdminA.email, tenantAdminA.password);
    const warehouseStaffA = await createUserInTenant(prisma, tenantA.tenantId, 'WhStaff', UserRole.WAREHOUSE_STAFF);
    warehouseStaffTokenA = await login(app, warehouseStaffA.email, warehouseStaffA.password);

    customer1A = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'C1');
    customer2A = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'C2');
    customerB = await createCustomerWithPortalUser(prisma, tenantB.tenantId, 'CB');
    customer1APortalToken = await login(app, customer1A.user.email, customer1A.user.password);
    customer2APortalToken = await login(app, customer2A.user.email, customer2A.user.password);
    customerBPortalToken = await login(app, customerB.user.email, customerB.user.password);

    shipment1A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer1A.customerId);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  describe('RBAC', () => {
    it('a warehouse-staff token gets 403 uploading (not a DOCUMENT_MANAGE_ROLES role)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/documents/shipments/${shipment1A.id}`)
        .set('Authorization', `Bearer ${warehouseStaffTokenA}`)
        .field('type', 'BILL_OF_LADING')
        .attach('file', FAKE_PDF, { filename: 'bol.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(403);
    });

    it('a customer token gets 403 on the staff upload route', async () => {
      const res = await request(app.getHttpServer())
        .post(`/documents/shipments/${shipment1A.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`)
        .field('type', 'BILL_OF_LADING')
        .attach('file', FAKE_PDF, { filename: 'bol.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(403);
    });

    it('an unauthenticated request gets 401', async () => {
      const res = await request(app.getHttpServer()).get('/portal/documents');
      expect(res.status).toBe(401);
    });
  });

  describe('Upload validation', () => {
    it('rejects a disallowed file type', async () => {
      const res = await request(app.getHttpServer())
        .post(`/documents/shipments/${shipment1A.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .field('type', 'OTHER')
        .attach('file', Buffer.from('#!/bin/sh\necho hi'), { filename: 'script.sh', contentType: 'application/x-sh' });
      expect(res.status).toBe(400);
    });

    it('rejects a file over the size limit', async () => {
      const oversized = Buffer.alloc(MAX_DOCUMENT_SIZE_BYTES + 1, 1);
      const res = await request(app.getHttpServer())
        .post(`/documents/shipments/${shipment1A.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .field('type', 'OTHER')
        .attach('file', oversized, { filename: 'huge.pdf', contentType: 'application/pdf' });
      // 413 Payload Too Large — multer's own limits.fileSize rejection,
      // mapped automatically by Nest's built-in exception handling.
      expect(res.status).toBe(413);
    });

    it('rejects a request with no file at all', async () => {
      const res = await request(app.getHttpServer())
        .post(`/documents/shipments/${shipment1A.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .field('type', 'OTHER');
      expect(res.status).toBe(400);
    });
  });

  describe('Upload, staff-only default, and visibility toggle', () => {
    it('a freshly-uploaded document defaults to staff-only and is invisible to the customer', async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: undefined });
      expect(upload.body.visibleToCustomer).toBe(false);

      const list = await request(app.getHttpServer())
        .get('/portal/documents')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(list.body.some((d: { id: string }) => d.id === upload.body.id)).toBe(false);

      const detail = await request(app.getHttpServer())
        .get(`/portal/documents/${upload.body.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(detail.status).toBe(404);
    });

    it('marking a document visible makes it appear in the portal without a re-upload', async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: undefined });

      const patch = await request(app.getHttpServer())
        .patch(`/documents/${upload.body.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ visibleToCustomer: true });
      expect(patch.status).toBe(200);
      expect(patch.body.visibleToCustomer).toBe(true);

      const detail = await request(app.getHttpServer())
        .get(`/portal/documents/${upload.body.id}`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.fileName).toBe('bol.pdf');
    });

    it('uploading directly to a customer (no shipment) works and is listed staff-side', async () => {
      const res = await request(app.getHttpServer())
        .post(`/documents/customers/${customer1A.customerId}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .field('type', 'ID_DOCUMENT')
        .field('visibleToCustomer', 'false')
        .attach('file', FAKE_PDF, { filename: 'id.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(201);
      expect(res.body.shipmentId).toBeNull();
      expect(res.body.customerId).toBe(customer1A.customerId);

      const staffDetail = await request(app.getHttpServer())
        .get(`/documents/${res.body.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`);
      expect(staffDetail.status).toBe(200);
    });
  });

  describe('Cross-customer and cross-tenant isolation', () => {
    it("customer2 does not see customer1's visible document in their own list", async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: true });
      const res = await request(app.getHttpServer())
        .get('/portal/documents')
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(res.body.some((d: { id: string }) => d.id === upload.body.id)).toBe(false);
    });

    it("customer2 gets 404 fetching customer1's document id directly", async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: true });
      const res = await request(app.getHttpServer())
        .get(`/portal/documents/${upload.body.id}`)
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(res.status).toBe(404);
    });

    it('the 404 for a real cross-customer id is byte-identical to a genuinely nonexistent id', async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: true });
      const crossCustomer = await request(app.getHttpServer())
        .get(`/portal/documents/${upload.body.id}`)
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      const nonexistent = await request(app.getHttpServer())
        .get('/portal/documents/does-not-exist-at-all')
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(crossCustomer.status).toBe(404);
      expect(nonexistent.status).toBe(404);
      expect(crossCustomer.body.message).toBe(nonexistent.body.message);
    });

    it("a tenant B customer gets 404 for tenant A's document", async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: true });
      const res = await request(app.getHttpServer())
        .get(`/portal/documents/${upload.body.id}`)
        .set('Authorization', `Bearer ${customerBPortalToken}`);
      expect(res.status).toBe(404);
    });

    it("customer2 cannot download customer1's document even by guessing the id — 404, not the file", async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: true });
      const res = await request(app.getHttpServer())
        .get(`/portal/documents/${upload.body.id}/download`)
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Download integrity', () => {
    it('staff download returns exactly the bytes that were uploaded, with the right filename', async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: false });
      const res = await request(app.getHttpServer())
        .get(`/documents/${upload.body.id}/download`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(Buffer.isBuffer(res.body) ? res.body.equals(FAKE_PDF) : Buffer.from(res.body).equals(FAKE_PDF)).toBe(true);
      expect(res.headers['content-disposition']).toContain('bol.pdf');
    });

    it("the customer can download their own visible document, and its bytes match what staff uploaded", async () => {
      const upload = await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: true });
      const res = await request(app.getHttpServer())
        .get(`/portal/documents/${upload.body.id}/download`)
        .set('Authorization', `Bearer ${customer1APortalToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(Buffer.isBuffer(res.body) ? res.body.equals(FAKE_PDF) : Buffer.from(res.body).equals(FAKE_PDF)).toBe(true);
    });
  });

  describe('No cross-customer/cross-tenant data leakage in the response body', () => {
    it("the portal document list/detail never contains another customer's or tenant's id", async () => {
      await uploadBolToShipment(app, tenantAdminTokenA, shipment1A.id, { visibleToCustomer: true });
      const res = await request(app.getHttpServer())
        .get('/portal/documents')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(customer2A.customerId);
      expect(raw).not.toContain(customerB.customerId);
      expect(raw).not.toContain(tenantB.tenantId);
      // The portal projection is deliberately stripped of staff-only fields.
      expect(raw).not.toContain('uploadedByUserId');
      expect(raw).not.toContain('visibleToCustomer');
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

async function createShipmentForCustomerId(
  app: INestApplication,
  staffToken: string,
  customerId: string,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      items: [{ itemType: ShipmentItemType.BOX, description: 'Documents e2e test box' }],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}

function uploadBolToShipment(
  app: INestApplication,
  staffToken: string,
  shipmentId: string,
  opts: { visibleToCustomer: boolean | undefined },
) {
  const req = request(app.getHttpServer())
    .post(`/documents/shipments/${shipmentId}`)
    .set('Authorization', `Bearer ${staffToken}`)
    .field('type', 'BILL_OF_LADING');
  if (opts.visibleToCustomer !== undefined) {
    req.field('visibleToCustomer', String(opts.visibleToCustomer));
  }
  return req.attach('file', FAKE_PDF, { filename: 'bol.pdf', contentType: 'application/pdf' });
}
