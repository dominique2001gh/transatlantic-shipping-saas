import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

jest.setTimeout(30_000);

const TEST_VERIFY_TOKEN = 'e2e-test-verify-token';

/**
 * WhatsApp Integration (Stage 4C) Phase 2 — full pipeline integration
 * test against the real app/DB (createTestApp(), same as every other
 * suite). WHATSAPP_WEBHOOK_VERIFY_TOKEN is set on process.env before the
 * app boots (Nest's ConfigModule.forRoot() resolves it at that point) so
 * the GET-verification success path is actually exercised, not just its
 * failure modes — restored in afterAll so it never leaks into another
 * test file run in the same process.
 *
 * META_APP_SECRET is deliberately left unset here — signature
 * verification itself is already fully covered in isolation by
 * whatsapp-webhook-signature.e2e-spec.ts (correct/wrong-secret/tampered/
 * malformed cases); this suite exercises exactly the "not configured yet"
 * path the real local/CI environment is actually in today, which is a
 * real, intentionally-supported code path (see
 * WhatsAppWebhookController.handleWebhook's own doc comment), not a gap.
 *
 * Never calls WHATSAPP_PROVIDER/sends anything — these tests are purely
 * about the *inbound* webhook updating a Notification row that already
 * exists (created directly via Prisma, standing in for "a message this
 * app already sent"), matching real usage where the row is created by
 * createAndDispatch at send time, long before any status webhook arrives.
 */
describe('WhatsApp webhook (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;

  beforeAll(async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
    app = await createTestApp();
    tenantA = await createTestTenant(prisma, 'WaWebhookA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'WaWebhookB', UserRole.MANAGER);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  });

  // -------------------------------------------------------------------
  // GET verification handshake
  // -------------------------------------------------------------------

  it('1. GET verification succeeds and echoes the challenge exactly, given the correct mode and token', async () => {
    const res = await request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': TEST_VERIFY_TOKEN, 'hub.challenge': 'challenge-12345' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-12345');
  });

  it('2. GET verification rejects an incorrect verify token', async () => {
    const res = await request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'challenge-12345' });
    expect(res.status).toBe(403);
  });

  it('3. GET verification rejects a missing/wrong hub.mode even with the correct token', async () => {
    const res = await request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'unsubscribe', 'hub.verify_token': TEST_VERIFY_TOKEN, 'hub.challenge': 'challenge-12345' });
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------
  // POST status callbacks
  // -------------------------------------------------------------------

  function statusPayload(entries: { id: string; status: string; timestamp: string; errors?: { title: string }[] }[]) {
    return {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-test-id', changes: [{ value: { messaging_product: 'whatsapp', statuses: entries }, field: 'messages' }] }],
    };
  }

  async function createSentWhatsAppNotification(tenantId: string, customerId: string, providerMessageId: string) {
    return prisma.notification.create({
      data: {
        tenantId,
        customerId,
        channel: 'WHATSAPP',
        status: 'SENT',
        title: 'Test',
        body: 'Test body',
        providerMessageId,
        sentAt: new Date(),
      },
    });
  }

  it('4. a "read" status callback marks the matching notification READ, with readAt from the payload timestamp', async () => {
    const wamid = `wamid.read-${Date.now()}`;
    await createSentWhatsAppNotification(tenantA.tenantId, tenantA.customerId, wamid);

    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(statusPayload([{ id: wamid, status: 'read', timestamp: '1700000000' }]));
    expect(res.status).toBe(200);

    const updated = await prisma.notification.findFirst({ where: { providerMessageId: wamid } });
    expect(updated?.status).toBe('READ');
    expect(updated?.readAt?.toISOString()).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('5. a "failed" status callback marks the matching notification FAILED with the error title', async () => {
    const wamid = `wamid.failed-${Date.now()}`;
    await createSentWhatsAppNotification(tenantA.tenantId, tenantA.customerId, wamid);

    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(statusPayload([{ id: wamid, status: 'failed', timestamp: '1700000001', errors: [{ title: 'Recipient number is not a WhatsApp user' }] }]));
    expect(res.status).toBe(200);

    const updated = await prisma.notification.findFirst({ where: { providerMessageId: wamid } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.errorMessage).toBe('Recipient number is not a WhatsApp user');
  });

  it('6. "sent" and "delivered" callbacks leave status as SENT unchanged (no DELIVERED value exists) and never error', async () => {
    const wamidSent = `wamid.sent-${Date.now()}`;
    const wamidDelivered = `wamid.delivered-${Date.now()}`;
    await createSentWhatsAppNotification(tenantA.tenantId, tenantA.customerId, wamidSent);
    await createSentWhatsAppNotification(tenantA.tenantId, tenantA.customerId, wamidDelivered);

    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(
        statusPayload([
          { id: wamidSent, status: 'sent', timestamp: '1700000002' },
          { id: wamidDelivered, status: 'delivered', timestamp: '1700000003' },
        ]),
      );
    expect(res.status).toBe(200);

    expect((await prisma.notification.findFirst({ where: { providerMessageId: wamidSent } }))?.status).toBe('SENT');
    expect((await prisma.notification.findFirst({ where: { providerMessageId: wamidDelivered } }))?.status).toBe('SENT');
  });

  it('7. idempotency: redelivering the identical "read" callback produces the same end state, not an error or duplicate change', async () => {
    const wamid = `wamid.idempotent-${Date.now()}`;
    await createSentWhatsAppNotification(tenantA.tenantId, tenantA.customerId, wamid);
    const payload = statusPayload([{ id: wamid, status: 'read', timestamp: '1700000004' }]);

    const first = await request(app.getHttpServer()).post('/webhooks/whatsapp').send(payload);
    const second = await request(app.getHttpServer()).post('/webhooks/whatsapp').send(payload);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const updated = await prisma.notification.findFirst({ where: { providerMessageId: wamid } });
    expect(updated?.status).toBe('READ');
    expect(updated?.readAt?.toISOString()).toBe(new Date(1700000004 * 1000).toISOString());
  });

  it('8. out-of-order delivery: a "failed" callback arriving after "read" does not downgrade the notification', async () => {
    const wamid = `wamid.outoforder-${Date.now()}`;
    await createSentWhatsAppNotification(tenantA.tenantId, tenantA.customerId, wamid);

    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(statusPayload([{ id: wamid, status: 'read', timestamp: '1700000005' }]));
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(statusPayload([{ id: wamid, status: 'failed', timestamp: '1700000006', errors: [{ title: 'late failure' }] }]));
    expect(res.status).toBe(200);

    const updated = await prisma.notification.findFirst({ where: { providerMessageId: wamid } });
    expect(updated?.status).toBe('READ'); // not overwritten to FAILED
  });

  it('9. an unrecognized provider message id is silently ignored — 200, no error, no row created', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(statusPayload([{ id: 'wamid.never-sent-by-us', status: 'read', timestamp: '1700000007' }]));
    expect(res.status).toBe(200);

    const row = await prisma.notification.findFirst({ where: { providerMessageId: 'wamid.never-sent-by-us' } });
    expect(row).toBeNull();
  });

  it('10. malformed/empty payloads never crash the endpoint — always 200', async () => {
    const emptyBody = await request(app.getHttpServer()).post('/webhooks/whatsapp').send({});
    expect(emptyBody.status).toBe(200);

    const noStatuses = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send({ object: 'whatsapp_business_account', entry: [{ id: 'x', changes: [{ value: {}, field: 'messages' }] }] });
    expect(noStatuses.status).toBe(200);

    const garbageStatus = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(statusPayload([{ id: 'wamid.garbage', status: 'not-a-real-status', timestamp: 'not-a-number' }]));
    expect(garbageStatus.status).toBe(200);

    const noEntryAtAll = await request(app.getHttpServer()).post('/webhooks/whatsapp').send({ object: 'whatsapp_business_account' });
    expect(noEntryAtAll.status).toBe(200);
  });

  it('11. tenant isolation: a callback for tenant A\'s message id never updates tenant B\'s notification row', async () => {
    const wamidA = `wamid.tenant-a-${Date.now()}`;
    const wamidB = `wamid.tenant-b-${Date.now()}`;
    await createSentWhatsAppNotification(tenantA.tenantId, tenantA.customerId, wamidA);
    await createSentWhatsAppNotification(tenantB.tenantId, tenantB.customerId, wamidB);

    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(statusPayload([{ id: wamidA, status: 'read', timestamp: '1700000008' }]));

    expect((await prisma.notification.findFirst({ where: { providerMessageId: wamidA } }))?.status).toBe('READ');
    expect((await prisma.notification.findFirst({ where: { providerMessageId: wamidB } }))?.status).toBe('SENT'); // untouched
  });
});
