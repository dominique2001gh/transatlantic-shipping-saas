import { formatFromHeader } from '../src/notifications/providers/resend-email.provider';

jest.setTimeout(30_000);

/**
 * Sender-identity fix (2026-09) — covers exactly the pure formatFromHeader
 * function, never the real Resend HTTP call (ResendEmailProvider.send
 * itself is deliberately not exercised here: it talks to a real external
 * API and must never be invoked from a test run). Named .e2e-spec.ts only
 * because that's this suite's only Jest entry point (testRegex in
 * jest-e2e.json); nothing here touches the database, network, or a real
 * Nest application — it's a pure-function test that happens to live in
 * this directory.
 */
describe('formatFromHeader — RFC 5322 From-header sender-name formatting (e2e)', () => {
  it('1. formats "Display Name <address>" when a display name is given — the Trans Atlantic case', () => {
    expect(formatFromHeader('info@talogisticssolutions.com', 'Trans Atlantic Logistics Solutions')).toBe(
      '"Trans Atlantic Logistics Solutions" <info@talogisticssolutions.com>',
    );
  });

  it('2. returns the bare address, unchanged, when no display name is given — today\'s exact prior behavior', () => {
    expect(formatFromHeader('onboarding@resend.dev', undefined)).toBe('onboarding@resend.dev');
    expect(formatFromHeader('onboarding@resend.dev', null)).toBe('onboarding@resend.dev');
    expect(formatFromHeader('onboarding@resend.dev', '')).toBe('onboarding@resend.dev');
  });

  it('3. treats a whitespace-only display name as "no name given"', () => {
    expect(formatFromHeader('a@b.com', '   ')).toBe('a@b.com');
  });

  it('4. trims surrounding whitespace on an otherwise-real display name', () => {
    expect(formatFromHeader('a@b.com', '  Trans Atlantic  ')).toBe('"Trans Atlantic" <a@b.com>');
  });

  it('5. escapes internal quotes/backslashes in a display name so the header can never be malformed or injected', () => {
    expect(formatFromHeader('a@b.com', 'Say "Hi" \\ Co')).toBe('"Say \\"Hi\\" \\\\ Co" <a@b.com>');
  });

  it('6. is tenant-agnostic — works identically for any tenant name, proving nothing is hardcoded to Trans Atlantic', () => {
    expect(formatFromHeader('hello@othertenant.com', 'Some Other Shipping Co')).toBe(
      '"Some Other Shipping Co" <hello@othertenant.com>',
    );
  });
});
