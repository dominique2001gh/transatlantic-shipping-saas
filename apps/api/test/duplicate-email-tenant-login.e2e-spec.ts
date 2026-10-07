import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestTenant, deleteTestTenant, TEST_PASSWORD, TestTenantFixture } from './utils/fixtures';
import { completeStaffLogin } from './utils/mfa-login';

jest.setTimeout(30_000);

/**
 * Regression coverage for the Gold Coast/Tatanic incident (2026-10-07):
 * the same email can legitimately belong to active accounts at more than
 * one tenant. AuthService.login must never silently pick whichever one
 * happens to come back first — it must only succeed when exactly one
 * active account's password matches, and must refuse (not guess) when
 * more than one does. Generic — no tenant-specific logic is involved,
 * just two freshly-created e2e tenants standing in for any current or
 * future pair.
 */
describe('Duplicate email across tenants: login never silently picks a tenant (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenantA = await createTestTenant(prisma, 'DupEmailA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'DupEmailB', UserRole.OWNER);
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
    await app.close();
  });

  it('still logs in normally when only one account matches the email (the overwhelmingly common case)', async () => {
    // tenantA.user and tenantB.user have different emails by default — a
    // same-password login for one must never affect or involve the other.
    const accessToken = await completeStaffLogin(app, tenantA.user.email, tenantA.user.password);
    expect(accessToken).toBeTruthy();

    const me = await request(app.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.tenantId).toBe(tenantA.tenantId);
  });

  it('still resolves correctly by password when two tenants share an email but use DIFFERENT passwords', async () => {
    const sharedEmail = `shared-diffpw-${Date.now()}@example.test`;
    const bcrypt = await import('bcrypt');

    const userInA = await prisma.user.create({
      data: {
        tenantId: tenantA.tenantId,
        email: sharedEmail,
        passwordHash: await bcrypt.hash('PasswordForA111!', 10),
        firstName: 'Shared',
        lastName: 'A',
        role: UserRole.STAFF,
      },
    });
    const userInB = await prisma.user.create({
      data: {
        tenantId: tenantB.tenantId,
        email: sharedEmail,
        passwordHash: await bcrypt.hash('PasswordForB222!', 10),
        firstName: 'Shared',
        lastName: 'B',
        role: UserRole.STAFF,
      },
    });

    const loginA = await completeStaffLogin(app, sharedEmail, 'PasswordForA111!');
    const meA = await request(app.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${loginA}`);
    expect(meA.body.tenantId).toBe(tenantA.tenantId);
    expect(meA.body.id).toBe(userInA.id);

    const loginB = await completeStaffLogin(app, sharedEmail, 'PasswordForB222!');
    const meB = await request(app.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${loginB}`);
    expect(meB.body.tenantId).toBe(tenantB.tenantId);
    expect(meB.body.id).toBe(userInB.id);
  });

  it('refuses to log in — never silently picking one — when two tenants share an email AND the same password (the actual incident)', async () => {
    const sharedEmail = `shared-samepw-${Date.now()}@example.test`;
    const bcrypt = await import('bcrypt');
    const sharedPasswordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    await prisma.user.create({
      data: {
        tenantId: tenantA.tenantId,
        email: sharedEmail,
        passwordHash: sharedPasswordHash,
        firstName: 'Collide',
        lastName: 'A',
        role: UserRole.MANAGER,
      },
    });
    await prisma.user.create({
      data: {
        tenantId: tenantB.tenantId,
        email: sharedEmail,
        passwordHash: sharedPasswordHash,
        firstName: 'Collide',
        lastName: 'B',
        role: UserRole.OWNER,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: sharedEmail, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.mfaRequired).toBeUndefined();
    // Never names a tenant — the message must stay fully generic.
    expect(res.body.message).toMatch(/more than one account/i);
    expect(res.body.message).not.toMatch(/DupEmailA|DupEmailB/);
  });

  it('a CUSTOMER-role collision is blocked the same way, with no MFA/role-specific bypass', async () => {
    const sharedEmail = `shared-customer-${Date.now()}@example.test`;
    const bcrypt = await import('bcrypt');
    const sharedPasswordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    await prisma.user.create({
      data: {
        tenantId: tenantA.tenantId,
        email: sharedEmail,
        passwordHash: sharedPasswordHash,
        firstName: 'CustA',
        lastName: 'A',
        role: UserRole.CUSTOMER,
      },
    });
    await prisma.user.create({
      data: {
        tenantId: tenantB.tenantId,
        email: sharedEmail,
        passwordHash: sharedPasswordHash,
        firstName: 'CustB',
        lastName: 'B',
        role: UserRole.CUSTOMER,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: sharedEmail, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/more than one account/i);
  });
});
