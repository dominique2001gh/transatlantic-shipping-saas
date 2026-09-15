import { resolvePlatformEmailSender, type ConfigLike } from '../src/notifications/providers/platform-email-sender.util';

jest.setTimeout(30_000);

/**
 * Sender-identity fix (2026-09, platform-branding) — covers exactly the
 * pure resolvePlatformEmailSender function, the same "no real HTTP call,
 * no Nest app, no database" scope resend-email-header.e2e-spec.ts already
 * establishes for formatFromHeader. Named .e2e-spec.ts only because
 * that's this suite's only Jest entry point (testRegex in jest-e2e.json).
 */
describe('resolvePlatformEmailSender — platform-lifecycle mail always identifies as AnanseLogix (e2e)', () => {
  function fakeConfig(values: Record<string, string>): ConfigLike {
    return {
      get: <T = string>(key: string, defaultValue?: T): T | undefined =>
        (key in values ? (values[key] as unknown as T) : defaultValue),
    };
  }

  it('1. defaults to "AnanseLogix" when PLATFORM_EMAIL_FROM_NAME is unset — the bug this fixes: no config was ever pointing platform mail at a tenant name, it just never had its own default', () => {
    const sender = resolvePlatformEmailSender(fakeConfig({}));
    expect(sender.fromName).toBe('AnanseLogix');
    expect(sender.fromAddress).toBeUndefined();
  });

  it('2. is completely unaffected by EMAIL_FROM_NAME/EMAIL_FROM_ADDRESS — a tenant\'s own customer-notification sender identity (e.g. Trans Atlantic\'s) must never leak into a platform-lifecycle send, which is exactly the reported bug', () => {
    const sender = resolvePlatformEmailSender(
      fakeConfig({
        EMAIL_FROM_NAME: 'Trans Atlantic Logistics Solutions',
        EMAIL_FROM_ADDRESS: 'notifications@notify.talogisticssolutions.com',
      }),
    );
    expect(sender.fromName).toBe('AnanseLogix');
    expect(sender.fromAddress).toBeUndefined();
  });

  it('3. an explicit PLATFORM_EMAIL_FROM_NAME override is honored (e.g. a future rebrand) without any code change', () => {
    const sender = resolvePlatformEmailSender(fakeConfig({ PLATFORM_EMAIL_FROM_NAME: 'AnanseLogix Platform' }));
    expect(sender.fromName).toBe('AnanseLogix Platform');
  });

  it('4. PLATFORM_EMAIL_FROM_ADDRESS, once set (a verified AnanseLogix sending domain), is picked up with zero code change', () => {
    const sender = resolvePlatformEmailSender(fakeConfig({ PLATFORM_EMAIL_FROM_ADDRESS: 'notifications@ananselogix.com' }));
    expect(sender.fromAddress).toBe('notifications@ananselogix.com');
  });
});
