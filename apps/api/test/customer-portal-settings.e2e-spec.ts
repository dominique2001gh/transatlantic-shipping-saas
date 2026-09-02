import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import {
  createCustomerWithPortalUser,
  createTestTenant,
  deleteTestTenant,
  TEST_PASSWORD,
  TestPortalCustomerFixture,
  TestTenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

/**
 * Stage 3I: Customer Profile, Notification Preferences, and Password
 * Change.
 *
 * Proves, on top of the isolation guarantees customer-portal-isolation.
 * e2e-spec.ts already covers for the Stage 2C/3E-3H routes:
 *   - a customer can edit only the safe subset of their own profile
 *     (firstName/lastName/phone) — email/customerNumber are rejected
 *     outright by the global whitelist, not silently ignored;
 *   - notification-preference writes are the same columns
 *     NotificationsService.notifyCustomer already reads, take effect on
 *     the next notification fired, and never retroactively touch a
 *     Notification row already written;
 *   - password change requires the correct current password, is scoped
 *     to the caller's own User account, and never echoes a hash back;
 *   - every one of these routes is unreachable by a staff token or an
 *     unauthenticated request, exactly like every other /portal/* route.
 */
describe('Customer Portal: profile, notification preferences, password (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let staffTokenA: string;

  let customerA1: TestPortalCustomerFixture;
  let customerA2: TestPortalCustomerFixture;
  let customerB1: TestPortalCustomerFixture;

  let customerA1Token: string;
  let customerA2Token: string;
  let customerB1Token: string;

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'SettA', UserRole.TENANT_ADMIN);
    tenantB = await createTestTenant(prisma, 'SettB', UserRole.TENANT_ADMIN);
    staffTokenA = await login(app, tenantA.user.email, tenantA.user.password);

    customerA1 = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'S1');
    customerA2 = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'S2');
    customerB1 = await createCustomerWithPortalUser(prisma, tenantB.tenantId, 'SB');

    customerA1Token = await login(app, customerA1.user.email, customerA1.user.password);
    customerA2Token = await login(app, customerA2.user.email, customerA2.user.password);
    customerB1Token = await login(app, customerB1.user.email, customerB1.user.password);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  }, 30_000);

  // -------------------------------------------------------------------
  // PROFILE
  // -------------------------------------------------------------------
  describe('PATCH /portal/me — profile', () => {
    it('unauthenticated request gets 401', async () => {
      const res = await request(app.getHttpServer()).patch('/portal/me').send({ firstName: 'X' });
      expect(res.status).toBe(401);
    });

    it('a staff token gets 403', async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me')
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send({ firstName: 'X' });
      expect(res.status).toBe(403);
    });

    it('customer can update firstName/lastName/phone on their own profile', async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me')
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ firstName: 'Updated', lastName: 'Name', phone: '+15551234567' });
      expect(res.status).toBe(200);
      expect(res.body.firstName).toBe('Updated');
      expect(res.body.lastName).toBe('Name');
      expect(res.body.phone).toBe('+15551234567');
      expect(res.body.customerNumber).toBeTruthy(); // returned, but never was writable

      const persisted = await prisma.customer.findUnique({ where: { id: customerA1.customerId } });
      expect(persisted?.firstName).toBe('Updated');
      expect(persisted?.phone).toBe('+15551234567');
    });

    it('email is not a whitelisted field — a request that includes it is rejected outright (400), not silently ignored', async () => {
      const before = await prisma.customer.findUnique({ where: { id: customerA1.customerId } });
      const res = await request(app.getHttpServer())
        .patch('/portal/me')
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ email: 'attacker-controlled@example.test' });
      expect(res.status).toBe(400);

      const after = await prisma.customer.findUnique({ where: { id: customerA1.customerId } });
      expect(after?.email).toBe(before?.email); // untouched
    });

    it('customerNumber in the body is also rejected outright (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me')
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ customerNumber: 'HACKED-0001' });
      expect(res.status).toBe(400);
    });

    it("customer A2's update never touches customer A1's row — no :id on this route to tamper with", async () => {
      const a1Before = await prisma.customer.findUnique({ where: { id: customerA1.customerId } });

      const res = await request(app.getHttpServer())
        .patch('/portal/me')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ firstName: 'A2Only' });
      expect(res.status).toBe(200);
      expect(res.body.firstName).toBe('A2Only');

      const a1After = await prisma.customer.findUnique({ where: { id: customerA1.customerId } });
      expect(a1After?.firstName).toBe(a1Before?.firstName); // unaffected by A2's update

      const a2 = await prisma.customer.findUnique({ where: { id: customerA2.customerId } });
      expect(a2?.firstName).toBe('A2Only');
    });

    it("a tenant B customer's update never touches tenant A's data", async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me')
        .set('Authorization', `Bearer ${customerB1Token}`)
        .send({ firstName: 'TenantBOnly' });
      expect(res.status).toBe(200);

      const crossTenantLeak = await prisma.customer.findFirst({
        where: { tenantId: tenantA.tenantId, firstName: 'TenantBOnly' },
      });
      expect(crossTenantLeak).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // NOTIFICATION PREFERENCES
  // -------------------------------------------------------------------
  describe('GET/PATCH /portal/me/notification-preferences', () => {
    it('unauthenticated and staff-token requests are rejected (401/403)', async () => {
      const noAuth = await request(app.getHttpServer()).get('/portal/me/notification-preferences');
      expect(noAuth.status).toBe(401);

      const staff = await request(app.getHttpServer())
        .get('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${staffTokenA}`);
      expect(staff.status).toBe(403);
    });

    it('GET returns the Stage 3H defaults: email on, SMS/WhatsApp off, no WhatsApp number', async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA2Token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        notifyByEmail: true,
        notifyBySms: false,
        notifyByWhatsapp: false,
        whatsappPhone: null,
      });
    });

    it('rejects enabling WhatsApp with no number on file (400) and does not change any state', async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ notifyByWhatsapp: true });
      expect(res.status).toBe(400);

      const persisted = await prisma.customer.findUnique({ where: { id: customerA2.customerId } });
      expect(persisted?.notifyByWhatsapp).toBe(false);
    });

    it('rejects a malformed WhatsApp number (not E.164)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ notifyByWhatsapp: true, whatsappPhone: '0201234567' }); // missing leading +country code
      expect(res.status).toBe(400);
    });

    it('enabling WhatsApp together with a valid number in the same request succeeds', async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ notifyByWhatsapp: true, whatsappPhone: '+233201234567' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        notifyByEmail: true,
        notifyBySms: false,
        notifyByWhatsapp: true,
        whatsappPhone: '+233201234567',
      });
    });

    it('a later request toggling only notifyByWhatsapp off/on again is validated against the already-on-file number, not the new request alone', async () => {
      const off = await request(app.getHttpServer())
        .patch('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ notifyByWhatsapp: false });
      expect(off.status).toBe(200);
      expect(off.body.whatsappPhone).toBe('+233201234567'); // number is preserved, only the toggle changed

      const backOn = await request(app.getHttpServer())
        .patch('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ notifyByWhatsapp: true }); // no whatsappPhone in this request
      expect(backOn.status).toBe(200); // succeeds because a number is already on file
      expect(backOn.body.whatsappPhone).toBe('+233201234567');
    });

    it('rejects clearing the number while WhatsApp is still enabled', async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ whatsappPhone: null });
      expect(res.status).toBe(400);
    });

    it('toggling SMS on/off persists independently of email/WhatsApp state', async () => {
      const res = await request(app.getHttpServer())
        .patch('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ notifyBySms: true });
      expect(res.status).toBe(200);
      expect(res.body.notifyBySms).toBe(true);
      expect(res.body.notifyByEmail).toBe(true); // untouched
      expect(res.body.notifyByWhatsapp).toBe(true); // untouched
    });

    it("customer A1's preferences are never affected by A2's updates above", async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        notifyByEmail: true,
        notifyBySms: false,
        notifyByWhatsapp: false,
        whatsappPhone: null,
      });
    });
  });

  describe('Notification preferences integrate with Stage 3H dispatch without retroactively changing history', () => {
    it('a preference change takes effect on the next notification only — prior Notification rows are never rewritten', async () => {
      // Fresh customer for a clean notification history.
      const customer = await createCustomerWithPortalUser(prisma, tenantA.tenantId, 'NotifInteg');
      const token = await login(app, customer.user.email, customer.user.password);

      const shipment = await createShipmentForCustomerId(app, staffTokenA, customer.customerId);

      // 1) Default prefs (email on, sms off) — a notifiable status change fires IN_APP + EMAIL only.
      await request(app.getHttpServer())
        .post(`/shipments/${shipment.id}/tracking-events`)
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send({ eventType: 'RECEIVED_AT_WAREHOUSE', status: 'WAREHOUSE_RECEIVED' });

      const firstEvent = await prisma.notificationEvent.findFirst({
        where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${shipment.id}:status:WAREHOUSE_RECEIVED` },
      });
      expect(firstEvent).not.toBeNull();
      const firstBatchBefore = await prisma.notification.findMany({ where: { eventId: firstEvent!.id } });
      expect(firstBatchBefore.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);

      // 2) Customer opts into SMS *after* that notification was already sent.
      const prefUpdate = await request(app.getHttpServer())
        .patch('/portal/me/notification-preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ notifyBySms: true, whatsappPhone: null });
      expect(prefUpdate.status).toBe(200);
      await prisma.customer.update({ where: { id: customer.customerId }, data: { phone: '+15559998888' } });

      // 3) The EARLIER notification batch must be completely unchanged — no retroactive SMS row added to it.
      const firstBatchAfter = await prisma.notification.findMany({ where: { eventId: firstEvent!.id } });
      expect(firstBatchAfter).toHaveLength(firstBatchBefore.length);
      expect(firstBatchAfter.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);

      // 4) A NEW notifiable event fires with the UPDATED preferences — now includes SMS.
      await request(app.getHttpServer())
        .post(`/shipments/${shipment.id}/tracking-events`)
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send({ eventType: 'READY_FOR_PICKUP', status: 'READY_FOR_PICKUP' });

      const secondEvent = await prisma.notificationEvent.findFirst({
        where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${shipment.id}:status:READY_FOR_PICKUP` },
      });
      expect(secondEvent).not.toBeNull();
      const secondBatch = await prisma.notification.findMany({ where: { eventId: secondEvent!.id } });
      expect(secondBatch.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP', 'SMS']);

      // 5) IN_APP history is never suppressed by an external-channel opt-out — both events still show up in the portal list regardless of SMS/email outcomes.
      const portalList = await request(app.getHttpServer())
        .get('/portal/notifications')
        .set('Authorization', `Bearer ${token}`);
      expect(portalList.status).toBe(200);
      const titles = portalList.body.map((n: { title: string }) => n.title);
      expect(titles.some((t: string) => t.includes('WAREHOUSE_RECEIVED'))).toBe(true);
      expect(titles.some((t: string) => t.includes('READY_FOR_PICKUP'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // PASSWORD CHANGE
  // -------------------------------------------------------------------
  describe('PATCH /users/me/password', () => {
    it('unauthenticated request gets 401', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPassw0rd!' });
      expect(res.status).toBe(401);
    });

    it('rejects the wrong current password (400 — the session itself is still valid, only the submitted value is wrong) and leaves the account able to log in with the old one', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ currentPassword: 'TotallyWrongPassword!', newPassword: 'NewPassw0rd!' });
      expect(res.status).toBe(400); // not 401 — see AuthService.changePassword's own doc comment for why

      // The same (still-valid) token must still work for a normal request
      // right after this rejection — proves the session itself was never
      // invalidated by a wrong current-password attempt.
      const stillAuthenticated = await request(app.getHttpServer())
        .get('/portal/me')
        .set('Authorization', `Bearer ${customerA1Token}`);
      expect(stillAuthenticated.status).toBe(200);

      const stillWorks = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: customerA1.user.email, password: customerA1.user.password });
      expect(stillWorks.status).toBe(200);
    });

    it('rejects a new password identical to the current one (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ currentPassword: customerA1.user.password, newPassword: customerA1.user.password });
      expect(res.status).toBe(400);
    });

    it('rejects a new password shorter than 8 characters (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ currentPassword: customerA1.user.password, newPassword: 'short' });
      expect(res.status).toBe(400);
    });

    it('a correct current password + valid new password succeeds, never echoes a hash, and the new password logs in while the old one no longer does', async () => {
      const newPassword = 'BrandNewPassw0rd!';
      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${customerA1Token}`)
        .send({ currentPassword: customerA1.user.password, newPassword });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/); // no bcrypt hash shape anywhere in the response

      const oldLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: customerA1.user.email, password: customerA1.user.password });
      expect(oldLogin.status).toBe(401);

      const newLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: customerA1.user.email, password: newPassword });
      expect(newLogin.status).toBe(200);

      customerA1.user.password = newPassword; // keep the fixture's record accurate for anything running after this in the same file
      customerA1Token = newLogin.body.accessToken;
    });

    it('is role-agnostic — a staff user can change their own password the same way', async () => {
      const newPassword = 'StaffNewPassw0rd!';
      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${staffTokenA}`)
        .send({ currentPassword: tenantA.user.password, newPassword });
      expect(res.status).toBe(200);

      const newLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: tenantA.user.email, password: newPassword });
      expect(newLogin.status).toBe(200);

      tenantA.user.password = newPassword;
      staffTokenA = newLogin.body.accessToken;
    });

    it("changing customer A2's password never affects customer A1's credentials", async () => {
      const a2NewPassword = 'A2OnlyPassw0rd!';
      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${customerA2Token}`)
        .send({ currentPassword: customerA2.user.password, newPassword: a2NewPassword });
      expect(res.status).toBe(200);

      // A1's (already-rotated, see above) password still logs in — proves A2's
      // password change was scoped to A2's own User row only.
      const a1StillWorks = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: customerA1.user.email, password: customerA1.user.password });
      expect(a1StillWorks.status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention (see notifications.e2e-spec.ts).
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
): Promise<{ id: string; trackingNumber: string }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentMode: 'OCEAN_LCL',
      originCountry: 'US',
      destinationCountry: 'GH',
      items: [{ itemType: 'BOX', description: 'Settings e2e test box' }],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string; trackingNumber: string };
}
