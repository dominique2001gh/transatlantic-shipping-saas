import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Twilio A2P Campaign compliance: POST /public/platform-sms-consent — the
 * Ananse Logix platform-level SMS consent form at ananselogix.com/sms-consent.
 * Deliberately isolated from every tenant-scoped test fixture (no
 * Tenant/Customer created or touched here) — see
 * PlatformSmsConsentSubmission's own schema doc comment for why this is a
 * standalone table.
 */
describe('Platform SMS consent form (Twilio A2P, e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const createdIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await prisma.platformSmsConsentSubmission.deleteMany({ where: { id: { in: createdIds } } });
      createdIds.length = 0;
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function trackCreated(phone: string) {
    const row = await prisma.platformSmsConsentSubmission.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
    if (row) createdIds.push(row.id);
    return row;
  }

  it('omitting smsConsent records the submission with consent false and consentAt null', async () => {
    const phone = `+1214555${Date.now().toString().slice(-4)}`;
    const res = await request(app.getHttpServer()).post('/public/platform-sms-consent').send({
      name: 'A2P Test No Consent',
      phone,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });

    const row = await trackCreated(phone);
    expect(row).not.toBeNull();
    expect(row!.smsConsent).toBe(false);
    expect(row!.consentAt).toBeNull();
  });

  it('smsConsent: false behaves identically to omitted', async () => {
    const phone = `+1214556${Date.now().toString().slice(-4)}`;
    const res = await request(app.getHttpServer()).post('/public/platform-sms-consent').send({
      name: 'A2P Test Explicit False',
      phone,
      smsConsent: false,
    });
    expect(res.status).toBe(201);

    const row = await trackCreated(phone);
    expect(row!.smsConsent).toBe(false);
    expect(row!.consentAt).toBeNull();
  });

  it('smsConsent: true records affirmative consent with a timestamp', async () => {
    const phone = `+1214557${Date.now().toString().slice(-4)}`;
    const before = new Date();
    const res = await request(app.getHttpServer()).post('/public/platform-sms-consent').send({
      name: 'A2P Test With Consent',
      phone,
      smsConsent: true,
    });
    expect(res.status).toBe(201);

    const row = await trackCreated(phone);
    expect(row!.smsConsent).toBe(true);
    expect(row!.consentAt).not.toBeNull();
    expect(row!.consentAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('requires no authentication', async () => {
    const phone = `+1214558${Date.now().toString().slice(-4)}`;
    const res = await request(app.getHttpServer()).post('/public/platform-sms-consent').send({ name: 'A2P Test Anon', phone });
    expect(res.status).toBe(201);
    await trackCreated(phone);
  });

  it('rejects a missing name or phone', async () => {
    const res = await request(app.getHttpServer()).post('/public/platform-sms-consent').send({ phone: '+12145551234' });
    expect(res.status).toBe(400);

    const res2 = await request(app.getHttpServer()).post('/public/platform-sms-consent').send({ name: 'No Phone' });
    expect(res2.status).toBe(400);
  });

  it('rejects a whitelist-violating body attempting to smuggle extra fields', async () => {
    const phone = `+1214559${Date.now().toString().slice(-4)}`;
    const res = await request(app.getHttpServer()).post('/public/platform-sms-consent').send({
      name: 'Attacker',
      phone,
      smsConsent: true,
      tenantId: 'some-tenant-id',
    });
    expect(res.status).toBe(400); // forbidNonWhitelisted rejects the extra field outright

    const row = await prisma.platformSmsConsentSubmission.findFirst({ where: { phone } });
    expect(row).toBeNull();
  });
});
