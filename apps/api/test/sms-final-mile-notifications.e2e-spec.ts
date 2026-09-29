import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, ShipmentItemType, ShipmentMode, TrackingEventType, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_PROVIDER } from '../src/notifications/providers/provider.types';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(60_000);

interface CapturedSmsSend {
  to: string;
  body: string;
}

/**
 * SMS/Twilio MVP — full pipeline integration test. Mocks SMS_PROVIDER (no
 * real Twilio call, no credentials needed) so these assertions are about
 * this app's own dispatch/normalization/scope-limiting logic, matching the
 * exact whatsapp-final-mile-notifications.e2e-spec.ts pattern for mocking
 * a provider token.
 *
 * Never asserts anything about the underlying shipment-status rollups
 * themselves (final-mile-notifications.e2e-spec.ts already covers that in
 * full) — this suite is specifically about the SMS channel layered on top
 * of the already-proven, unmodified email/IN_APP/WhatsApp dispatch.
 */
describe('SMS final-mile notifications (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const sent: CapturedSmsSend[] = [];
  let shouldFail = false;

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({
        send: async (params: CapturedSmsSend) => {
          sent.push(params);
          if (shouldFail) {
            return { success: false, errorMessage: 'Simulated provider failure' };
          }
          return { success: true, providerMessageId: 'SMtest123' };
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenantA = await createTestTenant(prisma, 'SmsFinalA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'SmsFinalB', UserRole.MANAGER);
    tokenA = await login(app, tenantA.user.email, tenantA.user.password);

    // Opt tenant A's default customer into SMS with a bare US local-format
    // number, proving the hardcoded 'US' normalization hint actually runs
    // end to end, not just in the pure phone-normalization unit test.
    await prisma.customer.update({
      where: { id: tenantA.customerId },
      data: { notifyBySms: true, smsConsentGiven: true, phone: '2147232121' },
    });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    sent.length = 0;
    shouldFail = false;
  });

  it('1. sends a real SMS for a supported milestone (WAREHOUSE_RECEIVED), normalizing the bare US local number to E.164', async () => {
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('+12147232121');

    const notificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: tenantA.customerId, channel: 'SMS' },
    });
    expect(notificationRow?.status).toBe('SENT');
    expect(notificationRow?.providerMessageId).toBe('SMtest123');
  });

  it('2. the SMS body is branded with the tenant name and contains the tracking number and a tracking link on that tenant\'s own domain, never Ananse', async () => {
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantA.tenantId }, select: { name: true, website: true } });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain(tenant.name);
    expect(sent[0].body).toContain(shipment.trackingNumber);
    expect(sent[0].body).not.toMatch(/Ananse/i);
    if (tenant.website) {
      expect(sent[0].body).toContain(new URL(tenant.website).host);
    }
  });

  it('3. a customer with no phone number on file gets a FAILED record, and does not block the shipment operation', async () => {
    const customer = await createCustomer(app, tokenA, 'No Number');
    await prisma.customer.update({ where: { id: customer.id }, data: { notifyBySms: true, smsConsentGiven: true, phone: null } });

    const shipment = await createSingleShipment(app, tokenA, customer.id, 1);
    const res = await receiveItemRaw(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    expect(res.status).toBe(201); // the actual warehouse operation still succeeds

    const notificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'SMS' },
    });
    expect(notificationRow?.status).toBe('FAILED');
    expect(notificationRow?.errorMessage).toMatch(/no sms address on file/i);
    expect(sent).toHaveLength(0);
  });

  it('4. an invalid/unparseable phone number gets a FAILED record with a clear reason, and does not block the shipment operation', async () => {
    const customer = await createCustomer(app, tokenA, 'Bad Number');
    await prisma.customer.update({ where: { id: customer.id }, data: { notifyBySms: true, smsConsentGiven: true, phone: 'not-a-real-number' } });

    const shipment = await createSingleShipment(app, tokenA, customer.id, 1);
    const res = await receiveItemRaw(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    expect(res.status).toBe(201);

    const notificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'SMS' },
    });
    expect(notificationRow?.status).toBe('FAILED');
    expect(notificationRow?.errorMessage).toMatch(/not a valid phone number/i);
    expect(sent).toHaveLength(0); // never reached the provider at all
  });

  it('5. a customer not opted into SMS (notifyBySms=false, the default) never gets an SMS attempt at all', async () => {
    const customer = await createCustomer(app, tokenA, 'Opted Out');
    await prisma.customer.update({ where: { id: customer.id }, data: { notifyBySms: false, phone: '2147232121' } });

    const shipment = await createSingleShipment(app, tokenA, customer.id, 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    expect(sent).toHaveLength(0);
    const notificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'SMS' },
    });
    expect(notificationRow).toBeNull();

    // Email for the same occurrence is completely unaffected by the SMS opt-out.
    const emailRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'EMAIL' },
    });
    expect(emailRow?.status).toBe('SENT');
  });

  it('5b. SMS/Twilio A2P Phase 2: notifyBySms=true alone (no smsConsentGiven) never gets an SMS attempt — the exact gap this phase closes', async () => {
    const customer = await createCustomer(app, tokenA, 'No Consent');
    // Simulates a legacy/pre-Phase-1 row, or a portal toggle that never
    // went through a real consent flow — notifyBySms true, consent absent.
    await prisma.customer.update({ where: { id: customer.id }, data: { notifyBySms: true, smsConsentGiven: false, phone: '2147232121' } });

    const shipment = await createSingleShipment(app, tokenA, customer.id, 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    expect(sent).toHaveLength(0); // never reached the provider
    const notificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'SMS' },
    });
    expect(notificationRow).toBeNull(); // no row at all, same shape as "never opted in"

    // Email for the same occurrence is completely unaffected.
    const emailRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'EMAIL' },
    });
    expect(emailRow?.status).toBe('SENT');
  });

  it('5c. SMS/Twilio A2P Phase 2: a phone on the global SmsOptOut list never gets an SMS attempt, even with full consent', async () => {
    const customer = await createCustomer(app, tokenA, 'Opted Out Via Stop');
    const phoneE164 = '+12147232121';
    await prisma.customer.update({ where: { id: customer.id }, data: { notifyBySms: true, smsConsentGiven: true, phone: '2147232121' } });
    await prisma.smsOptOut.create({ data: { phoneE164, source: 'test_fixture' } });

    try {
      const shipment = await createSingleShipment(app, tokenA, customer.id, 1);
      await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

      expect(sent).toHaveLength(0);
      const notificationRow = await prisma.notification.findFirst({
        where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'SMS' },
      });
      expect(notificationRow).toBeNull();

      const emailRow = await prisma.notification.findFirst({
        where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'EMAIL' },
      });
      expect(emailRow?.status).toBe('SENT'); // email is completely unaffected by the SMS-only opt-out
    } finally {
      await prisma.smsOptOut.delete({ where: { phoneE164 } });
    }
  });

  it('6. a provider-level failure is recorded as FAILED, and does not block the shipment operation or affect email', async () => {
    shouldFail = true;
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
    const res = await receiveItemRaw(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    expect(res.status).toBe(201);

    const smsRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: tenantA.customerId, channel: 'SMS' },
      orderBy: { createdAt: 'desc' },
    });
    expect(smsRow?.status).toBe('FAILED');
    expect(smsRow?.errorMessage).toBe('Simulated provider failure');

    const emailRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: tenantA.customerId, channel: 'EMAIL', eventId: smsRow?.eventId },
    });
    expect(emailRow?.status).toBe('SENT');
  });

  it('7. a non-shipment-status event (document visible) never attempts SMS, even for an opted-in customer with a valid number', async () => {
    const doc = await prisma.document.create({
      data: {
        tenantId: tenantA.tenantId,
        customerId: tenantA.customerId,
        type: 'OTHER',
        fileName: 'test.pdf',
        fileUrl: 'unused-in-this-test',
        visibleToCustomer: false,
      },
    });
    sent.length = 0;

    const res = await request(app.getHttpServer())
      .patch(`/documents/${doc.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ visibleToCustomer: true });
    expect(res.status).toBe(200);

    expect(sent).toHaveLength(0);
  });

  it('8. tenant isolation: tenant B customers never receive an SMS triggered by tenant A activity', async () => {
    await prisma.customer.update({
      where: { id: tenantB.customerId },
      data: { notifyBySms: true, smsConsentGiven: true, phone: '2147232121' },
    });
    sent.length = 0;

    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    expect(sent).toHaveLength(1);
    const tenantBRows = await prisma.notification.findMany({ where: { tenantId: tenantB.tenantId, channel: 'SMS' } });
    expect(tenantBRows).toHaveLength(0);
  });

  it('9. a duplicate attempt to fire the same status for the same shipment sends the SMS exactly once (dedupe)', async () => {
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    sent.length = 0;

    // Manually re-fire DEPARTED twice for the same shipment via the
    // generic tracking-event endpoint — the second call must hit the
    // existing NotificationEvent dedupe (tenantId+dedupeKey unique
    // constraint), never a second SMS.
    await postTrackingEvent(app, tokenA, shipment.id, 'DEPARTED');
    await postTrackingEvent(app, tokenA, shipment.id, 'DEPARTED');

    expect(sent).toHaveLength(1);
    const departedRows = await prisma.notificationEvent.findMany({
      where: { tenantId: tenantA.tenantId, dedupeKey: `shipment:${shipment.id}:status:DEPARTED` },
    });
    expect(departedRows).toHaveLength(1);
  });

  it('10. excluded statuses (PROCESSING) never produce an SMS, only the 5 allowed milestones do', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
    // WAREHOUSE_RECEIVED, DEPARTED, ARRIVED_DESTINATION already fired
    // inside createArrivedOceanManifest (receive+process+load+depart+arrive).
    // PROCESSING itself must never have produced an SMS.
    const processingRows = await prisma.notification.findMany({
      where: { tenantId: tenantA.tenantId, channel: 'SMS', event: { dedupeKey: { contains: ':status:PROCESSING' } } },
    });
    expect(processingRows).toHaveLength(0);

    // Exactly the 3 milestones this pipeline crosses (WAREHOUSE_RECEIVED,
    // DEPARTED, ARRIVED_DESTINATION) — scoped to this shipment's own
    // events, not a tenant-wide count (other tests share this tenant fixture).
    const smsRowsForThisShipment = await prisma.notification.count({
      where: { tenantId: tenantA.tenantId, channel: 'SMS', event: { shipmentId: manifest.shipmentId } },
    });
    expect(smsRowsForThisShipment).toBe(3);
    expect(sent).toHaveLength(3);

    // Continue this same shipment all the way through the delivery path to
    // prove READY_FOR_PICKUP/DELIVERED both text, and COMPLETED (which
    // immediately follows DELIVERED for the same real-world event) is
    // suppressed — exactly one final "your shipment is done" SMS.
    sent.length = 0;
    await destinationReceiveOnce(app, tokenA, manifest.itemId, tenantA.warehouseId);
    await dispatch(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Home Delivery Recipient' });
    await deliver(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Home Delivery Recipient' });

    const readySms = sent.filter((s) => s.body.includes('ready for pickup'));
    const deliveredSms = sent.filter((s) => s.body.includes('delivered'));
    const pickedUpSms = sent.filter((s) => s.body.includes('picked up'));
    expect(readySms).toHaveLength(1);
    expect(deliveredSms).toHaveLength(1);
    expect(pickedUpSms).toHaveLength(0); // COMPLETED text suppressed — DELIVERED already covered this event

    const completedNotificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, channel: 'SMS', event: { dedupeKey: `shipment:${manifest.shipmentId}:status:COMPLETED` } },
    });
    expect(completedNotificationRow).toBeNull(); // suppressed occurrence creates no Notification row at all
  });

  it('11. a pure walk-in pickup (no prior DELIVERED) DOES send a "picked up" SMS for COMPLETED', async () => {
    const manifest = await createArrivedOceanManifest(app, tokenA, tenantA, 1);
    sent.length = 0;

    await destinationReceiveOnce(app, tokenA, manifest.itemId, tenantA.warehouseId);
    await pickup(app, tokenA, manifest.itemId, tenantA.warehouseId, { recipientName: 'Walk-in Recipient' });

    const pickedUpSms = sent.filter((s) => s.body.includes('picked up'));
    expect(pickedUpSms).toHaveLength(1);
  });
});

/**
 * SMS/Twilio MVP — no provider override: proves that when SMS_PROVIDER is
 * left unset (the real production default), the app resolves the console
 * provider automatically and a shipment operation for an opted-in
 * customer completes normally with a simulated SENT record — i.e. SMS
 * being "off" (no real vendor configured) is a safe no-op, never a
 * startup failure or a broken shipment operation.
 */
describe('SMS provider defaults to console when SMS_PROVIDER is unset (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tenant: TestTenantFixture;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'SmsConsoleDefault', UserRole.MANAGER);
    token = await login(app, tenant.user.email, tenant.user.password);
    await prisma.customer.update({ where: { id: tenant.customerId }, data: { notifyBySms: true, smsConsentGiven: true, phone: '2147232121' } });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  });

  it('12. with no SMS_PROVIDER configured, the shipment operation succeeds and the SMS attempt is simulated/SENT, not FAILED or thrown', async () => {
    const shipment = await createSingleShipment(app, token, tenant.customerId, 1);
    const res = await receiveItemRaw(app, token, shipment.items[0].id, tenant.warehouseId);
    expect(res.status).toBe(201);

    const smsRow = await prisma.notification.findFirst({ where: { tenantId: tenant.tenantId, channel: 'SMS' } });
    expect(smsRow?.status).toBe('SENT');
    expect(smsRow?.providerMessageId).toMatch(/^console-sms-/);
  });
});

// ---------------------------------------------------------------------------
// helpers — deliberately local/duplicated, matching this suite's existing
// per-file-helpers convention (see whatsapp-final-mile-notifications.e2e-spec.ts
// and final-mile-notifications.e2e-spec.ts, which these are copied from).
// ---------------------------------------------------------------------------

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function createCustomer(app: INestApplication, token: string, label: string): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/customers')
    .set('Authorization', `Bearer ${token}`)
    .send({ firstName: 'E2E', lastName: label, email: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@example.test` });
  if (res.status !== 201) {
    throw new Error(`Customer creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function createSingleShipment(
  app: INestApplication,
  token: string,
  customerId: string,
  itemCount: number,
): Promise<{ id: string; trackingNumber: string; items: { id: string; itemCode: string }[] }> {
  const res = await request(app.getHttpServer())
    .post('/shipments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      recipientName: 'Test Recipient',
      recipientPhone: '+15550000000',
      items: Array.from({ length: itemCount }, () => ({ itemType: ShipmentItemType.BOX, description: 'E2E SMS test box' })),
    });
  if (res.status !== 201) {
    throw new Error(`Shipment creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function receiveItemRaw(app: INestApplication, token: string, itemId: string, warehouseId: string) {
  return request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false });
}

async function receiveItem(app: INestApplication, token: string, itemId: string, warehouseId: string): Promise<void> {
  const res = await receiveItemRaw(app, token, itemId, warehouseId);
  if (res.status !== 201) {
    throw new Error(`Receive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function processOnce(app: INestApplication, token: string, itemId: string, warehouseId: string) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/process`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, condition: 'GOOD', result: 'READY', scanned: false });
  if (res.status !== 201) {
    throw new Error(`Process failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function destinationReceiveOnce(app: INestApplication, token: string, itemId: string, warehouseId: string) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/destination-receive`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, condition: 'GOOD', scanned: false });
  if (res.status !== 201) {
    throw new Error(`Destination-receive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function pickup(app: INestApplication, token: string, itemId: string, warehouseId: string, opts: { recipientName: string }) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/pickup`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
  if (res.status !== 201) {
    throw new Error(`Pickup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function dispatch(app: INestApplication, token: string, itemId: string, warehouseId: string, opts: { recipientName: string; courierName?: string }) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/dispatch`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, courierName: 'E2E Courier', ...opts });
  if (res.status !== 201) {
    throw new Error(`Dispatch failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function deliver(app: INestApplication, token: string, itemId: string, warehouseId: string, opts: { recipientName: string }) {
  const res = await request(app.getHttpServer())
    .post(`/warehouse/items/${itemId}/deliver`)
    .set('Authorization', `Bearer ${token}`)
    .send({ warehouseId, scanned: false, ...opts });
  if (res.status !== 201) {
    throw new Error(`Deliver failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function postTrackingEvent(app: INestApplication, token: string, shipmentId: string, status: string) {
  const res = await request(app.getHttpServer())
    .post(`/shipments/${shipmentId}/tracking-events`)
    .set('Authorization', `Bearer ${token}`)
    .send({ eventType: TrackingEventType.DEPARTED_ORIGIN, status });
  if (res.status !== 201) {
    throw new Error(`Tracking event failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function createManifest(app: INestApplication, token: string, body: Record<string, unknown>): Promise<{ id: string; manifestNumber: string }> {
  const res = await request(app.getHttpServer()).post('/manifests').set('Authorization', `Bearer ${token}`).send(body);
  if (res.status !== 201) {
    throw new Error(`Manifest creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function finalizeManifest(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer()).post(`/manifests/${manifestId}/finalize`).set('Authorization', `Bearer ${token}`).send();
  if (res.status !== 201) {
    throw new Error(`Finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function departManifest(app: INestApplication, token: string, manifestId: string) {
  const res = await request(app.getHttpServer()).post(`/manifests/${manifestId}/depart`).set('Authorization', `Bearer ${token}`).send();
  if (res.status !== 201) {
    throw new Error(`Depart failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function assignContainer(app: INestApplication, token: string, manifestId: string, containerId: string) {
  const res = await request(app.getHttpServer())
    .post(`/manifests/${manifestId}/containers/${containerId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (res.status !== 201) {
    throw new Error(`Assign container failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function createContainer(app: INestApplication, token: string, opts: { warehouseId?: string }) {
  const res = await request(app.getHttpServer())
    .post('/containers')
    .set('Authorization', `Bearer ${token}`)
    .send({ containerNumber: `E2E-SMS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, containerType: 'TWENTY_FT', ...opts });
  if (res.status !== 201) {
    throw new Error(`Container creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string };
}

/** Full pipeline to WAREHOUSE_RECEIVED -> DEPARTED -> ARRIVED_DESTINATION, copied unchanged (aside from the container-number prefix) from final-mile-notifications.e2e-spec.ts's own helper of this name. */
async function createArrivedOceanManifest(
  app: INestApplication,
  token: string,
  tenant: TestTenantFixture,
  itemCount: number,
): Promise<{ manifestId: string; containerId: string; itemId: string; itemIds: string[]; shipmentId: string }> {
  const container = await createContainer(app, token, { warehouseId: tenant.warehouseId });
  const shipment = await createSingleShipment(app, token, tenant.customerId, itemCount);
  for (const item of shipment.items) {
    await receiveItem(app, token, item.id, tenant.warehouseId);
    await processOnce(app, token, item.id, tenant.warehouseId);
    const loadRes = await request(app.getHttpServer())
      .post(`/containers/${container.id}/items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scanned: false });
    if (loadRes.status !== 201) {
      throw new Error(`Load into container failed: ${loadRes.status} ${JSON.stringify(loadRes.body)}`);
    }
  }
  const finalizeContainerRes = await request(app.getHttpServer())
    .post(`/containers/${container.id}/finalize`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (finalizeContainerRes.status !== 201) {
    throw new Error(`Finalize container failed: ${finalizeContainerRes.status} ${JSON.stringify(finalizeContainerRes.body)}`);
  }

  const manifest = await createManifest(app, token, {
    shipmentMode: 'OCEAN_FCL',
    originWarehouseId: tenant.warehouseId,
    originLocation: 'Origin Test Warehouse',
    destinationLocation: 'Destination Test Warehouse',
    carrierName: 'Test Carrier',
    vesselName: 'Test Vessel',
    voyageNumber: `V-${Date.now()}`,
  });
  await assignContainer(app, token, manifest.id, container.id);
  await finalizeManifest(app, token, manifest.id);
  await departManifest(app, token, manifest.id);

  const arriveRes = await request(app.getHttpServer()).post(`/manifests/${manifest.id}/arrive`).set('Authorization', `Bearer ${token}`).send();
  if (arriveRes.status !== 201) {
    throw new Error(`Arrive failed: ${arriveRes.status} ${JSON.stringify(arriveRes.body)}`);
  }

  return {
    manifestId: manifest.id,
    containerId: container.id,
    itemId: shipment.items[0].id,
    itemIds: shipment.items.map((item) => item.id),
    shipmentId: shipment.id,
  };
}
