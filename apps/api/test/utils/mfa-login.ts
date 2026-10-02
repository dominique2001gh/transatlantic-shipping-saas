import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { lastOtpCodeByUserId } from '../../src/auth/mfa/mfa-otp-test-hook';

/**
 * Email-based staff MFA (2026-10): every existing per-spec-file `login()`
 * helper (identical boilerplate, duplicated across most e2e-spec files)
 * used to assume POST /auth/login returns a LoginResponseDto directly.
 * For every STAFF_ROLES account it now returns an MfaRequiredLoginResponse
 * instead (see AuthService.login's own doc comment) — this helper absorbs
 * that two-step reality in ONE place so every existing test file's
 * `login()` keeps its exact signature/behavior (take email+password,
 * return a usable accessToken) without each file needing its own
 * MFA-aware logic.
 *
 * Reads the emailed code via mfa-otp-test-hook's in-process map rather
 * than parsing an email body or overriding EMAIL_PROVIDER per spec file —
 * see that module's own doc comment for why this is safe (test-only,
 * gated on NODE_ENV==='test', never read by production code).
 * CUSTOMER/PLATFORM_ADMIN logins are unaffected (res.body.accessToken is
 * already present) and return immediately, identical to the old
 * single-step behavior.
 */
export async function completeStaffLogin(app: INestApplication, email: string, password: string): Promise<string> {
  const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed for ${email}: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }

  if (loginRes.body.accessToken) {
    return loginRes.body.accessToken as string;
  }

  const mfaToken = loginRes.body.mfaToken as string;

  const sendRes = await request(app.getHttpServer()).post('/auth/mfa/send').set('Authorization', `Bearer ${mfaToken}`).send();
  if (sendRes.status !== 200) {
    throw new Error(`MFA send failed for ${email}: ${sendRes.status} ${JSON.stringify(sendRes.body)}`);
  }

  const userId = decodeMfaTokenSub(mfaToken);
  const code = lastOtpCodeByUserId.get(userId);
  if (!code) {
    throw new Error(`completeStaffLogin: no OTP code recorded for user ${userId} — mfa-otp-test-hook may not be enabled in this process`);
  }

  const challengeRes = await request(app.getHttpServer())
    .post('/auth/mfa/challenge')
    .set('Authorization', `Bearer ${mfaToken}`)
    .send({ code });
  if (challengeRes.status !== 200) {
    throw new Error(`MFA challenge failed for ${email}: ${challengeRes.status} ${JSON.stringify(challengeRes.body)}`);
  }
  return challengeRes.body.accessToken as string;
}

/** The stage token is a plain signed JWT — `sub` is readable without verifying the signature, which is fine here: this only ever runs against a token this same test just received from the app under test. */
export function decodeMfaTokenSub(mfaToken: string): string {
  const payloadSegment = mfaToken.split('.')[1];
  const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as { sub: string };
  return payload.sub;
}
