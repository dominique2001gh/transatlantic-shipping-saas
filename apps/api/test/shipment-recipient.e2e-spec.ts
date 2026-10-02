import { INestApplication } from '@nestjs/common';
import { PrismaClient, ShipmentMode, UserRole } from '@prisma/client';
import request from 'supertest';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';
import { createTestApp } from './utils/test-app';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Quick Receive Phase 2: standard New Shipment (POST /shipments) enforces
 * the same required recipient/consignee fields Quick Receive does — see
 * CreateShipmentDto's own doc comment. Both intake paths write into the
 * same Shipment.recipient* columns (schema.prisma), so this is tested here
 * as its own focused suite rather than folded into quick-receive.e2e-spec.ts.
 */
describe('New Shipment recipient/consignee (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tenant: TestTenantFixture;
  let managerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTestTenant(prisma, 'ShipmentRecipient', UserRole.MANAGER);
    managerToken = await login(app, tenant.user.email, tenant.user.password);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
  });

  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      customerId: tenant.customerId,
      shipmentMode: ShipmentMode.OCEAN_LCL,
      originCountry: 'US',
      destinationCountry: 'GH',
      recipientName: 'Test Recipient',
      recipientPhone: '+233201234567',
      ...overrides,
    };
  }

  function createShipment(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/shipments').set('Authorization', `Bearer ${managerToken}`).send(body);
  }

  it('rejects a missing recipientName', async () => {
    const { recipientName, ...rest } = basePayload();
    const res = await createShipment(rest);
    expect(res.status).toBe(400);
  });

  it('rejects a missing recipientPhone', async () => {
    const { recipientPhone, ...rest } = basePayload();
    const res = await createShipment(rest);
    expect(res.status).toBe(400);
  });

  it('creates the shipment and persists recipient fields when both are present', async () => {
    const res = await createShipment(
      basePayload({ recipientEmail: 'recipient@example.test', recipientCountry: 'Ghana', recipientCity: 'Accra' }),
    );
    expect(res.status).toBe(201);
    expect(res.body.recipientName).toBe('Test Recipient');
    expect(res.body.recipientPhone).toBe('+233201234567');
    expect(res.body.recipientEmail).toBe('recipient@example.test');
    expect(res.body.recipientCountry).toBe('Ghana');
    expect(res.body.recipientCity).toBe('Accra');
  });

  it('accepts an international phone with no hardcoded country-specific format', async () => {
    const res = await createShipment(basePayload({ recipientPhone: '+81 3-1234-5678' }));
    expect(res.status).toBe(201);
    expect(res.body.recipientPhone).toBe('+81 3-1234-5678');
  });
});

async function login(app: INestApplication, email: string, password: string): Promise<string> {
  return completeStaffLogin(app, email, password);
}
