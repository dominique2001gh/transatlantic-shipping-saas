import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashToken } from '../src/common/token/token.util';
import { EMAIL_PROVIDER } from '../src/notifications/providers/provider.types';
import { createTestTenant, deleteTestTenant, TestTenantFixture } from './utils/fixtures';

jest.setTimeout(30_000);

interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Password recovery (Stage 2) — full forgot/reset-password pipeline,
 * end to end against the real HTTP surface. Overrides EMAIL_PROVIDER to
 * capture what would have been sent (matching
 * whatsapp-final-mile-notifications.e2e-spec.ts's exact pattern for
 * mocking a provider token) so the raw reset token — deliberately never
 * persisted anywhere in plaintext, see AccountToken's own doc comment —
 * can be recovered from the captured email body for these tests to use.
 */
describe('Password recovery: forgot/reset password (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const sent: CapturedEmail[] = [];

  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({
        send: async (params: CapturedEmail) => {
          sent.push(params);
          return { success: true, providerMessageId: 'console-email-test' };
        },
      })
      // This suite's own request volume (several forgot-password calls
      // across many tests, all from the same test-runner "IP", well
      // within the same minute) would otherwise trip the 5/min throttle
      // itself — a real, working safeguard, just not what these tests are
      // about. Rate-limiting is proven separately, below, against its own
      // dedicated app instance that leaves this guard untouched.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenantA = await createTestTenant(prisma, 'PwResetA', UserRole.MANAGER);
    tenantB = await createTestTenant(prisma, 'PwResetB', UserRole.MANAGER);
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, tenantA.tenantId);
    await deleteTestTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  function extractToken(email: CapturedEmail): string {
    const match = email.body.match(/reset-password\?token=([a-f0-9]+)/);
    if (!match) throw new Error(`No reset token found in captured email body: ${email.body}`);
    return match[1];
  }

  it('lets an existing user request a reset, with a generic response', async () => {
    const res = await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: tenantA.user.email });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "If an account exists for that email, we've sent password reset instructions." });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(tenantA.user.email);
  });

  it('does not leak account existence for an unknown email — identical response, no email sent', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'definitely-not-a-real-user@example.test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "If an account exists for that email, we've sent password reset instructions." });
    expect(sent).toHaveLength(0);
  });

  it('resets the password with a valid token, invalidates the old password, and the new one works', async () => {
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: tenantA.user.email }).expect(200);
    const token = extractToken(sent[0]);

    const newPassword = 'BrandNewPass456!';
    const resetRes = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: newPassword, confirmPassword: newPassword });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body).toEqual({ success: true });

    // Old password no longer works.
    const oldLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.user.email, password: tenantA.user.password });
    expect(oldLogin.status).toBe(401);

    // New password works.
    const newLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.user.email, password: newPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.accessToken).toBeTruthy();

    // Restore for any later test in this file that assumes the original password.
    tenantA.user.password = newPassword;
  });

  it('rejects reusing an already-used token', async () => {
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: tenantB.user.email }).expect(200);
    const token = extractToken(sent[0]);
    const password = 'FirstUseOnly789!';

    const first = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password, confirmPassword: password });
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'AnotherPass999!', confirmPassword: 'AnotherPass999!' });
    expect(second.status).toBe(400);

    tenantB.user.password = password;
  });

  it('rejects an expired token', async () => {
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: tenantB.user.email }).expect(200);
    const token = extractToken(sent[0]);

    // Force expiry directly on this one token — waiting out the real
    // 30-minute TTL isn't feasible in a test.
    await prisma.accountToken.update({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'TooLatePass123!', confirmPassword: 'TooLatePass123!' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('rejects mismatched password/confirmPassword before ever touching the token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: 'irrelevant-token-value', password: 'SomePassword1!', confirmPassword: 'DifferentPassword1!' });
    expect(res.status).toBe(400);
  });

  it('invalidates already-issued JWTs on password reset, without affecting other users', async () => {
    // A fresh session for tenantA, taken out *before* the reset below.
    const preResetLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.user.email, password: tenantA.user.password });
    expect(preResetLogin.status).toBe(200);
    const staleToken = preResetLogin.body.accessToken as string;

    // Sanity: the token works right now.
    const beforeReset = await request(app.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${staleToken}`);
    expect(beforeReset.status).toBe(200);

    // JwtStrategy compares `iat` (whole seconds) against passwordChangedAt
    // (millisecond precision) at second granularity, by design (see its
    // own doc comment) — a token issued the same second as the reset is
    // deliberately not treated as stale. Force a real second boundary
    // between issuing staleToken and resetting, so this test exercises
    // genuine "issued before, rejected after" invalidation rather than
    // racing that same-second tolerance.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: tenantA.user.email }).expect(200);
    const token = extractToken(sent[0]);
    const newPassword = 'InvalidatesOldSessions321!';
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: newPassword, confirmPassword: newPassword })
      .expect(200);
    tenantA.user.password = newPassword;

    // The JWT issued before the reset is now rejected...
    const afterReset = await request(app.getHttpServer()).get('/users/me').set('Authorization', `Bearer ${staleToken}`);
    expect(afterReset.status).toBe(401);

    // ...but tenant B's own session, untouched by tenant A's reset, keeps working (cross-tenant isolation).
    const tenantBToken = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.user.email, password: tenantB.user.password });
    expect(tenantBToken.status).toBe(200);
    const tenantBMe = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${tenantBToken.body.accessToken}`);
    expect(tenantBMe.status).toBe(200);
    expect(tenantBMe.body.tenantId).toBe(tenantB.tenantId);
  });

  it('preserves tenant isolation: two accounts sharing an email each get their own token, resetting one never touches the other', async () => {
    const sharedEmail = `shared-${Date.now()}@example.test`;
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('OriginalSharedPass1!', 10);

    const userInA = await prisma.user.create({
      data: { tenantId: tenantA.tenantId, email: sharedEmail, passwordHash, firstName: 'Shared', lastName: 'A', role: UserRole.STAFF },
    });
    const userInB = await prisma.user.create({
      data: { tenantId: tenantB.tenantId, email: sharedEmail, passwordHash, firstName: 'Shared', lastName: 'B', role: UserRole.STAFF },
    });

    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: sharedEmail }).expect(200);
    expect(sent).toHaveLength(2); // one token/email per matching account, not one shared token

    const tokenForA = extractToken(sent[0]); // whichever account's token this is, resetting it must never touch the other
    const newPasswordForA = 'OnlyAccountAChanges1!';
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: tokenForA, password: newPasswordForA, confirmPassword: newPasswordForA })
      .expect(200);

    // Whichever account that first token belonged to now has the new password...
    const refreshedA = await prisma.user.findUnique({ where: { id: userInA.id } });
    const refreshedB = await prisma.user.findUnique({ where: { id: userInB.id } });
    const aChanged = refreshedA!.passwordHash !== passwordHash;
    const bChanged = refreshedB!.passwordHash !== passwordHash;
    // Exactly one of the two accounts changed — never both, never neither.
    expect(aChanged !== bChanged).toBe(true);
  });

  it('leaves existing seeded/production-style login behavior fully intact for an account that never requested a reset', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.user.email, password: tenantB.user.password });
    expect(res.status).toBe(200);
    expect(res.body.user.tenantId).toBe(tenantB.tenantId);
  });
});

/**
 * The real ThrottlerGuard is deliberately left in place here (unlike the
 * suite above, which overrides it purely to isolate itself from this
 * concern) — this is the one place that actually proves
 * @Throttle({ limit: 5, ttl: 60_000 }) on POST /auth/forgot-password does
 * what it's meant to: stop an email-enumeration/spam burst.
 */
describe('Password recovery: forgot-password is rate-limited (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let tenant: TestTenantFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({ send: async () => ({ success: true, providerMessageId: 'console-email-test' }) })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    tenant = await createTestTenant(prisma, 'PwResetThrottle', UserRole.MANAGER);
  });

  afterAll(async () => {
    await deleteTestTenant(prisma, tenant.tenantId);
    await prisma.$disconnect();
    await app.close();
  });

  it('returns 429 after exceeding 5 forgot-password requests per minute', async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: tenant.user.email }));
    }
    const statuses = results.map((r) => r.status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});
