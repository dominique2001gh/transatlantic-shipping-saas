import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { computeTwilioSignature } from '../src/notifications/twilio-webhook-signature.util';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * SMS/Twilio A2P Phase 1: POST /webhooks/twilio-sms — inbound STOP/START/
 * HELP compliance handling. `TWILIO_AUTH_TOKEN` is set directly on
 * `process.env` here (this suite's own, not a real Twilio secret) rather
 * than relying on apps/api/.env, since local dev intentionally has no
 * Twilio credentials configured; `ConfigService.get` falls back to
 * `process.env` live for any key not already cached from a `.env` file, so
 * this is picked up per-request without needing to reboot the app.
 */
describe('Inbound Twilio SMS webhook: STOP/START/HELP (Phase 1, e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const authToken = 'e2e-test-twilio-auth-token';
  const webhookPath = '/webhooks/twilio-sms';
  let webhookUrl: string;

  const createdOptOutPhones: string[] = [];

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = authToken;
    app = await createTestApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    webhookUrl = `http://127.0.0.1:${port}${webhookPath}`;
  });

  afterEach(async () => {
    if (createdOptOutPhones.length > 0) {
      await prisma.smsOptOut.deleteMany({ where: { phoneE164: { in: createdOptOutPhones } } });
      createdOptOutPhones.length = 0;
    }
  });

  afterAll(async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    await app.close();
    await prisma.$disconnect();
  });

  function uniquePhone(): string {
    // Distinct per test so parallel/sequential tests never collide on the
    // same phoneE164 unique constraint. A real-shaped 12-character US
    // E.164 number ("+1" + 3-digit area code + 7-digit local number).
    const local = Math.floor(1_000_000 + Math.random() * 8_999_999);
    return `+1214${local}`;
  }

  function signedRequest(params: Record<string, string>) {
    const signature = computeTwilioSignature(authToken, webhookUrl, params);
    return request(app.getHttpServer())
      .post(webhookPath)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(params);
  }

  it('rejects a request with a missing signature — no state change', async () => {
    const phone = uniquePhone();
    const res = await request(app.getHttpServer())
      .post(webhookPath)
      .type('form')
      .send({ From: phone, To: '+18005550100', Body: 'STOP', MessageSid: 'SMtest1' });

    expect(res.status).toBe(403);

    const optOut = await prisma.smsOptOut.findUnique({ where: { phoneE164: phone } });
    expect(optOut).toBeNull();
  });

  it('rejects a request with an invalid signature — no state change', async () => {
    const phone = uniquePhone();
    const res = await request(app.getHttpServer())
      .post(webhookPath)
      .set('X-Twilio-Signature', 'not-a-real-signature')
      .type('form')
      .send({ From: phone, To: '+18005550100', Body: 'STOP', MessageSid: 'SMtest2' });

    expect(res.status).toBe(403);

    const optOut = await prisma.smsOptOut.findUnique({ where: { phoneE164: phone } });
    expect(optOut).toBeNull();
  });

  it('a validly-signed STOP creates a global SmsOptOut row and replies with TwiML', async () => {
    const phone = uniquePhone();
    const res = await signedRequest({ From: phone, To: '+18005550100', Body: 'STOP', MessageSid: 'SMtest3' });
    createdOptOutPhones.push(phone);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('<Message>');
    expect(res.text.toLowerCase()).toContain('unsubscribed');

    const optOut = await prisma.smsOptOut.findUnique({ where: { phoneE164: phone } });
    expect(optOut).not.toBeNull();
    expect(optOut!.source).toBe('twilio_stop_webhook');
  });

  it('STOP is idempotent — repeating it never creates a duplicate row', async () => {
    const phone = uniquePhone();
    await signedRequest({ From: phone, To: '+18005550100', Body: 'STOP', MessageSid: 'SMtest4a' });
    await signedRequest({ From: phone, To: '+18005550100', Body: 'stop', MessageSid: 'SMtest4b' }); // lowercase, still matches
    createdOptOutPhones.push(phone);

    const rows = await prisma.smsOptOut.findMany({ where: { phoneE164: phone } });
    expect(rows).toHaveLength(1);
  });

  it('a validly-signed HELP does not change any state and replies with help text', async () => {
    const phone = uniquePhone();
    const res = await signedRequest({ From: phone, To: '+18005550100', Body: 'HELP', MessageSid: 'SMtest5' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Message>');
    expect(res.text.toLowerCase()).toContain('stop');

    const optOut = await prisma.smsOptOut.findUnique({ where: { phoneE164: phone } });
    expect(optOut).toBeNull();
  });

  it('START removes the opt-out block but does not itself re-enable any Customer.notifyBySms', async () => {
    const phone = uniquePhone();
    await signedRequest({ From: phone, To: '+18005550100', Body: 'STOP', MessageSid: 'SMtest6a' });
    let optOut = await prisma.smsOptOut.findUnique({ where: { phoneE164: phone } });
    expect(optOut).not.toBeNull();

    const startRes = await signedRequest({ From: phone, To: '+18005550100', Body: 'START', MessageSid: 'SMtest6b' });
    expect(startRes.status).toBe(200);
    expect(startRes.text.toLowerCase()).toContain('resubscribed');

    optOut = await prisma.smsOptOut.findUnique({ where: { phoneE164: phone } });
    expect(optOut).toBeNull(); // block removed
  });

  it('an unrecognized message body is a safe no-op (no state change, empty TwiML, 200)', async () => {
    const phone = uniquePhone();
    const res = await signedRequest({ From: phone, To: '+18005550100', Body: 'What is my tracking number?', MessageSid: 'SMtest7' });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<Message>');

    const optOut = await prisma.smsOptOut.findUnique({ where: { phoneE164: phone } });
    expect(optOut).toBeNull();
  });
});

/**
 * SMS/Twilio A2P Phase 1: proves the shared-sender cross-tenant behavior
 * this phase's own design explicitly calls for — see SmsOptOut's schema
 * doc comment. Uses two independently-created, otherwise-unrelated test
 * tenants whose customers happen to share one phone number (the scenario
 * the audit flagged as a real risk given Customer.phone has no
 * cross-tenant uniqueness constraint).
 */
describe('Inbound Twilio SMS webhook: cross-tenant STOP behavior (Phase 1, e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const authToken = 'e2e-test-twilio-auth-token-tenant';
  const webhookPath = '/webhooks/twilio-sms';
  let webhookUrl: string;
  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  const sharedPhone = '+12145559876';

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = authToken;
    app = await createTestApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    webhookUrl = `http://127.0.0.1:${port}${webhookPath}`;

    tenantA = await createTestTenant(prisma, 'TwilioStopA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'TwilioStopB', UserRole.MANAGER);

    // Both tenants' customers legitimately share the same physical phone
    // number — the exact scenario that makes tenant-scoped opt-out unsafe
    // given a single shared Twilio sending number.
    await prisma.customer.update({ where: { id: tenantA.customerId }, data: { phone: sharedPhone, notifyBySms: true, smsConsentGiven: true } });
    await prisma.customer.update({ where: { id: tenantB.customerId }, data: { phone: sharedPhone, notifyBySms: true, smsConsentGiven: true } });
  });

  afterAll(async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    await app.close();
    await prisma.smsOptOut.deleteMany({ where: { phoneE164: sharedPhone } });
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
  });

  function signedRequest(params: Record<string, string>) {
    const signature = computeTwilioSignature(authToken, webhookUrl, params);
    return request(app.getHttpServer())
      .post(webhookPath)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(params);
  }

  it('one STOP creates exactly one global SmsOptOut row (not per-tenant) and mirrors notifyBySms:false onto every tenant sharing the phone', async () => {
    const res = await signedRequest({ From: sharedPhone, To: '+18005550100', Body: 'STOP', MessageSid: 'SMtestX1' });
    expect(res.status).toBe(200);

    const optOutRows = await prisma.smsOptOut.findMany({ where: { phoneE164: sharedPhone } });
    expect(optOutRows).toHaveLength(1); // global, never duplicated per tenant

    const customerA = await prisma.customer.findUniqueOrThrow({ where: { id: tenantA.customerId } });
    const customerB = await prisma.customer.findUniqueOrThrow({ where: { id: tenantB.customerId } });
    expect(customerA.notifyBySms).toBe(false);
    expect(customerA.smsOptOutAt).not.toBeNull();
    expect(customerB.notifyBySms).toBe(false);
    expect(customerB.smsOptOutAt).not.toBeNull();

    // Consent stays exactly as each tenant granted it — opt-out is
    // subtractive/global, but consent itself is never rewritten, and
    // never leaks from one tenant's row to another's.
    expect(customerA.smsConsentGiven).toBe(true);
    expect(customerB.smsConsentGiven).toBe(true);
  });

  it('the webhook never exposes any other tenant’s data — the response contains no tenant/customer identifiers', async () => {
    const res = await signedRequest({ From: sharedPhone, To: '+18005550100', Body: 'HELP', MessageSid: 'SMtestX2' });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(tenantA.tenantId);
    expect(res.text).not.toContain(tenantB.tenantId);
    expect(res.text).not.toContain(tenantA.customerId);
    expect(res.text).not.toContain(tenantB.customerId);
  });
});
