import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, ShipmentItemType, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WHATSAPP_PROVIDER } from '../src/notifications/providers/provider.types';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';

jest.setTimeout(30_000);

interface CapturedWhatsAppSend {
  to: string;
  body: string;
  template?: { name: string; language: string; params: string[] };
  tenantId: string;
}

/**
 * WhatsApp Integration (Stage 4C) Phase 1 — full pipeline integration
 * test. Mocks WHATSAPP_PROVIDER (no real Meta call, no tokens/credentials
 * needed) so these assertions are about THIS app's own dispatch/
 * normalization/scope-limiting logic, matching the exact
 * public-ai-agent.e2e-spec.ts pattern for mocking a provider token.
 *
 * Never asserts anything about the underlying shipment-status rollups
 * themselves (final-mile-notifications.e2e-spec.ts already covers that in
 * full) — this suite is specifically about the WhatsApp channel layered
 * on top of the already-proven, unmodified email/IN_APP/SMS dispatch.
 */
describe('WhatsApp final-mile notifications (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const sent: CapturedWhatsAppSend[] = [];
  let shouldFail = false;

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_PROVIDER)
      .useValue({
        send: async (params: CapturedWhatsAppSend) => {
          sent.push(params);
          if (shouldFail) {
            return { success: false, errorMessage: 'Simulated provider failure' };
          }
          return { success: true, providerMessageId: 'wamid.test' };
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenantA = await createTestTenant(prisma, 'WaFinalA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'WaFinalB', UserRole.MANAGER);
    tokenA = await login(app, tenantA.user.email, tenantA.user.password);

    // Both fixture tenants default to country "US" (see utils/fixtures.ts)
    // — give tenant A's default customer a valid, opted-in WhatsApp
    // number in bare US local format, proving the country-hint
    // normalization actually runs end to end, not just in the pure
    // phone-normalization unit test.
    await prisma.customer.update({
      where: { id: tenantA.customerId },
      data: { notifyByWhatsapp: true, whatsappPhone: '2147232121' },
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

  it('1. sends a real template-based WhatsApp message for a supported milestone, normalizing the bare local number to E.164', async () => {
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('+12147232121'); // normalized from "2147232121" using the tenant's country="US"
    expect(sent[0].tenantId).toBe(tenantA.tenantId);
    expect(sent[0].template).toEqual({
      name: 'shipment_status_update',
      language: 'en_US',
      params: [shipment.trackingNumber, 'Received at origin warehouse'],
    });

    const notificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: tenantA.customerId, channel: 'WHATSAPP' },
    });
    expect(notificationRow?.status).toBe('SENT');
    expect(notificationRow?.providerMessageId).toBe('wamid.test');
  });

  it('2. a customer with no WhatsApp number on file gets a FAILED record, and does not block the shipment operation', async () => {
    const customer = await createCustomer(app, tokenA, 'No Number');
    await prisma.customer.update({ where: { id: customer.id }, data: { notifyByWhatsapp: true, whatsappPhone: null } });

    const shipment = await createSingleShipment(app, tokenA, customer.id, 1);
    const res = await receiveItemRaw(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    expect(res.status).toBe(201); // the actual warehouse operation still succeeds

    const notificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'WHATSAPP' },
    });
    expect(notificationRow?.status).toBe('FAILED');
    expect(notificationRow?.errorMessage).toMatch(/no whatsapp address on file/i);
  });

  it('3. an invalid/unparseable WhatsApp number gets a FAILED record with a clear reason, and does not block the shipment operation', async () => {
    const customer = await createCustomer(app, tokenA, 'Bad Number');
    await prisma.customer.update({
      where: { id: customer.id },
      data: { notifyByWhatsapp: true, whatsappPhone: 'not-a-real-number' },
    });

    const shipment = await createSingleShipment(app, tokenA, customer.id, 1);
    const res = await receiveItemRaw(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    expect(res.status).toBe(201);

    const notificationRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: customer.id, channel: 'WHATSAPP' },
    });
    expect(notificationRow?.status).toBe('FAILED');
    expect(notificationRow?.errorMessage).toMatch(/not a valid phone number/i);
    expect(sent).toHaveLength(0); // never reached the provider at all
  });

  it('4. a provider-level failure is recorded as FAILED, and does not block the shipment operation or affect email', async () => {
    shouldFail = true;
    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
    const res = await receiveItemRaw(app, tokenA, shipment.items[0].id, tenantA.warehouseId);
    expect(res.status).toBe(201);

    const whatsappRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: tenantA.customerId, channel: 'WHATSAPP' },
      orderBy: { createdAt: 'desc' },
    });
    expect(whatsappRow?.status).toBe('FAILED');
    expect(whatsappRow?.errorMessage).toBe('Simulated provider failure');

    // Email for the exact same occurrence is completely unaffected.
    const emailRow = await prisma.notification.findFirst({
      where: { tenantId: tenantA.tenantId, customerId: tenantA.customerId, channel: 'EMAIL', eventId: whatsappRow?.eventId },
    });
    expect(emailRow?.status).toBe('SENT');
  });

  it('5. a non-shipment-status event (document visible) never attempts WhatsApp, even for an opted-in customer with a valid number', async () => {
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

  it('6. tenant isolation: tenant B customers never receive a WhatsApp send triggered by tenant A activity', async () => {
    await prisma.customer.update({
      where: { id: tenantB.customerId },
      data: { notifyByWhatsapp: true, whatsappPhone: '2147232121' },
    });
    sent.length = 0;

    const shipment = await createSingleShipment(app, tokenA, tenantA.customerId, 1);
    await receiveItem(app, tokenA, shipment.items[0].id, tenantA.warehouseId);

    expect(sent).toHaveLength(1);
    expect(sent[0].tenantId).toBe(tenantA.tenantId);
    const tenantBRows = await prisma.notification.findMany({
      where: { tenantId: tenantB.tenantId, channel: 'WHATSAPP' },
    });
    expect(tenantBRows).toHaveLength(0);
  });

  it('7. a Ghana-based tenant customer with a bare local number normalizes correctly using that tenant\'s own country', async () => {
    const ghanaTenant = await createTestTenant(prisma, 'WaFinalGhana', UserRole.MANAGER);
    await prisma.tenant.update({ where: { id: ghanaTenant.tenantId }, data: { country: 'GH' } });
    await prisma.customer.update({
      where: { id: ghanaTenant.customerId },
      data: { notifyByWhatsapp: true, whatsappPhone: '0201234567' },
    });
    const ghanaToken = await login(app, ghanaTenant.user.email, ghanaTenant.user.password);
    sent.length = 0;

    const shipment = await createSingleShipment(app, ghanaToken, ghanaTenant.customerId, 1);
    await receiveItem(app, ghanaToken, shipment.items[0].id, ghanaTenant.warehouseId);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('+233201234567');

    await deleteTestTenant(prisma, ghanaTenant.tenantId);
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
      items: Array.from({ length: itemCount }, () => ({ itemType: ShipmentItemType.BOX, description: 'E2E WhatsApp test box' })),
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
