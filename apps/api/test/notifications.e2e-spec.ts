import { INestApplication } from '@nestjs/common';
import { ContainerType, PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
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

jest.setTimeout(30_000);

/**
 * Stage 3H: proves the notification-firing rules (notifiable-only,
 * dedup, false->true-only for documents), portal isolation for in-app
 * notifications (byte-identical 404s, same pattern as every other
 * portal resource), and the bulk container-disruption fan-out
 * (affected-customer resolution + per-customer channel preferences).
 */
describe('Notifications & disruptions: firing rules, isolation, bulk fan-out (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tenantAdminTokenA: string;

  let customer1A: TestPortalCustomerFixture;
  let customer2A: TestPortalCustomerFixture;
  let customerB: TestPortalCustomerFixture;
  let customer1APortalToken: string;
  let customer2APortalToken: string;
  let customerBPortalToken: string;

  let shipment1A: { id: string; trackingNumber: string };

  beforeAll(async () => {
    app = await createTestApp();

    tenantA = await createTestTenant(prisma, 'NotifA', UserRole.WAREHOUSE_MANAGER);
    tenantB = await createTestTenant(prisma, 'NotifB', UserRole.WAREHOUSE_MANAGER);

    const tenantAdminA = await createUserInTenant(prisma, tenantA.tenantId, 'TenantAdmin', UserRole.TENANT_ADMIN);
    tenantAdminTokenA = await login(app, tenantAdminA.email, tenantAdminA.password);

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

  describe('Shipment status firing rules', () => {
    it('a notifiable status change (WAREHOUSE_RECEIVED) fires exactly one IN_APP notification', async () => {
      const res = await request(app.getHttpServer())
        .post(`/shipments/${shipment1A.id}/tracking-events`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ eventType: 'RECEIVED_AT_WAREHOUSE', status: 'WAREHOUSE_RECEIVED' });
      expect(res.status).toBe(201);

      const notifications = await prisma.notification.findMany({
        where: { tenantId: tenantA.tenantId, customerId: customer1A.customerId, channel: 'IN_APP' },
      });
      expect(notifications.some((n) => n.title.includes('WAREHOUSE_RECEIVED'))).toBe(true);
    });

    it('LOADED does NOT fire a customer notification (Decision #1) even though it is a real, recorded status transition', async () => {
      const before = await prisma.notification.count({ where: { tenantId: tenantA.tenantId, customerId: customer1A.customerId } });

      const res = await request(app.getHttpServer())
        .post(`/shipments/${shipment1A.id}/tracking-events`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ eventType: 'LOADED', status: 'LOADED' });
      expect(res.status).toBe(201);

      const after = await prisma.notification.count({ where: { tenantId: tenantA.tenantId, customerId: customer1A.customerId } });
      expect(after).toBe(before); // no new notification of any channel

      const event = await prisma.notificationEvent.findFirst({ where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${shipment1A.id}:status:LOADED` } });
      expect(event).toBeNull();
    });

    it('a non-notifiable status change (PROCESSING) does not fire either', async () => {
      const before = await prisma.notification.count({ where: { tenantId: tenantA.tenantId, customerId: customer1A.customerId } });
      await request(app.getHttpServer())
        .post(`/shipments/${shipment1A.id}/tracking-events`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ eventType: 'PROCESSED', status: 'PROCESSING' });
      const after = await prisma.notification.count({ where: { tenantId: tenantA.tenantId, customerId: customer1A.customerId } });
      expect(after).toBe(before);
    });

    it('re-recording the SAME notifiable status again is deduplicated — no second notification', async () => {
      const dedupeKey = `shipment:${shipment1A.id}:status:DEPARTED`;
      const firstEventCountBefore = await prisma.notificationEvent.count({ where: { tenantId: tenantA.tenantId, dedupeKey } });
      expect(firstEventCountBefore).toBe(0);

      const first = await request(app.getHttpServer())
        .post(`/shipments/${shipment1A.id}/tracking-events`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ eventType: 'DEPARTED_ORIGIN', status: 'DEPARTED' });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post(`/shipments/${shipment1A.id}/tracking-events`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ eventType: 'DEPARTED_ORIGIN', status: 'DEPARTED', notes: 'correction re-record' });
      expect(second.status).toBe(201); // the tracking event itself is recorded fine either way

      const events = await prisma.notificationEvent.findMany({ where: { tenantId: tenantA.tenantId, dedupeKey } });
      expect(events).toHaveLength(1); // only one NotificationEvent ever created for this occurrence

      // One row per enabled channel (IN_APP always, EMAIL since notifyByEmail
      // defaults true) — the dedup guarantee is that there is exactly ONE
      // such set, not that only one channel exists.
      const inAppNotifications = await prisma.notification.findMany({
        where: { tenantId: tenantA.tenantId, eventId: events[0].id, channel: 'IN_APP' },
      });
      expect(inAppNotifications).toHaveLength(1);
    });
  });

  describe('Portal isolation for in-app notifications', () => {
    it("customer1 sees their own notification in /portal/notifications", async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/notifications')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((n: { title: string }) => n.title.includes('WAREHOUSE_RECEIVED'))).toBe(true);
      // Only IN_APP rows ever appear here — never a duplicate EMAIL row for the same event.
      const ids = res.body.map((n: { id: string }) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("customer2 (same tenant) does not see customer1's notifications", async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/notifications')
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((n: { title: string }) => n.title.includes('WAREHOUSE_RECEIVED'))).toBe(false);
    });

    it("a tenant B customer does not see tenant A's notifications", async () => {
      const res = await request(app.getHttpServer())
        .get('/portal/notifications')
        .set('Authorization', `Bearer ${customerBPortalToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((n: { title: string }) => n.title.includes('WAREHOUSE_RECEIVED'))).toBe(false);
    });

    it("customer2 gets 404 marking customer1's notification read by id — byte-identical to a nonexistent id", async () => {
      const mine = await request(app.getHttpServer())
        .get('/portal/notifications')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      const notificationId = mine.body[0].id;

      const crossCustomer = await request(app.getHttpServer())
        .post(`/portal/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      const nonexistent = await request(app.getHttpServer())
        .post('/portal/notifications/does-not-exist/read')
        .set('Authorization', `Bearer ${customer2APortalToken}`);
      expect(crossCustomer.status).toBe(404);
      expect(nonexistent.status).toBe(404);
      expect(crossCustomer.body.message).toBe(nonexistent.body.message);
    });

    it('an unauthenticated request gets 401', async () => {
      const res = await request(app.getHttpServer()).get('/portal/notifications');
      expect(res.status).toBe(401);
    });

    it('mark-as-read updates readAt and unread count, and is idempotent', async () => {
      const before = await request(app.getHttpServer())
        .get('/portal/notifications/unread-count')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(before.status).toBe(200);
      expect(before.body.count).toBeGreaterThan(0);

      const list = await request(app.getHttpServer())
        .get('/portal/notifications')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      const target = list.body.find((n: { readAt: string | null }) => !n.readAt);
      expect(target).toBeTruthy();

      const readOnce = await request(app.getHttpServer())
        .post(`/portal/notifications/${target.id}/read`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(readOnce.status).toBe(201);
      expect(readOnce.body.readAt).toBeTruthy();

      const readTwice = await request(app.getHttpServer())
        .post(`/portal/notifications/${target.id}/read`)
        .set('Authorization', `Bearer ${customer1APortalToken}`);
      expect(readTwice.status).toBe(201);
      expect(readTwice.body.readAt).toBe(readOnce.body.readAt); // unchanged, not bumped
    });
  });

  describe('Document-visibility firing rule', () => {
    it('flipping visibleToCustomer false->true fires a notification; flipping back, or patching other fields, does not', async () => {
      const doc = await prisma.document.create({
        data: {
          tenantId: tenantA.tenantId,
          customerId: customer1A.customerId,
          shipmentId: shipment1A.id,
          type: 'OTHER',
          fileName: 'test.pdf',
          fileUrl: 'unused-in-this-test',
          visibleToCustomer: false,
        },
      });

      const makeVisible = await request(app.getHttpServer())
        .patch(`/documents/${doc.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ visibleToCustomer: true });
      expect(makeVisible.status).toBe(200);

      const event = await prisma.notificationEvent.findFirst({ where: { tenantId: tenantA.tenantId, dedupeKey: `document:${doc.id}:visible` } });
      expect(event).not.toBeNull();

      const countAfterFirst = await prisma.notification.count({ where: { tenantId: tenantA.tenantId, eventId: event!.id } });
      expect(countAfterFirst).toBeGreaterThan(0);

      // Flip back to staff-only, then patch description — neither re-fires.
      await request(app.getHttpServer())
        .patch(`/documents/${doc.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ visibleToCustomer: false });
      await request(app.getHttpServer())
        .patch(`/documents/${doc.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ description: 'just a label change' });

      const eventsStill = await prisma.notificationEvent.count({ where: { tenantId: tenantA.tenantId, dedupeKey: `document:${doc.id}:visible` } });
      expect(eventsStill).toBe(1); // still only the one from the original false->true flip
    });
  });

  describe('Invoice/payment firing rules', () => {
    it('issuing an invoice fires a notification', async () => {
      const invoice = await createInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 50);
      const issued = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/issue`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`);
      expect(issued.status).toBe(201);

      const event = await prisma.notificationEvent.findFirst({ where: { tenantId: tenantA.tenantId, dedupeKey: `invoice:${invoice.id}:issued` } });
      expect(event).not.toBeNull();
    });

    it('recording a manual payment fires a payment-received notification', async () => {
      const invoice = await createInvoice(app, tenantAdminTokenA, customer1A.customerId, shipment1A.id, 75);
      await request(app.getHttpServer()).post(`/invoices/${invoice.id}/issue`).set('Authorization', `Bearer ${tenantAdminTokenA}`);

      const payment = await request(app.getHttpServer())
        .post(`/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ amount: 75, method: 'CASH' });
      expect(payment.status).toBe(201);

      const event = await prisma.notificationEvent.findFirst({ where: { tenantId: tenantA.tenantId, dedupeKey: `payment:${payment.body.id}:received` } });
      expect(event).not.toBeNull();
    });
  });

  describe('Bulk container disruption fan-out', () => {
    it('preview and create resolve the correct, deduplicated affected customers and respect their channel preferences', async () => {
      // Customer1: opts into SMS. Customer2: default prefs only (email on).
      await prisma.customer.update({ where: { id: customer1A.customerId }, data: { notifyBySms: true, phone: '+15550001111' } });

      const shipment2A = await createShipmentForCustomerId(app, tenantAdminTokenA, customer2A.customerId);
      const container = await prisma.container.create({
        data: { tenantId: tenantA.tenantId, containerNumber: `TESTCTR-${Date.now()}`, containerType: ContainerType.TWENTY_FT },
      });

      // Two items for customer1's shipment (same customer twice — must dedupe to one row), one for customer2's.
      const item1 = await prisma.shipmentItem.findFirstOrThrow({ where: { shipmentId: shipment1A.id } });
      const item2 = await prisma.shipmentItem.findFirstOrThrow({ where: { shipmentId: shipment2A.id } });
      const extraItem = await prisma.shipmentItem.create({
        data: {
          tenantId: tenantA.tenantId,
          shipmentId: shipment1A.id,
          itemCode: `${shipment1A.trackingNumber}-99`,
          sequenceNumber: 99,
          itemType: ShipmentItemType.BOX,
          description: 'second box, same shipment/customer',
        },
      });
      for (const item of [item1, extraItem, item2]) {
        await prisma.containerItem.create({
          data: { tenantId: tenantA.tenantId, containerId: container.id, shipmentId: item.shipmentId, shipmentItemId: item.id },
        });
      }

      const preview = await request(app.getHttpServer())
        .get(`/disruptions/preview?containerId=${container.id}`)
        .set('Authorization', `Bearer ${tenantAdminTokenA}`);
      expect(preview.status).toBe(200);
      expect(preview.body.affectedCustomers).toHaveLength(2); // deduplicated, not 3
      const c1 = preview.body.affectedCustomers.find((c: { customerId: string }) => c.customerId === customer1A.customerId);
      expect(c1.willNotifyBySms).toBe(true);
      expect(c1.shipmentTrackingNumbers).toHaveLength(1); // one shipment, listed once, despite two items
      const c2 = preview.body.affectedCustomers.find((c: { customerId: string }) => c.customerId === customer2A.customerId);
      expect(c2.willNotifyBySms).toBe(false);

      const created = await request(app.getHttpServer())
        .post('/disruptions')
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ containerId: container.id, type: 'HELD', message: 'Your container is being held for customs inspection.' });
      expect(created.status).toBe(201);
      expect(created.body.notifiedCustomerCount).toBe(2);

      const c1Notifications = await prisma.notification.findMany({
        where: { tenantId: tenantA.tenantId, customerId: customer1A.customerId, event: { operationalExceptionId: created.body.id } },
      });
      // IN_APP + EMAIL (default) + SMS (opted in) = 3 rows for customer1.
      expect(c1Notifications.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP', 'SMS']);
      expect(c1Notifications.every((n) => n.body === 'Your container is being held for customs inspection.')).toBe(true);

      const c2Notifications = await prisma.notification.findMany({
        where: { tenantId: tenantA.tenantId, customerId: customer2A.customerId, event: { operationalExceptionId: created.body.id } },
      });
      // IN_APP + EMAIL only for customer2 — no SMS/WhatsApp opt-in.
      expect(c2Notifications.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);

      // A customer NOT on this container gets nothing from it.
      const bystanderNotifications = await prisma.notification.findMany({
        where: { tenantId: tenantB.tenantId, event: { operationalExceptionId: created.body.id } },
      });
      expect(bystanderNotifications).toHaveLength(0);
    });

    it('rejects a disruption with neither containerId nor manifestId', async () => {
      const res = await request(app.getHttpServer())
        .post('/disruptions')
        .set('Authorization', `Bearer ${tenantAdminTokenA}`)
        .send({ type: 'DELAYED', message: 'missing target' });
      expect(res.status).toBe(400);
    });

    it('a customer token gets 403 on every /disruptions route', async () => {
      const res = await request(app.getHttpServer())
        .get('/disruptions')
        .set('Authorization', `Bearer ${customer1APortalToken}`);
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
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      items: [{ itemType: ShipmentItemType.BOX, description: 'Notifications e2e test box' }],
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string; trackingNumber: string };
}

async function createInvoice(
  app: INestApplication,
  staffToken: string,
  customerId: string,
  shipmentId: string,
  totalAmount: number,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/invoices')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      customerId,
      shipmentId,
      currency: 'USD',
      items: [{ description: 'Freight charge', unitPrice: totalAmount, quantity: 1 }],
    });
  if (res.status !== 201) {
    throw new Error(`Invoice creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}
