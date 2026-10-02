import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMAIL_PROVIDER } from '../src/notifications/providers/provider.types';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Multi-tenant hostname fix (2026-10): forgot-password's resetUrl used to
 * be built from the global WEB_APP_URL unconditionally — correct only for
 * Trans Atlantic (the one legacy-slugged tenant WEB_APP_URL is actually
 * configured for), wrong for every other tenant, present or future (see
 * AuthService.requestPasswordReset's own doc comment). This suite boots
 * its own app instance with WEB_APP_URL/ANANSELOGIX_BASE_URL/
 * LEGACY_CUSTOM_DOMAIN_TENANT_SLUG set to deliberately distinct values —
 * @nestjs/config snapshots process.env at ConfigModule.forRoot() time, so
 * these must be set before this file's own Test.createTestingModule call,
 * never shared with (or leaked into) any other spec file's app instance.
 */
const ORIGINAL_ENV = {
  WEB_APP_URL: process.env.WEB_APP_URL,
  ANANSELOGIX_BASE_URL: process.env.ANANSELOGIX_BASE_URL,
  LEGACY_CUSTOM_DOMAIN_TENANT_SLUG: process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG,
};

process.env.WEB_APP_URL = 'https://app.talogisticssolutions.com';
process.env.ANANSELOGIX_BASE_URL = 'https://ananselogix.com';
process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG = 'transatlantic';

describe('Forgot-password resetUrl is tenant-aware, not hardcoded to one tenant (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const sent: CapturedEmail[] = [];
  let tenant: TestTenantFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({
        send: async (params: CapturedEmail) => {
          sent.push(params);
          return { success: true, providerMessageId: 'console-email-test' };
        },
      })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // Never literally slugged "transatlantic" — a random e2e-* tenant,
    // exactly the "every other tenant, including Tatanic and every
    // future signup" case this fix is actually for.
    tenant = await createTestTenant(prisma, 'HostnameFix', UserRole.OWNER);
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
    await app.close();
    process.env.WEB_APP_URL = ORIGINAL_ENV.WEB_APP_URL;
    process.env.ANANSELOGIX_BASE_URL = ORIGINAL_ENV.ANANSELOGIX_BASE_URL;
    process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG = ORIGINAL_ENV.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG;
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('a non-legacy tenant (AnanseLogix-hosted — e.g. Tatanic) gets ANANSELOGIX_BASE_URL, never Trans Atlantic\'s own domain', async () => {
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: tenant.user.email }).expect(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain('https://ananselogix.com/reset-password?token=');
    expect(sent[0].body).not.toContain('app.talogisticssolutions.com');
  });

  it('a tenant with its own configured customDomain uses that domain, regardless of slug', async () => {
    await prisma.tenant.update({ where: { id: tenant.tenantId }, data: { customDomain: 'my-own-shipping-co.example' } });
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: tenant.user.email }).expect(200);
    expect(sent[0].body).toContain('https://my-own-shipping-co.example/reset-password?token=');
    await prisma.tenant.update({ where: { id: tenant.tenantId }, data: { customDomain: null } }); // restore
  });

  it('a PLATFORM_ADMIN (no tenant at all) gets the platform\'s own hostname, never a crash, never WEB_APP_URL', async () => {
    const admin = await prisma.user.create({
      data: {
        tenantId: null,
        email: `platform-admin-hostname-${Date.now()}@example.test`,
        passwordHash: await bcrypt.hash('AdminPass123!', 10),
        firstName: 'Platform',
        lastName: 'Admin',
        role: UserRole.PLATFORM_ADMIN,
      },
    });

    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: admin.email }).expect(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain('https://ananselogix.com/reset-password?token=');

    await prisma.user.delete({ where: { id: admin.id } });
  });
});
