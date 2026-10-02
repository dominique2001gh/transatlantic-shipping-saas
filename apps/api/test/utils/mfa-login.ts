import type { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';

/**
 * Platform-wide staff MFA (2026-10): every existing per-spec-file `login()`
 * helper (identical boilerplate, duplicated in ~45 e2e-spec files) used to
 * assume POST /auth/login returns a LoginResponseDto directly. For every
 * STAFF_ROLES account it now returns an MfaRequiredLoginResponse instead
 * (see AuthService.login's own doc comment) — this helper absorbs that
 * two-step reality in ONE place so every existing test file's `login()`
 * keeps its exact signature/behavior (take email+password, return a
 * usable accessToken) without each file needing its own MFA-aware logic.
 *
 * Transparently completes first-time enrollment (if the fixture user has
 * never logged in before) or a normal challenge (if a prior call already
 * enrolled it) using a secret cached in-process by email — fixtures never
 * need to know or store a TOTP secret themselves. CUSTOMER/PLATFORM_ADMIN
 * logins are unaffected (res.body.accessToken is already present) and
 * return immediately, identical to the old single-step behavior.
 */
const secretCacheByEmail = new Map<string, string>();

export async function completeStaffLogin(app: INestApplication, email: string, password: string): Promise<string> {
  const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed for ${email}: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }

  if (loginRes.body.accessToken) {
    return loginRes.body.accessToken as string;
  }

  const mfaToken = loginRes.body.mfaToken as string;

  if (!loginRes.body.mfaEnrolled) {
    const setupRes = await request(app.getHttpServer())
      .post('/auth/mfa/setup')
      .set('Authorization', `Bearer ${mfaToken}`)
      .send();
    if (setupRes.status !== 201 && setupRes.status !== 200) {
      throw new Error(`MFA setup failed for ${email}: ${setupRes.status} ${JSON.stringify(setupRes.body)}`);
    }
    const secret = setupRes.body.secret as string;
    secretCacheByEmail.set(email, secret);

    const verifyRes = await request(app.getHttpServer())
      .post('/auth/mfa/setup/verify')
      .set('Authorization', `Bearer ${mfaToken}`)
      .send({ code: authenticator.generate(secret) });
    if (verifyRes.status !== 200) {
      throw new Error(`MFA enrollment verify failed for ${email}: ${verifyRes.status} ${JSON.stringify(verifyRes.body)}`);
    }
    return verifyRes.body.accessToken as string;
  }

  const secret = secretCacheByEmail.get(email);
  if (!secret) {
    throw new Error(
      `completeStaffLogin: ${email} is already MFA-enrolled but no secret is cached in this process — ` +
        'this helper only works within the same test process that performed the original enrollment.',
    );
  }
  const challengeRes = await request(app.getHttpServer())
    .post('/auth/mfa/challenge')
    .set('Authorization', `Bearer ${mfaToken}`)
    .send({ code: authenticator.generate(secret) });
  if (challengeRes.status !== 200) {
    throw new Error(`MFA challenge failed for ${email}: ${challengeRes.status} ${JSON.stringify(challengeRes.body)}`);
  }
  return challengeRes.body.accessToken as string;
}
