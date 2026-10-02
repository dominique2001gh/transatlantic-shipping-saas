/**
 * Email-based staff MFA (2026-10): test-only observability for the
 * plaintext OTP code — e2e tests run in the same Node process as the app
 * under test (supertest calls `app.getHttpServer()` in-process, no real
 * network hop), so this map lets test helpers (see
 * test/utils/mfa-login.ts) read the code a login just emailed without
 * parsing email bodies or overriding EMAIL_PROVIDER in every spec file.
 *
 * `enabled` is gated on `NODE_ENV === 'test'` (which Jest sets
 * automatically) — in any other environment this module is a no-op and
 * the map is never populated, so no plaintext code is ever retained here
 * outside a test run. Never read by production code; never exposed
 * through any HTTP route.
 */
export const otpTestHookEnabled = process.env.NODE_ENV === 'test';

export const lastOtpCodeByUserId = new Map<string, string>();
