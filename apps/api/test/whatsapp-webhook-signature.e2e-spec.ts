import { createHmac } from 'crypto';
import { verifyMetaWebhookSignature } from '../src/notifications/whatsapp-webhook-signature.util';

jest.setTimeout(30_000);

/** WhatsApp Integration (Stage 4C) Phase 2 — pure-function test, no DB/app. */
describe('verifyMetaWebhookSignature — Meta X-Hub-Signature-256 verification (e2e)', () => {
  const APP_SECRET = 'test-app-secret';
  const BODY = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));

  function sign(body: Buffer, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  it('1. accepts a correctly signed body', () => {
    expect(verifyMetaWebhookSignature(BODY, sign(BODY, APP_SECRET), APP_SECRET)).toBe(true);
  });

  it('2. rejects a signature computed with the wrong secret', () => {
    expect(verifyMetaWebhookSignature(BODY, sign(BODY, 'wrong-secret'), APP_SECRET)).toBe(false);
  });

  it('3. rejects a signature computed over a different body (tampered payload)', () => {
    const tamperedBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'injected' }] }));
    expect(verifyMetaWebhookSignature(BODY, sign(tamperedBody, APP_SECRET), APP_SECRET)).toBe(false);
  });

  it('4. rejects a missing signature header', () => {
    expect(verifyMetaWebhookSignature(BODY, undefined, APP_SECRET)).toBe(false);
  });

  it('5. rejects a malformed signature header (no "sha256=" prefix, garbage value, empty string)', () => {
    expect(verifyMetaWebhookSignature(BODY, 'not-a-valid-header', APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(BODY, 'sha1=abcd', APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(BODY, '', APP_SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(BODY, 'sha256=', APP_SECRET)).toBe(false);
  });

  it('6. rejects a truncated/wrong-length hex digest rather than throwing', () => {
    expect(() => verifyMetaWebhookSignature(BODY, 'sha256=abcd', APP_SECRET)).not.toThrow();
    expect(verifyMetaWebhookSignature(BODY, 'sha256=abcd', APP_SECRET)).toBe(false);
  });
});
