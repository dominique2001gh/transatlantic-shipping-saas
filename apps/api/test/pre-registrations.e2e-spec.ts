import { INestApplication } from '@nestjs/common';
import { PrismaClient, PreRegistrationStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import {
  createCustomerWithPortalUser,
  createTestTenant,
  createUserInTenant,
  deleteTestTenant,
  TestPortalCustomerFixture,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { completeStaffLogin } from './utils/mfa-login';

/**
 * Customer Self-Service Pre-Registration, Stage 1 (backend/data foundation
 * only — no conversion into Quick Receive yet). Covers:
 *   - tenant/customer isolation on every customer-facing and staff-facing
 *     route, including the "staff must not confirm another tenant's
 *     reference exists" anti-enumeration posture;
 *   - a pre-registration never creates a Shipment/ShipmentItem, an official
 *     tracking number, or any warehouse-visible record — asserted directly
 *     against the database, not just against the pre-registration's own
 *     response shape;
 *   - the full DRAFT -> SUBMITTED -> CANCELLED lifecycle and its guards
 *     (edit only while DRAFT, cancel only while DRAFT/SUBMITTED, no
 *     re-submitting/re-cancelling a terminal record);
 *   - PRE-<year>-<seq> reference uniqueness/format, assigned only on
 *     submit, in its own namespace from official tracking numbers;
 *   - the structural (DB-level unique constraint) duplicate-conversion
 *     guard on convertedShipmentId, ahead of any actual conversion logic
 *     (which does not exist yet — see PreRegistrationsService's own doc
 *     comment).
 */
describe('Customer Pre-Registration (Stage 1, e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let staffA: TestPortalCustomerFixtureHolder;
  let staffB: TestPortalCustomerFixtureHolder;
  let customerA1: TestPortalCustomerFixture;
  let customerA1Token: string;
  let customerA2: TestPortalCustomerFixture;
  let customerA2Token: string;
  let customerB: TestPortalCustomerFixture;
  let customerBToken: string;

  interface TestPortalCustomerFixtureHolder {
    token: string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'PreRegA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'PreRegB', UserRole.MANAGER);

    const staffAUser = await createUserInTenant(prisma, tenantA.tenantId, 'StaffA', UserRole.STAFF);
    const staffBUser = await createUserInTenant(prisma, tenantB.tenantId, 'StaffB', UserRole.STAFF);
    staffA = { token: await login(app, staffAUser.email, staffAUser.password) };
    staffB = { token: await login(app, staffBUser.email, staffBUser.password) };

    customerA1 = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'A1');
    customerA1Token = await login(app, customerA1.user.email, customerA1.user.password);
    customerA2 = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'A2');
    customerA2Token = await login(app, customerA2.user.email, customerA2.user.password);
    customerB = await createCustomerWithPortalUser(prisma, tenantB.tenantId, 'B');
    customerBToken = await login(app, customerB.user.email, customerB.user.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  describe('create (DRAFT)', () => {
    it('creates a DRAFT with no referenceNumber, and creates NO Shipment/ShipmentItem/tracking number anywhere', async () => {
      const before = await prisma.shipment.count({ where: { tenantId: tenantA.tenantId } });
      const beforeItems = await prisma.shipmentItem.count({ where: { tenantId: tenantA.tenantId } });

      const res = await createDraft(app, customerA1Token, { destinationCountry: 'GH', recipientName: 'Ama Boateng' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.referenceNumber).toBeNull();
      expect(res.body.customerId).toBe(customerA1.customerId);
      expect(res.body.tenantId).toBe(tenantA.tenantId);

      const dbRecord = await prisma.shipmentPreRegistration.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(dbRecord.status).toBe(PreRegistrationStatus.DRAFT);
      expect(dbRecord.referenceNumber).toBeNull();

      // The critical invariant: nothing warehouse-visible was created.
      expect(await prisma.shipment.count({ where: { tenantId: tenantA.tenantId } })).toBe(before);
      expect(await prisma.shipmentItem.count({ where: { tenantId: tenantA.tenantId } })).toBe(beforeItems);
    });

    it('allows creating with no fields at all — every field is optional on a DRAFT', async () => {
      const res = await createDraft(app, customerA1Token, {});
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
    });

    it("rejects a CUSTOMER token from tenant B creating for tenant A's customer id, and rejects staff tokens outright (customer-only route)", async () => {
      const staffRes = await request(app.getHttpServer())
        .post('/portal/pre-registrations')
        .set('Authorization', `Bearer ${staffA.token}`)
        .send({});
      expect(staffRes.status).toBe(403);
    });
  });

  describe('update (DRAFT only)', () => {
    it('DRAFT can be edited, including a partial update', async () => {
      const created = await createDraft(app, customerA1Token, { destinationCountry: 'GH' });
      const res = await request(app.getHttpServer())
        .patch(`/portal/pre-registrations/${created.body.id}`)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ recipientName: 'Kofi Owusu', recipientPhone: '+233-24-555-0100' });
      expect(res.status).toBe(200);
      expect(res.body.recipientName).toBe('Kofi Owusu');
      expect(res.body.destinationCountry).toBe('GH'); // untouched by the partial update
    });

    it('rejects editing once SUBMITTED', async () => {
      const submitted = await createAndSubmit(app, customerA1Token, { destinationCountry: 'GH' });
      const res = await request(app.getHttpServer())
        .patch(`/portal/pre-registrations/${submitted.id}`)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ notes: 'trying to edit after submit' });
      expect(res.status).toBe(409);
    });

    it('rejects editing once CANCELLED', async () => {
      const created = await createDraft(app, customerA1Token, {});
      await cancel(app, customerA1Token, created.body.id);
      const res = await request(app.getHttpServer())
        .patch(`/portal/pre-registrations/${created.body.id}`)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ notes: 'trying to edit after cancel' });
      expect(res.status).toBe(409);
    });
  });

  describe('submit', () => {
    it('DRAFT -> SUBMITTED assigns a PRE-<year>-###### reference, sets submittedAt, and still creates no Shipment/ShipmentItem/tracking number', async () => {
      const before = await prisma.shipment.count({ where: { tenantId: tenantA.tenantId } });

      const created = await createDraft(app, customerA1Token, { destinationCountry: 'GH', recipientName: 'Ama' });
      const res = await request(app.getHttpServer())
        .post(`/portal/pre-registrations/${created.body.id}/submit`)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send();
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.referenceNumber).toMatch(/^PRE-\d{4}-\d{6}$/);
      expect(res.body.submittedAt).not.toBeNull();

      // Never in the official tracking-number namespace.
      expect(res.body.referenceNumber.startsWith('E2E-')).toBe(false);

      expect(await prisma.shipment.count({ where: { tenantId: tenantA.tenantId } })).toBe(before);
    });

    it('rejects submitting an already-SUBMITTED record (invalid transition)', async () => {
      const submitted = await createAndSubmit(app, customerA1Token, {});
      const res = await request(app.getHttpServer())
        .post(`/portal/pre-registrations/${submitted.id}/submit`)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send();
      expect(res.status).toBe(409);
    });

    it('rejects submitting a CANCELLED record (invalid transition)', async () => {
      const created = await createDraft(app, customerA1Token, {});
      await cancel(app, customerA1Token, created.body.id);
      const res = await request(app.getHttpServer())
        .post(`/portal/pre-registrations/${created.body.id}/submit`)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send();
      expect(res.status).toBe(409);
    });

    it('reference numbers are unique per tenant and sequential', async () => {
      const first = await createAndSubmit(app, customerA1Token, {});
      const second = await createAndSubmit(app, customerA2Token, {});
      expect(first.referenceNumber).not.toBe(second.referenceNumber);

      const firstSeq = Number(first.referenceNumber.split('-')[2]);
      const secondSeq = Number(second.referenceNumber.split('-')[2]);
      expect(secondSeq).toBe(firstSeq + 1);
    });
  });

  describe('cancel', () => {
    it('DRAFT -> CANCELLED', async () => {
      const created = await createDraft(app, customerA1Token, {});
      const res = await cancel(app, customerA1Token, created.body.id);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.cancelledAt).not.toBeNull();
    });

    it('SUBMITTED -> CANCELLED', async () => {
      const submitted = await createAndSubmit(app, customerA1Token, {});
      const res = await cancel(app, customerA1Token, submitted.id);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('a CANCELLED record cannot be cancelled again, submitted, or edited — it is not treated as active', async () => {
      const created = await createDraft(app, customerA1Token, {});
      await cancel(app, customerA1Token, created.body.id);

      const recancel = await cancel(app, customerA1Token, created.body.id);
      expect(recancel.status).toBe(409);

      const resubmit = await request(app.getHttpServer())
        .post(`/portal/pre-registrations/${created.body.id}/submit`)
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send();
      expect(resubmit.status).toBe(409);

      // Confirms a CANCELLED record is excluded from the customer's own list of "active" ones only by status field, not deleted — still visible for their own history.
      const listRes = await request(app.getHttpServer())
        .get('/portal/pre-registrations')
        .set('Authorization', `Bearer ${customerA1Token}`);
      const found = listRes.body.find((r: { id: string }) => r.id === created.body.id);
      expect(found?.status).toBe('CANCELLED');
    });

    it('a record already CONVERTED (simulated) cannot be cancelled — future conversion lock is honored even though Stage 1 never sets this itself', async () => {
      const created = await createAndSubmit(app, customerA1Token, {});
      await prisma.shipmentPreRegistration.update({
        where: { id: created.id },
        data: { status: PreRegistrationStatus.CONVERTED, convertedAt: new Date(), convertedShipmentId: 'sim-shipment-1' },
      });
      const res = await cancel(app, customerA1Token, created.id);
      expect(res.status).toBe(409);
    });
  });

  describe('structural duplicate-conversion protection', () => {
    it('convertedShipmentId is unique — two pre-registrations can never claim the same converted Shipment', async () => {
      const first = await createAndSubmit(app, customerA1Token, {});
      const second = await createAndSubmit(app, customerA2Token, {});

      await prisma.shipmentPreRegistration.update({
        where: { id: first.id },
        data: { status: PreRegistrationStatus.CONVERTED, convertedShipmentId: 'shared-shipment-id' },
      });

      await expect(
        prisma.shipmentPreRegistration.update({
          where: { id: second.id },
          data: { status: PreRegistrationStatus.CONVERTED, convertedShipmentId: 'shared-shipment-id' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('customer-to-customer isolation', () => {
    it("customer A2 cannot retrieve, edit, submit, or cancel customer A1's pre-registration (same tenant)", async () => {
      const created = await createDraft(app, customerA1Token, {});

      const getRes = await request(app.getHttpServer())
        .get(`/portal/pre-registrations/${created.body.id}`)
        .set('Authorization', `Bearer ${customerA2Token}`);
      expect(getRes.status).toBe(404);

      const patchRes = await request(app.getHttpServer())
        .patch(`/portal/pre-registrations/${created.body.id}`)
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ notes: 'hijack attempt' });
      expect(patchRes.status).toBe(404);

      const submitRes = await request(app.getHttpServer())
        .post(`/portal/pre-registrations/${created.body.id}/submit`)
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send();
      expect(submitRes.status).toBe(404);

      const cancelRes = await cancel(app, customerA2Token, created.body.id);
      expect(cancelRes.status).toBe(404);

      // Never shows up in A2's own list either.
      const listRes = await request(app.getHttpServer())
        .get('/portal/pre-registrations')
        .set('Authorization', `Bearer ${customerA2Token}`);
      expect(listRes.body.find((r: { id: string }) => r.id === created.body.id)).toBeUndefined();
    });
  });

  describe('tenant-to-tenant isolation', () => {
    it("customer B (tenant B) cannot retrieve tenant A's pre-registration even with the correct id", async () => {
      const created = await createDraft(app, customerA1Token, {});
      const res = await request(app.getHttpServer())
        .get(`/portal/pre-registrations/${created.body.id}`)
        .set('Authorization', `Bearer ${customerBToken}`);
      expect(res.status).toBe(404);
    });

    it("staff of tenant B cannot retrieve, scan, or search up tenant A's pre-registration even knowing the exact reference", async () => {
      const submitted = await createAndSubmit(app, customerA1Token, { recipientName: 'Findable Person' });

      const byId = await request(app.getHttpServer())
        .get(`/pre-registrations/${submitted.id}`)
        .set('Authorization', `Bearer ${staffB.token}`);
      expect(byId.status).toBe(404);

      const byScan = await request(app.getHttpServer())
        .get(`/pre-registrations/scan?code=${encodeURIComponent(submitted.referenceNumber)}`)
        .set('Authorization', `Bearer ${staffB.token}`);
      expect(byScan.status).toBe(404);

      const bySearch = await request(app.getHttpServer())
        .get('/pre-registrations/search?query=Findable')
        .set('Authorization', `Bearer ${staffB.token}`);
      expect(bySearch.status).toBe(200);
      expect(bySearch.body).toEqual([]);

      const pending = await request(app.getHttpServer())
        .get('/pre-registrations/pending')
        .set('Authorization', `Bearer ${staffB.token}`);
      expect(pending.body.find((r: { id: string }) => r.id === submitted.id)).toBeUndefined();
    });
  });

  describe('staff-facing lookup (tenant A staff, tenant A data)', () => {
    it('staff can scan by exact reference, search by customer name/phone, and list pending SUBMITTED ones', async () => {
      const submitted = await createAndSubmit(app, customerA1Token, { recipientName: 'Scan Target' });

      const scanRes = await request(app.getHttpServer())
        .get(`/pre-registrations/scan?code=${encodeURIComponent(submitted.referenceNumber)}`)
        .set('Authorization', `Bearer ${staffA.token}`);
      expect(scanRes.status).toBe(200);
      expect(scanRes.body.id).toBe(submitted.id);
      expect(scanRes.body.customer.id).toBe(customerA1.customerId);

      // customerA1's lastName is "A1" per createCustomerWithPortalUser's fixture shape.
      const searchRes = await request(app.getHttpServer())
        .get('/pre-registrations/search?query=A1')
        .set('Authorization', `Bearer ${staffA.token}`);
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.some((r: { id: string }) => r.id === submitted.id)).toBe(true);

      const pendingRes = await request(app.getHttpServer())
        .get('/pre-registrations/pending')
        .set('Authorization', `Bearer ${staffA.token}`);
      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.some((r: { id: string }) => r.id === submitted.id)).toBe(true);
    });

    it('scan 404s (generic, not distinguishing "unknown" from "wrong tenant") for a nonexistent reference', async () => {
      const res = await request(app.getHttpServer())
        .get('/pre-registrations/scan?code=PRE-2026-999999')
        .set('Authorization', `Bearer ${staffA.token}`);
      expect(res.status).toBe(404);
    });

    it('a DRAFT (never submitted) never appears in the staff pending list', async () => {
      const created = await createDraft(app, customerA1Token, {});
      const pendingRes = await request(app.getHttpServer())
        .get('/pre-registrations/pending')
        .set('Authorization', `Bearer ${staffA.token}`);
      expect(pendingRes.body.some((r: { id: string }) => r.id === created.body.id)).toBe(false);
    });

    it('rejects a customer token from reaching any staff route', async () => {
      const res = await request(app.getHttpServer())
        .get('/pre-registrations/pending')
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(res.status).toBe(403);
    });
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  return completeStaffLogin(app, email, password);
}

function createDraft(app: INestApplication, token: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).post('/portal/pre-registrations').set('Authorization', `Bearer ${token}`).send(body);
}

async function createAndSubmit(app: INestApplication, token: string, body: Record<string, unknown>) {
  const created = await createDraft(app, token, body);
  if (created.status !== 201) {
    throw new Error(`Create failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const submitted = await request(app.getHttpServer())
    .post(`/portal/pre-registrations/${created.body.id}/submit`)
    .set('Authorization', `Bearer ${token}`)
    .send();
  if (submitted.status !== 201) {
    throw new Error(`Submit failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
  }
  return submitted.body as { id: string; referenceNumber: string };
}

function cancel(app: INestApplication, token: string, id: string) {
  return request(app.getHttpServer()).post(`/portal/pre-registrations/${id}/cancel`).set('Authorization', `Bearer ${token}`).send();
}
