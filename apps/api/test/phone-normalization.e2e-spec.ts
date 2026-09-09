import { normalizeToE164 } from '../src/notifications/phone-normalization.util';

jest.setTimeout(30_000);

/**
 * WhatsApp Integration (Stage 4C) Phase 1 — pure-function test, no DB/app,
 * matching resend-email-header.e2e-spec.ts's convention (named
 * .e2e-spec.ts only because that's this suite's only Jest entry point).
 */
describe('normalizeToE164 — customer phone number normalization for WhatsApp (e2e)', () => {
  it('1. normalizes a Ghana local-format number using the tenant country hint', () => {
    expect(normalizeToE164('0201234567', 'GH')).toBe('+233201234567');
  });

  it('2. normalizes a US local-format number using the tenant country hint', () => {
    expect(normalizeToE164('2147232121', 'US')).toBe('+12147232121');
  });

  it('3. passes through an already-E.164 number unchanged, regardless of the country hint', () => {
    expect(normalizeToE164('+233201234567', 'US')).toBe('+233201234567');
    expect(normalizeToE164('+233201234567', null)).toBe('+233201234567');
  });

  it('4. returns null for a bare local-format number with no country hint available — cannot be resolved', () => {
    expect(normalizeToE164('0201234567', null)).toBeNull();
    expect(normalizeToE164('0201234567', undefined)).toBeNull();
  });

  it('5. returns null for garbage/invalid input, never throws', () => {
    expect(normalizeToE164('not a phone number', 'GH')).toBeNull();
    expect(normalizeToE164('123', 'GH')).toBeNull();
    expect(normalizeToE164('+1', 'US')).toBeNull();
  });

  it('6. returns null for missing/empty input', () => {
    expect(normalizeToE164(null, 'GH')).toBeNull();
    expect(normalizeToE164(undefined, 'GH')).toBeNull();
    expect(normalizeToE164('', 'GH')).toBeNull();
    expect(normalizeToE164('   ', 'GH')).toBeNull();
  });

  it('7. ignores an unrecognized/malformed country-code hint rather than throwing', () => {
    expect(normalizeToE164('0201234567', 'not-a-country')).toBeNull();
    expect(normalizeToE164('+233201234567', 'not-a-country')).toBe('+233201234567');
  });
});
