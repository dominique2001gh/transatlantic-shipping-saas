import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMAIL_PROVIDER } from '../src/notifications/providers/provider.types';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';

/**
 * TRANS_ATLANTIC_TENANT_SLUG cleanup: AuthService.customerSignup's
 * no-`tenantSlug` fallback used to be a second hardcoded literal
 * ('transatlantic'), independent of LEGACY_CUSTOM_DOMAIN_TENANT_SLUG — the
 * one config-driven source of truth every other legacy-grandfather special
 * case in this file already reads (tenant-web-app-url.util.ts,
 * resolveCustomerEntryPoint). Now it reads that same var, so this is the
 * one remaining place, not a second one.
 *
 * Two independent app instances are booted here (like
 * password-reset-hostname.e2e-spec.ts), each with
 * LEGACY_CUSTOM_DOMAIN_TENANT_SLUG set to a different value *before* its
 * own Test.createTestingModule compiles (@nestjs/config snapshots
 * process.env at that moment) — proving both branches of the new
 * behavior in isolation, without depending on or mutating shared app
 * instances used elsewhere in the suite.
 */
describe('Customer signup: legacy no-tenantSlug fallback, configured (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let transAtlanticTenantId: string;
  const ORIGINAL_LEGACY_SLUG = process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG;

  const createdUserIds: string[] = [];
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG = 'transatlantic';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({ send: async () => ({ success: true, providerMessageId: 'console-email-test' }) })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const tenant = await prisma.tenant.findFirst({ where: { slug: 'transatlantic' } });
    if (!tenant) {
      throw new Error('This suite requires the real "transatlantic" tenant to exist in the target database.');
    }
    transAtlanticTenantId = tenant.id;
  });

  afterAll(async () => {
    if (createdCustomerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
    await prisma.$disconnect();
    process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG = ORIGINAL_LEGACY_SLUG;
  });

  function uniqueEmail(label: string): string {
    return `e2e-legacy-fallback-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  }

  it('with the var configured to "transatlantic" (matches real production), omitting tenantSlug resolves to the real Trans Atlantic tenant — unchanged production behavior', async () => {
    const email = uniqueEmail('configured');
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.tenantId).toBe(transAtlanticTenantId);

    createdUserIds.push(res.body.user.id);
    createdCustomerIds.push(res.body.user.customerId);
  });
});

describe('Customer signup: legacy no-tenantSlug fallback, unconfigured (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let explicitTenant: TestTenantFixture;
  const ORIGINAL_LEGACY_SLUG = process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG;

  beforeAll(async () => {
    delete process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({ send: async () => ({ success: true, providerMessageId: 'console-email-test' }) })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    explicitTenant = await createTestTenant(prisma, 'LegacyFallbackUnset', UserRole.MANAGER);
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, explicitTenant.tenantId);
    await app.close();
    await prisma.$disconnect();
    process.env.LEGACY_CUSTOM_DOMAIN_TENANT_SLUG = ORIGINAL_LEGACY_SLUG;
  });

  function uniqueEmail(label: string): string {
    return `e2e-legacy-fallback-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  }

  it('with the var unconfigured, omitting tenantSlug is rejected with the same generic 400 as an unrecognized slug — never silently guesses a tenant', async () => {
    const email = uniqueEmail('unconfigured');
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Ama',
      lastName: 'Boateng',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
    });
    expect(res.status).toBe(400);

    const createdAnywhere = await prisma.user.findFirst({ where: { email } });
    expect(createdAnywhere).toBeNull();
  });

  it('an explicit tenantSlug still resolves normally even with the legacy var unconfigured — every current/future tenant is unaffected by this fallback', async () => {
    const email = uniqueEmail('explicit-unaffected');
    const res = await request(app.getHttpServer()).post('/auth/customer-signup').send({
      firstName: 'Kwame',
      lastName: 'Mensah',
      email,
      password: 'CorrectHorse123',
      confirmPassword: 'CorrectHorse123',
      tenantSlug: explicitTenant.slug,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.tenantId).toBe(explicitTenant.tenantId);
  });
});
